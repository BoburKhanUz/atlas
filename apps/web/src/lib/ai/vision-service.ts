/**
 * VisionService: clothing analysis for wardrobe uploads. Until Phase 4.1 the
 * only provider is the deterministic mock (mock-vision.ts), whose behaviour
 * and output (`mock: true`) are unchanged; the call is now measured like any
 * other AI call. Real providers will plug in behind `analyzeImage` in client.ts.
 */
import { getAiConfig } from './config'
import { analyzeClothing, type ClothingDetection } from './mock-vision'
import { recordAiCall } from './telemetry'

export interface GarmentInput {
  /** The uploaded image bytes. */
  buffer: Buffer
  /** Client-supplied file name: a weak hint for the mock only. */
  filename: string
}

export async function analyzeGarment(input: GarmentInput): Promise<ClothingDetection> {
  const provider = getAiConfig().vision.provider
  const started = performance.now()
  try {
    const detection = await analyzeClothing(input)
    recordAiCall({ feature: 'clothing_analysis', provider, model: 'mock-vision', outcome: 'ok', latencyMs: performance.now() - started, attempts: 1 })
    return detection
  } catch (err) {
    recordAiCall({ feature: 'clothing_analysis', provider, model: 'mock-vision', outcome: 'error', latencyMs: performance.now() - started, attempts: 1 })
    throw err
  }
}

export type { ClothingDetection }
