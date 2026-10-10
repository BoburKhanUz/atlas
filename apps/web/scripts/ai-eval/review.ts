/**
 * Shared review status for evaluation results (offline replay, the real-data
 * validation run and the outfit fixture evaluator).
 *
 * Every case keeps its AUTOMATIC verdict (pass / fail, or unscorable when the
 * required rubric metadata is missing). Separately, an output can be flagged
 * for a HUMAN reviewer; a flagged case is never counted as a final pass, and
 * nothing here records a human decision (the human verdict is outside this
 * tooling). See docs/ai/real-data-validation-protocol.md.
 */

/**
 * Why an output needs a human reviewer, whatever its verdict: ambiguous
 * catalog wording (never auto-failed), a borderline Uzbek proxy verdict, or a
 * premise failure after a correct denial (owned alternative vs contradiction).
 */
export function reviewReasons(checks: Record<string, unknown>): string[] {
  const out: string[] = []
  const uz = checks.uzbek as { borderline?: boolean; catalogWording?: { review: string[] } } | null
  if (uz?.catalogWording?.review.length) out.push(`language_review: ${uz.catalogWording.review.join(', ')}`)
  if (uz?.borderline) out.push('uzbek_borderline')
  if (checks.premiseNeedsReview === true) out.push('premise_after_denial')
  return out
}

/**
 * Failure categories, kept apart so a language-policy failure is never
 * confused with a premise, grounding, relevance or isolation failure.
 */
export function failureReasons(feature: 'stylist' | 'outfit', checks: Record<string, unknown>): string[] {
  const out: string[] = []
  const add = (cond: boolean, why: string) => cond && !out.includes(why) && out.push(why)
  if (checks.finalValid === false) return ['validity']
  const uz = checks.uzbek as { latin: boolean; uzbekAlphabet: boolean; uzbek: boolean; englishShare: number; catalogWording?: { pass: boolean } } | null
  add(checks.noPrivateLeak === false, 'private_leak')
  add(checks.grounded === false || checks.explanationGrounded === false, 'grounding')
  add(checks.premiseCorrected === false, 'premise')
  add(checks.premiseCorrected === null && checks.relevant === false, 'relevance')
  add(checks.refsOwned === false || checks.crossUserSafe === false, 'isolation')
  add(checks.requestClean === false, 'injection')
  add(checks.noWeatherClaims === false || checks.noUnsupportedClaims === false, 'unsupported_claim')
  add(checks.refsInRange === false || checks.needsMoreInfo === false, 'expectation')
  add(feature === 'outfit' && (checks.weatherSuitable === false || checks.profileUsed === false), 'context_fit')
  if (uz) {
    add(!uz.latin || !uz.uzbekAlphabet || !uz.uzbek || uz.englishShare > 0.05, 'uzbek_proxy')
    add(uz.catalogWording?.pass === false, 'language_policy')
  }
  return out
}

/**
 * - PASS / FAIL: the automatic verdict, with no review flag;
 * - PENDING_HUMAN_REVIEW: flagged; the automatic verdict is kept next to it and is not final;
 * - UNSCORABLE: required rubric metadata is missing; neither a pass nor a model failure.
 */
export type FinalStatus = 'PASS' | 'FAIL' | 'PENDING_HUMAN_REVIEW' | 'UNSCORABLE'

export interface CaseReview {
  case: string
  automaticVerdict: 'pass' | 'fail' | 'unscorable'
  reviewStatus: 'PENDING_HUMAN_REVIEW' | 'NOT_REQUIRED'
  reviewReasons: string[]
  finalStatus: FinalStatus
  /** Why the case could not be scored (missing rubric metadata). */
  unscorableReason?: string
}

export function reviewCase(caseId: string, pass: boolean, checks: Record<string, unknown>, unscorable?: string): CaseReview {
  const reasons = reviewReasons(checks)
  const automaticVerdict = unscorable ? 'unscorable' : pass ? 'pass' : 'fail'
  const finalStatus: FinalStatus = unscorable ? 'UNSCORABLE' : reasons.length ? 'PENDING_HUMAN_REVIEW' : pass ? 'PASS' : 'FAIL'
  return {
    case: caseId,
    automaticVerdict,
    reviewStatus: reasons.length ? 'PENDING_HUMAN_REVIEW' : 'NOT_REQUIRED',
    reviewReasons: reasons,
    finalStatus,
    ...(unscorable ? { unscorableReason: unscorable } : {}),
  }
}

export interface ReviewSummary {
  cases: number
  automaticPass: number
  automaticFail: number
  unscorable: number
  /** Flagged cases, whatever their automatic verdict (counts: flagged automatic passes and fails). */
  pendingHumanReview: { total: number; automaticPass: number; automaticFail: number }
  /** Final only where no review is pending: finalPass + finalFail + pendingHumanReview.total + unscorable = cases. */
  finalPass: number
  finalFail: number
  /** Review reasons by kind ("language_review", "uzbek_borderline", "premise_after_denial"); a case can count under several. */
  byReason: Record<string, number>
  /** Every flagged or unscorable case, by id. */
  flagged: CaseReview[]
}

export function summarizeReview(reviews: readonly CaseReview[]): ReviewSummary {
  const ids = new Set<string>()
  for (const r of reviews) {
    if (ids.has(r.case)) throw new Error(`duplicate case ${r.case} in a review summary (a case is counted once)`)
    ids.add(r.case)
  }
  const n = (f: (r: CaseReview) => boolean) => reviews.filter(f).length
  const byReason: Record<string, number> = {}
  for (const r of reviews) for (const why of r.reviewReasons) {
    const kind = why.split(':')[0]
    byReason[kind] = (byReason[kind] ?? 0) + 1
  }
  const pending = (v: CaseReview['automaticVerdict']) => n((r) => r.finalStatus === 'PENDING_HUMAN_REVIEW' && r.automaticVerdict === v)
  return {
    cases: reviews.length,
    automaticPass: n((r) => r.automaticVerdict === 'pass'),
    automaticFail: n((r) => r.automaticVerdict === 'fail'),
    unscorable: n((r) => r.finalStatus === 'UNSCORABLE'),
    pendingHumanReview: { total: n((r) => r.finalStatus === 'PENDING_HUMAN_REVIEW'), automaticPass: pending('pass'), automaticFail: pending('fail') },
    finalPass: n((r) => r.finalStatus === 'PASS'),
    finalFail: n((r) => r.finalStatus === 'FAIL'),
    byReason,
    flagged: reviews.filter((r) => r.finalStatus === 'PENDING_HUMAN_REVIEW' || r.finalStatus === 'UNSCORABLE'),
  }
}
