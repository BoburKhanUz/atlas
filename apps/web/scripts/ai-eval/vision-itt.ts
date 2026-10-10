/**
 * Vision INTENTION-TO-TREAT metrics (vision-itt-v1). Added next to the
 * existing metrics, which are unchanged (their field accuracies are computed
 * over accepted garments only, and their subject accuracy in the real-data
 * run over answered cases only).
 *
 * Every ELIGIBLE case of the declared evaluation sample stays in the
 * denominator, whatever happened to it:
 * - eligible = the case is in the declared sample and has a resolved ground
 *   truth subject (a case with no resolved subject is reported as
 *   `ineligible`, never scored);
 * - an error (timeout or any other provider error), a malformed/schema-invalid
 *   output and a missing output count as WRONG for every metric they enter;
 * - a rejection counts as wrong for every field of a single-garment case;
 * - an ACCEPTABLE ABSTENTION (a rejection the frozen case rubric lists for a
 *   non-garment case) makes the subject acceptable, never a successful
 *   garment identification; single-garment cases have no acceptable abstention.
 *
 * Each case lands in exactly one outcome bucket (outcomes sum to `eligible`);
 * duplicate case ids are refused.
 */
import type { SUBJECTS } from '../../src/lib/ai/garment-analysis'
import type { ItemOutcome } from './vision-scoring'

export const VISION_ITT_VERSION = 'vision-itt-v1'

type Subject = (typeof SUBJECTS)[number]
type GarmentOutcome = Extract<ItemOutcome, { kind: 'garment' }>
type Label = string | readonly string[] | null

export interface IttCase {
  id: string
  /** Resolved ground-truth subject; null = no resolved ground truth (ineligible). */
  subject: Subject | null
  /** Rejections the frozen rubric accepts for this (non-garment) case. */
  acceptableAbstentions?: readonly string[]
  /** Labelled fields only (an unlabelled field is not scored); null means "should be null". */
  labels: Readonly<Record<string, Label>>
  /** The stored output; undefined = no output for a declared case (missing). */
  outcome: ItemOutcome | undefined
}

/** correct / total, both shown; rate null when total is 0 (never 0 by default). */
export interface IttCount {
  correct: number
  total: number
  rate: number | null
}
const count = (correct: number, total: number): IttCount => ({ correct, total, rate: total ? Math.round((correct / total) * 10_000) / 10_000 : null })

export interface VisionItt {
  version: typeof VISION_ITT_VERSION
  /** Declared cases with a resolved subject: the denominator of every subject metric. */
  eligible: number
  /** Declared cases without a resolved subject (not scored, reported). */
  ineligible: number
  /** Each eligible case in exactly one bucket; the buckets sum to `eligible`. */
  outcomes: { garment: number; rejected: number; invalid: number; timeout: number; error: number; missing: number }
  /** Predicted subject equals the label / eligible. */
  subjectStrict: IttCount
  /** Correct or an acceptable abstention / eligible. */
  subjectAcceptable: IttCount
  acceptableAbstentions: number
  /** Per labelled field: right value on an accepted garment / eligible single-garment cases with that field labelled. */
  fields: Record<string, IttCount>
  /** Single-garment cases accepted with every labelled field right / eligible single-garment cases. */
  garmentIdentified: IttCount
  /** Subject acceptable and (for a single garment) every labelled field right / eligible. */
  fullyCorrect: IttCount
  /** Non-garment cases accepted as a garment / eligible non-garment cases (errors are not acceptances). */
  falseAcceptance: IttCount
  /** Single-garment cases rejected / eligible single-garment cases (errors are not rejections; they are in `outcomes`). */
  falseRejection: IttCount
  /** Errors, timeouts, invalid and missing outputs, split by the label of the case. */
  notAnswered: { garmentCases: number; nonGarmentCases: number }
}

const bucket = (o: ItemOutcome | undefined): keyof VisionItt['outcomes'] =>
  o === undefined ? 'missing' : o.kind === 'error' ? (o.error === 'timeout' ? 'timeout' : 'error') : o.kind

const same = (p: Label, t: Label) =>
  Array.isArray(t) ? Array.isArray(p) && [...p].sort().join('|') === [...t].sort().join('|') : p === t

export function visionItt(cases: readonly IttCase[], fields: readonly string[], predict: (o: GarmentOutcome, field: string) => Label): VisionItt {
  const seen = new Set<string>()
  for (const c of cases) {
    if (seen.has(c.id)) throw new Error(`duplicate case ${c.id} in the evaluation sample (each case is counted once)`)
    seen.add(c.id)
  }
  const eligible = cases.filter((c) => c.subject !== null)
  const outcomes = { garment: 0, rejected: 0, invalid: 0, timeout: 0, error: 0, missing: 0 }
  const fieldC: Record<string, [number, number]> = Object.fromEntries(fields.map((f) => [f, [0, 0]]))
  let strict = 0, acceptable = 0, abstentions = 0, fully = 0, identified = 0, garmentN = 0, faN = 0, fa = 0, fr = 0
  const notAnswered = { garmentCases: 0, nonGarmentCases: 0 }
  for (const c of eligible) {
    const o = c.outcome
    const b = bucket(o)
    outcomes[b]++
    const answered = b === 'garment' || b === 'rejected'
    const isGarment = c.subject === 'single_garment'
    if (!answered) notAnswered[isGarment ? 'garmentCases' : 'nonGarmentCases']++
    const got = o?.kind === 'garment' ? 'single_garment' : o?.kind === 'rejected' ? o.subject : null
    const correct = got === c.subject
    const abstention = !isGarment && o?.kind === 'rejected' && (c.acceptableAbstentions ?? []).includes(o.subject)
    if (correct) strict++
    if (correct || abstention) acceptable++
    if (abstention && !correct) abstentions++
    if (isGarment) {
      garmentN++
      if (o?.kind === 'rejected') fr++
      let allRight = o?.kind === 'garment'
      for (const f of fields) {
        if (!Object.hasOwn(c.labels, f)) continue
        fieldC[f][1]++
        const ok = o?.kind === 'garment' && same(predict(o, f), c.labels[f])
        if (ok) fieldC[f][0]++
        else allRight = false
      }
      if (allRight) { identified++; fully++ }
    } else {
      faN++
      if (o?.kind === 'garment') fa++
      if (correct || abstention) fully++
    }
  }
  return {
    version: VISION_ITT_VERSION,
    eligible: eligible.length,
    ineligible: cases.length - eligible.length,
    outcomes,
    subjectStrict: count(strict, eligible.length),
    subjectAcceptable: count(acceptable, eligible.length),
    acceptableAbstentions: abstentions,
    fields: Object.fromEntries(fields.map((f) => [f, count(fieldC[f][0], fieldC[f][1])])),
    garmentIdentified: count(identified, garmentN),
    fullyCorrect: count(fully, eligible.length),
    falseAcceptance: count(fa, faN),
    falseRejection: count(fr, garmentN),
    notAnswered,
  }
}
