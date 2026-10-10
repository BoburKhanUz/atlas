/**
 * Dataset-agnostic rubric metadata for stylist evaluation (premise and
 * isolation checks). Every case of a scored dataset needs an explicit
 * declaration of the checks it requires; nothing is inferred from case ids,
 * and nothing falls back to the keyword-relevance proxy for a case that needs
 * a stronger check:
 *
 * - the rubric set is pinned to the dataset identity (version + SHA-256); a
 *   mismatch throws RubricIdentityError before anything is scored;
 * - a case with no declaration, or whose declaration requires a check without
 *   its metadata (a premise without its item/head patterns), is UNSCORABLE:
 *   reported as such, never as a pass and never as a model failure.
 *
 * Built-in sets: the synthetic bake-off cases (synthetic-v1, the v2.1 rubric
 * table) and the constructed realistic corpus (constructed-v1). A future
 * dataset supplies its own set as JSON (parseRubricSet), written by the
 * dataset author and reviewed with the dataset; it never contains personal data.
 *
 * The isolation check is a TEXT HEURISTIC: own references only, no private
 * data, no statement about another person. It is not an authorization or
 * access-control test and does not replace the API-level isolation tests.
 */
import { z } from 'zod'
import { RubricIdentityError, STYLIST_PIN, STYLIST_RUBRIC, type DatasetIdentityRef, type PremiseRubric, type StylistRubric } from './eval-rubric'
import { stylistCases } from './stylist-cases'
import { STYLIST_REALISTIC_VERSION, stylistRealisticCases } from './real-data/stylist-realistic-cases'

export const RUBRIC_KINDS = ['premise', 'isolation'] as const
export type RubricKind = (typeof RUBRIC_KINDS)[number]

/** Shown wherever the isolation check is reported. */
export const ISOLATION_CHECK_KIND = 'HEURISTIC_TEXT_CHECK — not an authorization or access-control test'

export interface CaseRubric {
  /** The checks this case needs (an empty list is an explicit "keyword relevance and the generic checks only"). */
  requires: readonly RubricKind[]
  premise?: PremiseRubric
  isolation?: true
}

export interface RubricSet {
  name: string
  identity: { version: string; sha256: string }
  cases: Readonly<Record<string, CaseRubric>>
}

export type RubricResolution = { status: 'SCORABLE'; rubric: StylistRubric | null } | { status: 'UNSCORABLE'; reason: string }

/** The rubric of one case, or UNSCORABLE with the reason. Throws when the set is for another dataset. */
export function resolveCaseRubric(set: RubricSet, dataset: DatasetIdentityRef, caseId: string): RubricResolution {
  if (dataset.version !== set.identity.version || dataset.sha256 !== set.identity.sha256) throw new RubricIdentityError(`rubric set ${set.name}`, set.identity, dataset)
  const d = Object.hasOwn(set.cases, caseId) ? set.cases[caseId] : undefined
  if (!d) return { status: 'UNSCORABLE', reason: `no rubric declaration for case ${caseId} in ${set.name}` }
  if (d.requires.includes('premise') && !d.premise) return { status: 'UNSCORABLE', reason: `case ${caseId} requires a premise check but declares no premise patterns` }
  if (d.requires.includes('isolation') && !d.isolation) return { status: 'UNSCORABLE', reason: `case ${caseId} requires an isolation check but does not declare it` }
  const rubric: StylistRubric = { ...(d.premise ? { premise: d.premise } : {}), ...(d.isolation ? { isolation: true as const } : {}) }
  return { status: 'SCORABLE', rubric: rubric.premise || rubric.isolation ? rubric : null }
}

/**
 * Checks a rubric set against a case set BEFORE any provider call: throws
 * RubricIdentityError when the set belongs to another dataset (also with no
 * cases), and lists the cases that would be UNSCORABLE.
 */
export function precheckRubricSet(set: RubricSet, dataset: DatasetIdentityRef, caseIds: readonly string[]): Array<{ case: string; reason: string }> {
  if (dataset.version !== set.identity.version || dataset.sha256 !== set.identity.sha256) throw new RubricIdentityError(`rubric set ${set.name}`, set.identity, dataset)
  return caseIds.flatMap((id) => {
    const r = resolveCaseRubric(set, dataset, id)
    return r.status === 'UNSCORABLE' ? [{ case: id, reason: r.reason }] : []
  })
}

