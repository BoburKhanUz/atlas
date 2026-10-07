/**
 * Blind human rubric ratings for stylist answers (Phase 5.2). There is no
 * single correct answer: raters score each dimension 1–5 and the report
 * shows every dimension separately (never one collapsed score), with n.
 *
 * Blinding: raters see answers labelled X1, X2 … only. The key that maps a
 * label to provider/model/run lives in a separate file (outside the
 * repository) and is joined only when the report is built. Raters are opaque
 * codes (R1, R2 …). Without ratings every human dimension is NOT_EVALUATED.
 */
import { z } from 'zod'

export const RUBRIC = ['relevance', 'usefulness', 'completeness', 'uzbekQuality', 'grounding', 'safety'] as const
export type RubricDimension = (typeof RUBRIC)[number]
const SCORE = z.number().int().min(1).max(5)
const CODE = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,31}$/)

export const Ratings = z.strictObject({
  ratingVersion: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
  /** Raters did not know which provider produced an answer. Required. */
  blind: z.literal(true),
  raters: z.array(CODE).min(1).max(20),
  ratings: z
    .array(
      z.strictObject({
        case: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/),
        output: z.string().regex(/^X\d{1,6}$/, 'outputs are blinded labels (X1, X2 …)'),
        rater: CODE,
        scores: z.strictObject(Object.fromEntries(RUBRIC.map((d) => [d, SCORE.nullable()])) as Record<RubricDimension, z.ZodNullable<typeof SCORE>>),
      }),
    )
    .max(100_000),
})
export type Ratings = z.infer<typeof Ratings>

/** Kept apart from the ratings: blinded label → who produced the answer. */
export const BlindingKey = z.strictObject({
  outputs: z.record(z.string().regex(/^X\d{1,6}$/), z.strictObject({ provider: z.enum(['gemini', 'openai']), model: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/), run: z.number().int().min(1) })),
})
export type BlindingKey = z.infer<typeof BlindingKey>

export interface DimensionSummary {
  dimension: RubricDimension
  /** Ratings given (null scores are "could not judge", excluded). */
  n: number
  mean: number | null
  /** Count per score 1..5. */
  distribution: [number, number, number, number, number]
}

export interface RatingSummary {
  status: 'EVALUATED' | 'NOT_EVALUATED'
  raters: number
  /** Per provider, every dimension separately. */
  byProvider: Record<string, DimensionSummary[]>
  /** Same answer rated by ≥ 2 raters: exact agreement and mean absolute difference per dimension. */
  interRater: Array<{ dimension: RubricDimension; pairs: number; exactAgreement: number | null; meanAbsDiff: number | null }>
  limitations: string[]
}

const summarize = (scores: number[], dimension: RubricDimension): DimensionSummary => {
  const distribution: DimensionSummary['distribution'] = [0, 0, 0, 0, 0]
  for (const s of scores) distribution[s - 1]++
  return { dimension, n: scores.length, mean: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100 : null, distribution }
}

export function summarizeRatings(ratings: Ratings | null, key: BlindingKey | null): RatingSummary {
  if (!ratings || !key || ratings.ratings.length === 0) return { status: 'NOT_EVALUATED', raters: 0, byProvider: {}, interRater: [], limitations: ['no blind human ratings: usefulness, completeness and Uzbek quality are NOT_EVALUATED'] }
  const byProvider: RatingSummary['byProvider'] = {}
  for (const provider of [...new Set(Object.values(key.outputs).map((o) => o.provider))].sort()) {
    const rows = ratings.ratings.filter((r) => key.outputs[r.output]?.provider === provider)
    byProvider[provider] = RUBRIC.map((d) => summarize(rows.map((r) => r.scores[d]).filter((s): s is number => s !== null), d))
  }
  const byOutput = new Map<string, Ratings['ratings']>()
  for (const r of ratings.ratings) byOutput.set(r.output, [...(byOutput.get(r.output) ?? []), r])
  const interRater = RUBRIC.map((dimension) => {
    let pairs = 0, exact = 0, diff = 0
    for (const rows of byOutput.values()) {
      const s = rows.map((r) => r.scores[dimension]).filter((x): x is number => x !== null)
      for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) { pairs++; if (s[i] === s[j]) exact++; diff += Math.abs(s[i] - s[j]) }
    }
    return { dimension, pairs, exactAgreement: pairs ? Math.round((exact / pairs) * 10_000) / 10_000 : null, meanAbsDiff: pairs ? Math.round((diff / pairs) * 100) / 100 : null }
  })
  const unmapped = ratings.ratings.filter((r) => !key.outputs[r.output]).length
  return {
    status: 'EVALUATED',
    raters: ratings.raters.length,
    byProvider,
    interRater,
    limitations: [
      ...(ratings.raters.length < 2 ? ['LIMITATION — SINGLE RATER: no inter-rater agreement'] : []),
      ...(unmapped ? [`${unmapped} rating(s) refer to outputs missing from the blinding key (excluded)`] : []),
    ],
  }
}

export function parseRatings(raw: unknown): Ratings {
  const r = Ratings.safeParse(raw)
  if (!r.success) throw new Error(`invalid ratings: ${r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`)
  for (const row of r.data.ratings) if (!r.data.raters.includes(row.rater)) throw new Error('invalid ratings: a rating comes from an undeclared rater')
  return r.data
}
