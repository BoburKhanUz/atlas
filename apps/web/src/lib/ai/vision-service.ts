/**
 * VisionService: clothing analysis for wardrobe uploads.
 *
 *   mock provider  → the deterministic development mock (mock-vision.ts),
 *                    unchanged; `mock: true`; no quota.
 *   real provider  → prepared image → quota → provider (structured JSON)
 *                    → validation against the catalog → colour cross-check
 *                    → `mock: false` + analysis metadata.
 *
 * Failures never produce invented attributes; they surface as
 * GarmentAnalysisError and the route stores nothing.
 */
import { log } from '@/server/log'
import { analyzeImage } from './client'
import { getAiConfig } from './config'
import { crossCheckPrimaryColor, WEAK_SUPPORT_MAX_CONFIDENCE, type ColorCheck } from './color-check'
import {
  GARMENT_INSTRUCTION,
  GARMENT_JSON_SCHEMA,
  GARMENT_MAX_OUTPUT_TOKENS,
  InvalidGarmentOutputError,
  interpretGarmentOutput,
  presentConfidences,
  VISION_ANALYSIS_VERSION,
  type GarmentConfidences,
  type GarmentSubject,
} from './garment-analysis'
import { analyzeClothing, type ClothingDetection as MockDetection } from './mock-vision'
import { getVisionProvider } from './providers'
import { isAiProviderError } from './providers/errors'
import { prepareVisionImage } from './providers/vision-input'
import { consumeAiQuota, refundAiQuota, secondsUntilNextQuotaDay } from './quota'
import { recordAiCall } from './telemetry'

/** The detection returned by the API: `mock` is false for real providers. */
export type ClothingDetection = Omit<MockDetection, 'mock'> & { mock: boolean }

/** Stored with the item (WardrobeItem.analysis*). */
export interface AnalysisMetadata {
  provider: string
  model: string
  version: string
  analyzedAt: Date
  /** The model's own confidences, unchanged; null for the mock. */
  rawConfidences: GarmentConfidences | null
}

export interface GarmentAnalysis {
  detection: ClothingDetection
  metadata: AnalysisMetadata
}

export const MOCK_ANALYSIS_VERSION = 'mock'
const MOCK_MODEL = 'mock-vision'

export type GarmentAnalysisFailure =
  /** Provider unavailable or broke the contract: retry later (quota refunded). */
  | { kind: 'ai_unavailable' }
  /** The photo is not one clearly visible garment (quota charged). */
  | { kind: 'not_a_garment'; subject: Exclude<GarmentSubject, 'single_garment'> }
  /** Today's clothing-analysis quota is used up. */
  | { kind: 'quota_exceeded'; retryAfterSeconds: number }
  /** The image could not be prepared, or the provider refused it (safety). */
  | { kind: 'image_rejected' }

export class GarmentAnalysisError extends Error {
  constructor(readonly failure: GarmentAnalysisFailure) {
    super(`garment analysis failed: ${failure.kind}`)
    this.name = 'GarmentAnalysisError'
  }
}

export interface GarmentInput {
  /** The uploaded image bytes (already validated by the storage layer). */
  buffer: Buffer
  /** Client-supplied file name: a hint for the mock only, never sent to a provider. */
  filename: string
  /** Owner, for the quota. */
  userId: string
}

export async function analyzeGarment(input: GarmentInput, now: () => Date = () => new Date()): Promise<GarmentAnalysis> {
  const provider = getVisionProvider()
  if (provider.name === 'mock') return analyzeWithMock(input, now)
  return analyzeWithProvider(input, now)
}

async function analyzeWithMock(input: GarmentInput, now: () => Date): Promise<GarmentAnalysis> {
  const started = performance.now()
  try {
    const detection = await analyzeClothing({ buffer: input.buffer, filename: input.filename })
    recordAiCall({ feature: 'clothing_analysis', provider: 'mock', model: MOCK_MODEL, outcome: 'ok', latencyMs: performance.now() - started, attempts: 1 })
    return {
      detection,
      metadata: { provider: 'mock', model: MOCK_MODEL, version: MOCK_ANALYSIS_VERSION, analyzedAt: now(), rawConfidences: null },
    }
  } catch (err) {
    recordAiCall({ feature: 'clothing_analysis', provider: 'mock', model: MOCK_MODEL, outcome: 'error', latencyMs: performance.now() - started, attempts: 1 })
    throw err
  }
}

