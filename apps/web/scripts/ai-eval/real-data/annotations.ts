/**
 * Ground truth from independent human annotators (Phase 5.2). Provider output
 * is never ground truth. Each annotator labels each field with a value or
 * "unknown" (never forced to guess) and a confidence; annotators work blind
 * to provider output (attested in the file). Disagreements are kept and
 * resolved only by a separate, recorded adjudication — never overwritten.
 *
 *   final value = all labelling annotators agree         → agreed
 *               | they disagree and an adjudication exists → adjudicated
 *               | they disagree, no adjudication          → unresolved (not scored)
 *               | everyone said unknown / nobody labelled → unknown (not scored)
 *
 * Annotators are opaque codes (A1, A2 …), never names.
 */
import { z } from 'zod'

const CODE = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,31}$/, 'must be an opaque code (e.g. A1)')
const VALUE = z.union([z.string().regex(/^[a-z][a-z0-9_]{0,40}$/, 'must be a catalog value'), z.array(z.string().regex(/^[a-z][a-z0-9_]{0,40}$/)).max(8)])
export const UNKNOWN = 'unknown'

const Label = z.strictObject({ value: VALUE, confidence: z.enum(['high', 'medium', 'low']) })
const Adjudication = z.strictObject({ value: VALUE, by: CODE, reason: z.string().regex(/^[a-z][a-z0-9_]{0,40}$/, 'must be a short reason code') })

export const Annotations = z.strictObject({
  annotationVersion: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
  /** Annotators did not see any provider output before labelling. Required. */
  blindToProvider: z.literal(true),
  annotators: z.array(CODE).min(1).max(10),
  cases: z.record(
    z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/),
    z.strictObject({
      labels: z.record(CODE, z.record(z.string().regex(/^[a-z][A-Za-z]{0,31}$/), Label)),
      adjudication: z.record(z.string().regex(/^[a-z][A-Za-z]{0,31}$/), Adjudication).optional(),
    }),
  ),
})
export type Annotations = z.infer<typeof Annotations>
type Value = z.infer<typeof VALUE>

export type FieldTruth =
  | { status: 'agreed' | 'adjudicated' | 'single'; value: Value; confidence: 'high' | 'medium' | 'low' }
  | { status: 'unresolved' | 'unknown' }

const norm = (v: Value) => (Array.isArray(v) ? [...v].sort().join('|') : v)
const minConfidence = (cs: Array<'high' | 'medium' | 'low'>) => (cs.includes('low') ? 'low' : cs.includes('medium') ? 'medium' : 'high')

/** The final ground truth of one field of one case. */
export function fieldTruth(a: Annotations, caseId: string, field: string): FieldTruth {
  const c = a.cases[caseId]
  if (!c) return { status: 'unknown' }
  const given = a.annotators.map((who) => c.labels[who]?.[field]).filter((l): l is z.infer<typeof Label> => !!l && l.value !== UNKNOWN)
  if (given.length === 0) return { status: 'unknown' }
  const distinct = new Set(given.map((l) => norm(l.value)))
  if (distinct.size === 1) {
    return { status: a.annotators.length === 1 || given.length === 1 ? 'single' : 'agreed', value: given[0].value, confidence: minConfidence(given.map((l) => l.confidence)) }
  }
  const adj = c.adjudication?.[field]
  return adj ? { status: 'adjudicated', value: adj.value, confidence: 'medium' } : { status: 'unresolved' }
}

export interface AgreementStats {
  field: string
  /** Cases where at least two annotators gave a (non-unknown) value. */
  compared: number
  agreed: number
  disagreed: number
  /** Disagreements without an adjudication (not scored). */
  unresolved: number
  /** agreed / compared, null when nothing was compared. */
  agreementRate: number | null
}

export function agreement(a: Annotations, fields: readonly string[]): AgreementStats[] {
  return fields.map((field) => {
    let compared = 0, agreed = 0, unresolved = 0
    for (const [id, c] of Object.entries(a.cases)) {
      const given = a.annotators.map((who) => c.labels[who]?.[field]).filter((l) => !!l && l.value !== UNKNOWN)
      if (given.length < 2) continue
      compared++
      if (new Set(given.map((l) => norm(l!.value))).size === 1) agreed++
      else if (fieldTruth(a, id, field).status === 'unresolved') unresolved++
    }
    return { field, compared, agreed, disagreed: compared - agreed, unresolved, agreementRate: compared ? Math.round((agreed / compared) * 10_000) / 10_000 : null }
  })
}

/** LIMITATION — SINGLE ANNOTATOR when fewer than two annotators labelled the set. */
export function annotationLimitations(a: Annotations): string[] {
  return a.annotators.length < 2 ? ['LIMITATION — SINGLE ANNOTATOR: ground truth is one person\'s labels, not expert consensus'] : []
}

export function parseAnnotations(raw: unknown): Annotations {
  const r = Annotations.safeParse(raw)
  if (!r.success) throw new Error(`invalid annotations: ${r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`)
  for (const [id, c] of Object.entries(r.data.cases)) {
    for (const who of Object.keys(c.labels)) if (!r.data.annotators.includes(who)) throw new Error(`invalid annotations: case ${id} has labels from an undeclared annotator`)
  }
  return r.data
}