// ─── Rubric sets supplied as JSON (future datasets) ─────────────────────────

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const Pattern = z
  .string()
  .min(2)
  .max(200)
  .refine((s) => { try { new RegExp(s); return true } catch { return false } }, 'must be a valid regular expression')
const CaseRubricJson = z.strictObject({
  requires: z.array(z.enum(RUBRIC_KINDS)).max(RUBRIC_KINDS.length).refine((r) => new Set(r).size === r.length, 'duplicate requirement'),
  /** Lower-case patterns matched against the normalised answer (apostrophes as '). */
  premise: z.strictObject({ item: Pattern, head: Pattern, label: z.string().min(1).max(60) }).optional(),
  isolation: z.literal(true).optional(),
})
export const RubricSetJson = z.strictObject({
  rubricSetVersion: z.literal(1),
  name: z.string().regex(SAFE_ID),
  dataset: z.strictObject({ version: z.string().regex(SAFE_ID), sha256: z.string().regex(/^[0-9a-f]{64}$/) }),
  cases: z.record(z.string().regex(SAFE_ID), CaseRubricJson).refine((c) => Object.keys(c).length > 0, 'no case declarations'),
})

/** A rubric set from its JSON file (strict schema; patterns compiled once). */
export function parseRubricSet(json: unknown): RubricSet {
  const r = RubricSetJson.parse(json)
  return {
    name: r.name,
    identity: r.dataset,
    cases: Object.fromEntries(
      Object.entries(r.cases).map(([id, c]) => [
        id,
        {
          requires: c.requires,
          ...(c.premise ? { premise: { item: new RegExp(c.premise.item), head: new RegExp(c.premise.head), label: c.premise.label } } : {}),
          ...(c.isolation ? { isolation: true as const } : {}),
        },
      ]),
    ),
  }
}

// ─── Built-in sets (pinned to frozen case sets) ─────────────────────────────

const declare = (r: StylistRubric | undefined): CaseRubric => ({
  requires: [...(r?.premise ? (['premise'] as const) : []), ...(r?.isolation ? (['isolation'] as const) : [])],
  ...(r ?? {}),
})

let synthetic: RubricSet | null = null
/** The synthetic bake-off cases: every case declared (the v2.1 table; the others require no rubric check). */
export function syntheticStylistRubricSet(): RubricSet {
  synthetic ??= { name: 'synthetic-v1-rubric', identity: STYLIST_PIN, cases: Object.fromEntries(stylistCases().map((c) => [c.id, declare(STYLIST_RUBRIC[c.id])])) }
  return synthetic
}

/** Identity of the constructed realistic corpus (stylist-realistic-cases.ts); verified by a unit test. */
export const REALISTIC_PIN = { version: STYLIST_REALISTIC_VERSION, sha256: 'aa6d7d1b8ce5ce818dedf3550cb50ae6f1161df3e01d06a03ef446d68b3729dd' }
/**
 * Constructed corpus cases that need a stronger check than keyword relevance.
 * lim_ask_missing_item: "Qora kostyumim bilan qaysi tufli yaxshi?" — the
 * wardrobe has no black suit (a navy blazer, grey and black trousers), so the
 * answer must correct the premise. No case of this corpus asks for other
 * users' data, so none requires the isolation check.
 */
const REALISTIC_RUBRIC: Readonly<Record<string, StylistRubric>> = {
  lim_ask_missing_item: { premise: { item: /qora\s+(rangli\s+)?kostyum/, head: /kostyum/, label: 'black suit' } },
}
let realistic: RubricSet | null = null
export function realisticStylistRubricSet(): RubricSet {
  realistic ??= { name: 'constructed-v1-rubric', identity: REALISTIC_PIN, cases: Object.fromEntries(stylistRealisticCases().map((c) => [c.id, declare(REALISTIC_RUBRIC[c.id])])) }
  return realistic
}
