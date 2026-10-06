/**
 * Pure parts of the vision evaluation harness (scripts/ai-eval/vision-eval.ts):
 * dataset and matrix validation, per-item scoring and per-configuration
 * summaries. No network, no files: unit-tested in tests/unit/ai/vision-eval.test.ts.
 */
import { z } from 'zod'
import { CONFIDENCE_KEYS, SUBJECTS, type GarmentAttributes, type GarmentConfidences } from '../../src/lib/ai/garment-analysis'
import type { ColorVerdict } from '../../src/lib/ai/color-check'

// ─── Dataset ────────────────────────────────────────────────────────────────

/** Scored attribute fields. `primaryColor` is compared with the model's first colour. */
export const SCORED_FIELDS = ['category', 'subcategory', 'primaryColor', 'pattern', 'material', 'sleeveLength', 'fit', 'style', 'gender', 'formality'] as const
export type ScoredField = (typeof SCORED_FIELDS)[number]

/** Confidence key that belongs to each scored field (for calibration). */
const CONFIDENCE_OF: Record<ScoredField, (typeof CONFIDENCE_KEYS)[number]> = {
  category: 'category',
  subcategory: 'subcategory',
  primaryColor: 'color',
  pattern: 'pattern',
  material: 'material',
  sleeveLength: 'sleeveLength',
  fit: 'fit',
  style: 'style',
  gender: 'gender',
  formality: 'formality',
}

/** Neutral ids only: no names, no personal data in ids or file names. */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}\.(jpe?g|png|webp)$/i

const Expected = z.strictObject({
  subject: z.enum(SUBJECTS),
  // Every attribute is optional: an unlabelled field is not scored. null means "should be null".
  ...Object.fromEntries(SCORED_FIELDS.map((f) => [f, z.string().min(1).nullable().optional()])),
}) as z.ZodType<{ subject: (typeof SUBJECTS)[number] } & Partial<Record<ScoredField, string | null>>>

export const Dataset = z.strictObject({
  items: z
    .array(
      z.strictObject({
        id: z.string().regex(SAFE_ID, 'ids must be neutral ([A-Za-z0-9_-])'),
        file: z.string().regex(SAFE_FILE, 'file names must be neutral and relative'),
        expected: Expected,
      }),
    )
    .min(1)
    .refine((items) => new Set(items.map((i) => i.id)).size === items.length, 'duplicate ids'),
})
export type Dataset = z.infer<typeof Dataset>
export type DatasetItem = Dataset['items'][number]

// ─── Matrix ─────────────────────────────────────────────────────────────────

export const EvalConfig = z.strictObject({
  /** Short label used in the report, e.g. "gemini-A-1024". */
  label: z.string().regex(SAFE_ID),
  provider: z.enum(['gemini', 'openai']),
  model: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/),
  maxSide: z.number().int().min(256).max(2048),
  geminiMediaResolution: z.enum(['low', 'medium', 'high', 'ultra_high']).optional(),
  geminiThinkingLevel: z.enum(['none', 'minimal', 'low', 'medium', 'high']).optional(),
  openaiDetail: z.enum(['low', 'high', 'auto']).optional(),
  timeoutMs: z.number().int().min(1_000).max(120_000).optional(),
  /** USD per million tokens; from the provider's price page at evaluation time. */
  price: z.strictObject({ inputUsdPerMTok: z.number().min(0), outputUsdPerMTok: z.number().min(0) }).optional(),
})
export type EvalConfig = z.infer<typeof EvalConfig>

export const Matrix = z.strictObject({
  configs: z
    .array(EvalConfig)
    .min(1)
    .refine((c) => new Set(c.map((x) => x.label)).size === c.length, 'duplicate labels'),
})

// ─── Per-item results ───────────────────────────────────────────────────────

export type ItemOutcome =
  | { kind: 'garment'; attributes: GarmentAttributes; rawConfidence: GarmentConfidences; colorVerdict: ColorVerdict }
  | { kind: 'rejected'; subject: Exclude<(typeof SUBJECTS)[number], 'single_garment'> }
  /** Output broke the contract (would be AI_UNAVAILABLE in the app). */
  | { kind: 'invalid' }
  /** Provider error kind (timeout, rate_limited, content_filtered, …). */
  | { kind: 'error'; error: string }

export interface ItemRecord {
  config: string
  provider: string
  model: string
  maxSide: number
  item: string
  latencyMs: number
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
  outcome: ItemOutcome
  /** Per labelled field: correct or not. Only for garment outcomes on single_garment items. */
  fields: Partial<Record<ScoredField, boolean>>
  subjectCorrect: boolean
}

function predicted(attributes: GarmentAttributes, field: ScoredField): string | null {
  if (field === 'primaryColor') return attributes.colors[0] ?? null
  return attributes[field]
}

export function predictedSubject(outcome: ItemOutcome): string | null {
  if (outcome.kind === 'garment') return 'single_garment'
  if (outcome.kind === 'rejected') return outcome.subject
  return null
}

