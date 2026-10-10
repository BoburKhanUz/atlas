/**
 * Pure scoring of the outfit-AI evaluation (Phase 4.5). Unit-tested in
 * tests/unit/ai/ai-eval-harness.test.ts.
 */
import type { OutfitCandidate } from '../../src/lib/ai/outfit-engine'
import { inventedGarments, type EvalStatus, kendallTau, leaksPrivate, percentile, rate, uzbekCheck, type UzbekCheck } from './eval-common'

export type OutfitOutcome =
  | { kind: 'ranked'; firstError: string | null; ranking: string[]; explanation: string }
  /** Invalid after the single correction: the app falls back to the deterministic order. */
  | { kind: 'invalid'; firstError: string; finalError: string }
  | { kind: 'error'; error: string }

export interface OutfitChecks {
  firstValid: boolean
  finalValid: boolean
  /** The selected outfit is the engine's best (top-1 agreement). */
  topAgreement: boolean | null
  /** Kendall tau between the AI and the engine order. */
  tau: number | null
  /** The selected outfit's weather fit is within 15 points of the best candidate's. */
  weatherSuitable: boolean | null
  /** Strong profile: the selected outfit's profile fit is at least the candidates' median. */
  profileUsed: boolean | null
  explanationGrounded: boolean | null
  inventedGarments: string[]
  noPrivateLeak: boolean
  noUnsupportedClaims: boolean | null
  uzbek: UzbekCheck | null
}

export interface OutfitRecord {
  case: string
  tags: string[]
  provider: string
  model: string
  candidates: number
  latencyMs: number
  /** Provider attempts, retries and failed attempts included. */
  calls: number
  /** Logical requests: the first, plus the correction when there was one. */
  requests: number
  inputTokens?: number
  outputTokens?: number
  outcome: OutfitOutcome
  checks: OutfitChecks
  pass: boolean
}