async function analyzeWithProvider(input: GarmentInput, now: () => Date): Promise<GarmentAnalysis> {
  const config = getAiConfig().vision

  // 1. Only prepared bytes may leave the server (rotated, flattened, no metadata, bounded).
  let prepared: Awaited<ReturnType<typeof prepareVisionImage>>
  try {
    prepared = await prepareVisionImage(input.buffer, config.maxSide)
  } catch {
    throw new GarmentAnalysisError({ kind: 'image_rejected' })
  }

  // 2. Quota, immediately before the provider call (atomic; never for the mock).
  // The refund targets the day that was charged, even if the call crosses midnight.
  const chargedAt = now()
  const quota = await consumeAiQuota(input.userId, 'clothing_analysis', chargedAt)
  if (!quota.allowed) throw new GarmentAnalysisError({ kind: 'quota_exceeded', retryAfterSeconds: secondsUntilNextQuotaDay(chargedAt) })
  const refund = () => refundAiQuota(input.userId, 'clothing_analysis', chargedAt).catch((err) => log.error('ai quota refund failed', { err }))

  // 3. Provider call (timeout and the single safe retry live in client.ts).
  let output: unknown
  let model: string
  try {
    const result = await analyzeImage('clothing_analysis', {
      image: prepared.image,
      mimeType: prepared.mimeType,
      maxSide: prepared.maxSide,
      instruction: GARMENT_INSTRUCTION,
      jsonSchema: { name: 'garment_analysis', schema: GARMENT_JSON_SCHEMA },
      maxOutputTokens: GARMENT_MAX_OUTPUT_TOKENS,
      options: {
        geminiMediaResolution: config.geminiMediaResolution,
        geminiThinkingLevel: config.geminiThinkingLevel,
        openaiDetail: config.openaiDetail,
      },
    })
    output = result.output
    model = result.metadata.model
  } catch (err) {
    if (isAiProviderError(err) && err.kind === 'content_filtered') {
      // The provider looked at the photo and refused it: charged, like a rejection.
      throw new GarmentAnalysisError({ kind: 'image_rejected' })
    }
    await refund()
    if (isAiProviderError(err)) throw new GarmentAnalysisError({ kind: 'ai_unavailable' })
    throw err
  }

  // 4. Validation: the only way model output reaches the database.
  let interpretation: ReturnType<typeof interpretGarmentOutput>
  try {
    interpretation = interpretGarmentOutput(output)
  } catch (err) {
    if (!(err instanceof InvalidGarmentOutputError)) throw err
    await refund()
    log.warn('ai.vision.invalid_output', { provider: provider(), model, version: VISION_ANALYSIS_VERSION, reason: err.message })
    throw new GarmentAnalysisError({ kind: 'ai_unavailable' })
  }
  if (interpretation.kind === 'rejected') throw new GarmentAnalysisError({ kind: 'not_a_garment', subject: interpretation.subject })

  // 5. Colour cross-check: pixels may only lower the colour confidence.
  const { attributes, rawConfidence } = interpretation
  let color: ColorCheck
  try {
    color = await crossCheckPrimaryColor(prepared.image, attributes.colors)
  } catch {
    color = { verdict: 'weak', support: 0, confidenceCap: WEAK_SUPPORT_MAX_CONFIDENCE }
  }
  log.info('ai.vision.result', { provider: provider(), model, version: VISION_ANALYSIS_VERSION, colorVerdict: color.verdict })

  return {
    detection: { ...attributes, confidence: presentConfidences(rawConfidence, color.confidenceCap), mock: false },
    metadata: { provider: provider(), model, version: VISION_ANALYSIS_VERSION, analyzedAt: now(), rawConfidences: rawConfidence },
  }
}

const provider = () => getVisionProvider().name

/** Whether a stored analysis came from the mock. Rows from before Phase 4.1 are backfilled as 'mock'. */
export function isMockAnalysis(analysisProvider: string | null): boolean {
  return analysisProvider === null || analysisProvider === 'mock'
}