/** Scores one outcome against its labels. */
export function scoreItem(expected: DatasetItem['expected'], outcome: ItemOutcome): Pick<ItemRecord, 'fields' | 'subjectCorrect'> {
  const subjectCorrect = predictedSubject(outcome) === expected.subject
  const fields: Partial<Record<ScoredField, boolean>> = {}
  if (outcome.kind === 'garment' && expected.subject === 'single_garment') {
    for (const f of SCORED_FIELDS) {
      const want = expected[f]
      if (want === undefined) continue
      fields[f] = predicted(outcome.attributes, f) === want
    }
  }
  return { fields, subjectCorrect }
}

// ─── Summary ────────────────────────────────────────────────────────────────

/** Confidence bins for the calibration table: [lo, hi). */
export const CALIBRATION_BINS = [0, 0.5, 0.7, 0.85, 0.95, 1.0001] as const

export interface CalibrationBin {
  range: string
  n: number
  accuracy: number | null
}

export interface ConfigSummary {
  config: string
  provider: string
  model: string
  maxSide: number
  items: number
  subjectAccuracy: number
  /** Share of single_garment items wrongly rejected (user-facing false NOT_A_GARMENT). */
  falseRejectionRate: number | null
  /** Share of non-garment items that were accepted as a garment. */
  falseAcceptanceRate: number | null
  invalidRate: number
  errorRate: number
  fieldAccuracy: Partial<Record<ScoredField, { n: number; accuracy: number }>>
  colorConflictRate: number | null
  latencyMs: { p50: number; p95: number; max: number }
  meanInputTokens: number | null
  meanOutputTokens: number | null
  totalCostUsd: number | null
  costPer1000Usd: number | null
  calibration: CalibrationBin[]
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? sorted[0]
}

const round = (n: number, digits = 4) => Math.round(n * 10 ** digits) / 10 ** digits
const rate = (num: number, den: number) => (den === 0 ? null : round(num / den))
const mean = (xs: number[]) => (xs.length === 0 ? null : round(xs.reduce((a, b) => a + b, 0) / xs.length, 1))

export function summarize(records: ItemRecord[], expectedById: Map<string, DatasetItem['expected']>): ConfigSummary {
  const first = records[0]
  const garments = records.filter((r) => expectedById.get(r.item)?.subject === 'single_garment')
  const others = records.filter((r) => expectedById.get(r.item)?.subject !== 'single_garment')
  const fieldAccuracy: ConfigSummary['fieldAccuracy'] = {}
  for (const f of SCORED_FIELDS) {
    const scored = records.map((r) => r.fields[f]).filter((v): v is boolean => v !== undefined)
    if (scored.length > 0) fieldAccuracy[f] = { n: scored.length, accuracy: round(scored.filter(Boolean).length / scored.length) }
  }
  // Calibration: raw confidence vs correctness over every scored field.
  const points: Array<{ c: number; ok: boolean }> = []
  for (const r of records) {
    if (r.outcome.kind !== 'garment') continue
    for (const [f, ok] of Object.entries(r.fields) as Array<[ScoredField, boolean]>) {
      points.push({ c: r.outcome.rawConfidence[CONFIDENCE_OF[f]], ok })
    }
  }
  const calibration = CALIBRATION_BINS.slice(0, -1).map((lo, i) => {
    const hi = CALIBRATION_BINS[i + 1]
    const inBin = points.filter((p) => p.c >= lo && p.c < hi)
    return { range: `${lo}-${Math.min(hi, 1)}`, n: inBin.length, accuracy: rate(inBin.filter((p) => p.ok).length, inBin.length) }
  })
  const accepted = records.filter((r) => r.outcome.kind === 'garment')
  const costs = records.map((r) => r.costUsd).filter((c): c is number => c !== undefined)
  const totalCost = costs.length === records.length ? round(costs.reduce((a, b) => a + b, 0), 6) : null
  const latencies = records.map((r) => r.latencyMs)
  return {
    config: first.config,
    provider: first.provider,
    model: first.model,
    maxSide: first.maxSide,
    items: records.length,
    subjectAccuracy: round(records.filter((r) => r.subjectCorrect).length / records.length),
    falseRejectionRate: rate(garments.filter((r) => r.outcome.kind === 'rejected').length, garments.length),
    falseAcceptanceRate: rate(others.filter((r) => r.outcome.kind === 'garment').length, others.length),
    invalidRate: round(records.filter((r) => r.outcome.kind === 'invalid').length / records.length),
    errorRate: round(records.filter((r) => r.outcome.kind === 'error').length / records.length),
    fieldAccuracy,
    colorConflictRate: rate(accepted.filter((r) => r.outcome.kind === 'garment' && r.outcome.colorVerdict === 'conflict').length, accepted.length),
    latencyMs: { p50: percentile(latencies, 50), p95: percentile(latencies, 95), max: Math.max(...latencies) },
    meanInputTokens: mean(records.map((r) => r.inputTokens).filter((n): n is number => n !== undefined)),
    meanOutputTokens: mean(records.map((r) => r.outputTokens).filter((n): n is number => n !== undefined)),
    totalCostUsd: totalCost,
    costPer1000Usd: totalCost === null ? null : round((totalCost / records.length) * 1000, 4),
    calibration,
  }
}