export const PROFILE_CLAIM = /(rang profil|kuz mavsumi|bahor mavsumi|yoz mavsumi|qish mavsumi|teri ohangi|undertone)/iu
export const WEATHER_CLAIM = /(ob-havo|harorat|°|daraja|yomg[‘'ʻ’]ir|qor|shamol|issiq kun|sovuq kun|quyoshli)/iu

export interface OutfitCaseContext {
  candidates: OutfitCandidate[]
  weatherProvided: boolean
  /** Whether the colour profile is strong enough to be sent to the model. */
  profileSent: boolean
  profileStrong: boolean
}

export function scoreOutfit(ctx: OutfitCaseContext, outcome: OutfitOutcome): { checks: OutfitChecks; pass: boolean } {
  const refs = ctx.candidates.map((_, i) => `O${i + 1}`)
  if (outcome.kind !== 'ranked') {
    const checks: OutfitChecks = {
      firstValid: false, finalValid: false, topAgreement: null, tau: null, weatherSuitable: null, profileUsed: null,
      explanationGrounded: null, inventedGarments: [], noPrivateLeak: true, noUnsupportedClaims: null, uzbek: null,
    }
    return { checks, pass: false }
  }
  const byRef = new Map(refs.map((r, i) => [r, ctx.candidates[i]]))
  const selected = byRef.get(outcome.ranking[0])!
  const bestWeather = Math.max(...ctx.candidates.map((c) => c.signals.weather ?? 0))
  const profiles = ctx.candidates.map((c) => c.signals.profile ?? 0).sort((a, b) => a - b)
  const median = profiles[Math.floor(profiles.length / 2)]
  const owned = new Set(selected.items.map((i) => i.item.subcategory).filter((s): s is string => !!s))
  const invented = inventedGarments(outcome.explanation, owned)
  const unsupported = (!ctx.weatherProvided && WEATHER_CLAIM.test(outcome.explanation)) || (!ctx.profileSent && PROFILE_CLAIM.test(outcome.explanation))
  const checks: OutfitChecks = {
    firstValid: outcome.firstError === null,
    finalValid: true,
    topAgreement: outcome.ranking[0] === 'O1',
    tau: kendallTau(outcome.ranking, refs),
    weatherSuitable: ctx.weatherProvided ? (selected.signals.weather ?? 0) >= bestWeather - 15 : null,
    profileUsed: ctx.profileStrong ? (selected.signals.profile ?? 0) >= median : null,
    explanationGrounded: invented.length === 0,
    inventedGarments: invented,
    noPrivateLeak: !leaksPrivate(outcome.explanation) && !/\bO\d+\b/.test(outcome.explanation),
    noUnsupportedClaims: !unsupported,
    uzbek: uzbekCheck(outcome.explanation),
  }
  const pass = checks.explanationGrounded === true && checks.noPrivateLeak && checks.noUnsupportedClaims === true && checks.uzbek!.pass && checks.weatherSuitable !== false && checks.profileUsed !== false
  return { checks, pass }
}

export interface OutfitSummary {
  /** TESTED: a live provider answered. OFFLINE_SELF_TEST: scripted provider (harness check, not a provider result). */
  status: EvalStatus
  provider: string
  model: string
  feature: 'outfit'
  cases: number
  passed: number
  failed: number
  schemaValidity: number | null
  finalValidity: number | null
  /** Requests that ended in the deterministic fallback (invalid after correction, or provider error). */
  fallbackRate: number | null
  groundingRate: number | null
  explanationGroundingRate: number | null
  topAgreementRate: number | null
  meanTau: number | null
  weatherSuitability: number | null
  colorProfileUsage: number | null
  uzbekRate: number | null
  latencyP50: number | null
  latencyP95: number | null
  inputTokensP50: number | null
  inputTokensP95: number | null
  outputTokensP50: number | null
  outputTokensP95: number | null
}

export function summarizeOutfit(records: OutfitRecord[], status: EvalStatus = 'TESTED'): OutfitSummary {
  // Offline runs report no latency: a scripted provider's timing says nothing about a provider.
  const timed = status === 'TESTED'
  const ranked = records.filter((r) => r.outcome.kind === 'ranked')
  const known = records.filter((r) => r.outcome.kind !== 'error')
  const firstOk = (r: OutfitRecord) => r.outcome.kind === 'ranked' && r.outcome.firstError === null
  const of = <K extends keyof OutfitChecks>(k: K) => ranked.filter((r) => r.checks[k] !== null)
  const taus = ranked.map((r) => r.checks.tau).filter((t): t is number => t !== null)
  const nums = (f: (r: OutfitRecord) => number | undefined) => records.map(f).filter((v): v is number => v !== undefined)
  const passed = records.filter((r) => r.pass).length
  return {
    status,
    provider: records[0]?.provider ?? '',
    model: records[0]?.model ?? '',
    feature: 'outfit',
    cases: records.length,
    passed,
    failed: records.length - passed,
    schemaValidity: rate(known.filter(firstOk).length, known.length),
    finalValidity: rate(ranked.length, known.length),
    fallbackRate: rate(records.length - ranked.length, records.length),
    groundingRate: rate(ranked.filter((r) => r.checks.noPrivateLeak && r.checks.explanationGrounded).length, ranked.length),
    explanationGroundingRate: rate(ranked.filter((r) => r.checks.explanationGrounded && r.checks.noUnsupportedClaims).length, ranked.length),
    topAgreementRate: rate(ranked.filter((r) => r.checks.topAgreement).length, ranked.length),
    meanTau: taus.length ? Math.round((taus.reduce((a, b) => a + b, 0) / taus.length) * 1000) / 1000 : null,
    weatherSuitability: rate(of('weatherSuitable').filter((r) => r.checks.weatherSuitable).length, of('weatherSuitable').length),
    colorProfileUsage: rate(of('profileUsed').filter((r) => r.checks.profileUsed).length, of('profileUsed').length),
    uzbekRate: rate(ranked.filter((r) => r.checks.uzbek?.pass).length, ranked.length),
    latencyP50: timed ? percentile(nums((r) => r.latencyMs), 50) : null,
    latencyP95: timed ? percentile(nums((r) => r.latencyMs), 95) : null,
    inputTokensP50: percentile(nums((r) => r.inputTokens), 50),
    inputTokensP95: percentile(nums((r) => r.inputTokens), 95),
    outputTokensP50: percentile(nums((r) => r.outputTokens), 50),
    outputTokensP95: percentile(nums((r) => r.outputTokens), 95),
  }
}
