/**
 * Provider bake-off (Phase 4.5; vision and repeated runs Phase 5.0; live
 * accounting, call budget and comparison Phase 5.1): one machine-readable
 * report plus a neutral markdown comparison. See docs/ai/provider-bakeoff.md.
 *
 *   bun scripts/ai-eval/bakeoff.ts --out=<dir outside the repo> \
 *     [--vision-dataset=<dir with labels.json and the photos>] [--runs=N] [--max-calls=N]
 *     [--section=vision|stylist|outfit[,…]]
 *
 * - Live text sections (stylist, outfit): for each provider whose key AND
 *   configured model are in the environment (AI_EVAL_GEMINI_MODEL /
 *   AI_EVAL_OPENAI_MODEL, else AI_LLM_MODEL when AI_LLM_PROVIDER names that
 *   provider), the harnesses run against the live API.
 * - Live vision section: needs the key, a configured vision model
 *   (AI_EVAL_GEMINI_VISION_MODEL / AI_EVAL_OPENAI_VISION_MODEL, else
 *   AI_VISION_MODEL when AI_VISION_PROVIDER names that provider) AND
 *   --vision-dataset. It runs the app's vision pipeline (vision-eval.ts) with
 *   the app's default image settings and records the dataset version.
 * - Anything missing → that section is "NOT_TESTED" with the reason and every
 *   metric null — never estimated. A provider is TESTED only when all three
 *   features are; PARTIALLY_TESTED when some are.
 * - --runs=N (default 1, max 10) repeats the live sections; every run is kept
 *   in `runs` and `aggregate` gives mean/min/max/spread per metric. The
 *   top-level `live` is run 1, so the default output keeps its shape.
 * - Offline sections: the scripted self-tests, the adversarial robustness
 *   suite and the synthetic vision dataset check (no latency: not meaningful).
 *   They are deterministic and computed once.
 * - Phase 5.1: every live section is accounted (attempts, retries, timeouts,
 *   error kinds, latency p50/p95/p99, tokens, cost when a price is configured);
 *   a circuit breaker stops a provider that keeps failing; the upper bound of
 *   provider calls is computed first and refused above --max-calls
 *   (AI_EVAL_MAX_CALLS). Failed cases are listed one by one, never only
 *   averaged. The CLI defaults to 3 runs when a live section can run.
 * - The report never selects a provider: providerDecision is always
 *   NO FINAL PROVIDER SELECTED.
 *
 * Keys are read from the environment only and never written anywhere.
 */
import { promises as fs } from 'fs'
import path from 'path'
import { GeminiProvider } from '../../src/lib/ai/providers/gemini'
import { OpenAIProvider } from '../../src/lib/ai/providers/openai'
import type { LLMProvider, VisionProvider } from '../../src/lib/ai/providers/types'
import { arg, assertOutsideRepo, llmProviderFromEnv, type EvalProviderName, type EvalStatus } from './eval-common'
import { outfitCases } from './outfit-cases'
import { runOutfitCase, ScriptedOutfit } from './outfit-eval'
import { summarizeOutfit, type OutfitRecord, type OutfitSummary } from './outfit-scoring'
import { runRobustness, type RobustnessResult } from './robustness'
import { stylistCases } from './stylist-cases'
import { runStylistCase, ScriptedStylist } from './stylist-eval'
import { summarizeStylist, type StylistRecord, type StylistSummary } from './stylist-scoring'
import { syntheticVisionItems } from './synthetic-vision'
import { isBudgetablePrice, isOpenAIPatchModel } from './cost-bounds'
import { accountSection, assertCapForLive, DatasetIntegrityError, sha256Hex, assertWithinCap, CallBudget, CallLedger, caseResult, caseSetIdentity, configuredPrice, COST_UNAVAILABLE, costAccounting, type BudgetStopReason, type CostAccounting, countedLLM, latencyStats, parseMaxCalls, parseMaxCost, planCalls, priceSource, retryingVision, visionDatasetIdentity, type CallPlan, type CaseResult, type DatasetIdentity, type LatencyStats, type LiveFeature, type SectionAccounting } from './live-accounting'
import { evaluateVisionConfig } from './vision-eval'
import { Dataset, type ConfigSummary, type EvalConfig, type ItemRecord } from './vision-scoring'

export const NO_SELECTION = 'NO FINAL PROVIDER SELECTED — LIVE BAKE-OFF REQUIRED'
/** Phase 5.1: the bake-off collects evidence; the provider decision is a separate, approval-gated step. */
export const PROVIDER_DECISION = 'NO FINAL PROVIDER SELECTED'
export const DATASET_INTEGRITY_FAILURE = 'DATASET_INTEGRITY_FAILURE'
/** Shown instead of a live result when the providers were injected (tests): never a provider result. */
export const TEST_ONLY = 'TEST_ONLY'
export const STYLIST_CASES_VERSION = 'synthetic-v1'
export const OUTFIT_CASES_VERSION = 'synthetic-v1'

type Env = Record<string, string | undefined>
const KEY: Record<EvalProviderName, string> = { gemini: 'GEMINI_API_KEY', openai: 'OPENAI_API_KEY' }
const MODEL: Record<EvalProviderName, string> = { gemini: 'AI_EVAL_GEMINI_MODEL', openai: 'AI_EVAL_OPENAI_MODEL' }
const VISION_MODEL: Record<EvalProviderName, string> = { gemini: 'AI_EVAL_GEMINI_VISION_MODEL', openai: 'AI_EVAL_OPENAI_VISION_MODEL' }
export const MAX_RUNS = 10

export interface NotTested {
  status: EvalStatus
  provider: string
  model: string | null
  feature: 'vision' | 'stylist' | 'outfit'
  reason: string
  cases: number
  passed: number | null
  failed: number | null
  schemaValidity: null
  groundingRate: null
  latencyP50: null
  latencyP95: null
}

/** A live vision result: the app's pipeline over a labelled dataset. Rates are 0..1. */
export interface VisionSummary {
  status: 'TESTED'
  provider: string
  model: string
  feature: 'vision'
  datasetVersion: string | null
  cases: number
  /** Items whose subject (garment / no garment / unclear / …) was right. */
  passed: number
  failed: number
  /** Answers that met the output contract (1 − invalid − provider errors). */
  schemaValidity: number
  subjectAccuracy: number
  falseRejectionRate: number | null
  falseAcceptanceRate: number | null
  categoryAccuracy: number | null
  primaryColorAccuracy: number | null
  invalidRate: number
  errorRate: number
  /** Items that ended in an invalid output or a provider error. */
  failures: number
  timeouts: number
  groundingRate: null
  /** Canonical accounting latency (latencyStats): null when the sample is too small for the percentile. */
  latencyP50: number | null
  latencyP95: number | null
  latencyMax: number | null
  meanInputTokens: number | null
  meanOutputTokens: number | null
}

export type FeatureResult = StylistSummary | OutfitSummary | VisionSummary | NotTested

export interface LiveProvider {
  provider: EvalProviderName
  status: EvalStatus
  model: string | null
  visionModel: string | null
  /** Null when TESTED; otherwise every section's reason, joined. */
  reason: string | null
  features: FeatureResult[]
  /** Phase 5.1: one entry per TESTED feature (content-free). */
  accounting: SectionAccounting[]
  /** Phase 5.1: every failed case, by synthetic case id and failed check names. */
  failures: CaseFailure[]
}

export interface CaseFailure {
  feature: LiveFeature
  case: string
  /** Names of the failed checks (or the error kind); never content. */
  failed: string[]
  /** The case is a prompt-injection case: any failure here is a safety failure. */
  injection: boolean
}

export interface MetricAggregate {
  /** TESTED runs that reported the metric. */
  n: number
  mean: number
  min: number
  max: number
  /** max − min. */
  spread: number
}

export interface BakeoffOptions {
  /** Labelled vision dataset directory (labels.json + photos). Without it vision is NOT_TESTED. */
  visionDataset?: string
  /** Repeat the live sections (1..MAX_RUNS, default 1). */
  runs?: number
  /** Upper bound of provider calls over all runs (--max-calls / AI_EVAL_MAX_CALLS); null = no cap. */
  maxCalls?: number | null
  /** Estimated-cost cap in USD (--max-cost-usd / AI_EVAL_MAX_COST_USD); needs configured prices. */
  maxCostUsd?: number | null
  /** Clock for the run timestamps; without it the report has none (deterministic). */
  now?: () => Date
  /** Retry wait (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>
  /** Provider factories (tests inject scripted providers; the default builds the real ones). */
  providers?: {
    llm?: (provider: EvalProviderName, model: string, env: Env) => LLMProvider
    vision?: (provider: EvalProviderName, model: string, env: Env) => VisionProvider
  }
  /**
   * Live sections to run (--section); default all three. An unselected section
   * is planned at zero calls and reported NOT_TESTED (not selected).
   */
  sections?: LiveFeature[]
  /**
   * Collector for per-case model outputs (filled when given). Only synthetic
   * cases are collected: a real dataset's outputs are never kept (governance).
   */
  rawOutputs?: RawOutput[]
}

/**
 * One case's model output and the checks it was scored with, for failure
 * analysis. Written next to the report (raw-outputs.json), never inside it.
 * Synthetic data only; holds no credentials, prompts or request bodies.
 */
export interface RawOutput {
  run: number
  provider: EvalProviderName
  model: string
  feature: LiveFeature
  datasetKind: 'synthetic'
  case: string
  /** Vision: the labels the case was scored against. */
  expected?: unknown
  /** The parsed outcome as scored (stylist: the model's answer and the text shown to the user). */
  output: unknown
  checks: unknown
}

export const ALL_SECTIONS: readonly LiveFeature[] = ['vision', 'stylist', 'outfit']
export const NOT_SELECTED = 'not selected (--section)'

/** A non-empty list of known sections without repeats, in the canonical order. */
export function validateSections(list: readonly string[]): LiveFeature[] {
  if (list.length === 0) throw new Error(`--section needs at least one of ${ALL_SECTIONS.join(', ')}`)
  const unknown = list.filter((x) => !(ALL_SECTIONS as readonly string[]).includes(x))
  if (unknown.length) throw new Error(`--section: unknown section ${unknown.map((x) => JSON.stringify(x)).join(', ')} (use ${ALL_SECTIONS.join(', ')})`)
  if (new Set(list).size !== list.length) throw new Error('--section: a section is listed twice')
  return ALL_SECTIONS.filter((x) => list.includes(x))
}

/** --section=<a>[,<b>…]; absent → undefined (every section). Checked before any provider is built. */
export function parseSections(raw: string | undefined): LiveFeature[] | undefined {
  if (raw === undefined) return undefined
  if (raw.trim() === '') throw new Error(`--section needs at least one of ${ALL_SECTIONS.join(', ')}`)
  return validateSections(raw.split(',').map((x) => x.trim()))
}

const sectionsOf = (opts: BakeoffOptions): readonly LiveFeature[] => (opts.sections ? validateSections(opts.sections) : ALL_SECTIONS)

export interface BakeoffReport {
  harnessVersion: 2
  /** Always NO FINAL PROVIDER SELECTED. */
  providerDecision: typeof PROVIDER_DECISION
  /** Phase 5.1: call budget, its use, dataset integrity and timestamps (null without a clock). */
  execution: {
    generatedAt: string | null
    /** "real" (the CLI's providers ran), TEST_ONLY (injected scripted providers: never a provider result), or "none" (nothing ran live). */
    providerSource: 'real' | typeof TEST_ONLY | 'none'
    plan: CallPlan
    /** The live sections selected (--section); every section by default. */
    sections: LiveFeature[]
    budget: {
      attemptsUsed: number
      /** Provider-reported cost (configured price × reported tokens), as before the reservations. */
      costSpentUsd: number | typeof COST_UNAVAILABLE
      exhausted: BudgetStopReason | null
      /** Why the budget stopped (no content); null while it has not. */
      stopDetail: string | null
      /** Pre-request reservations vs provider-reported cost; the estimates are not a guaranteed maximum charge. */
      costAccounting: CostAccounting
    }
    integrity: { status: 'OK' | typeof DATASET_INTEGRITY_FAILURE; checks: number }
    runTimes: Array<{ run: number; startedAt: string | null; finishedAt: string | null }>
  }
  /** Phase 5.1: identity of every frozen dataset used. */
  datasets: { vision: DatasetIdentity | null; stylist: DatasetIdentity; outfit: DatasetIdentity }
  /** Phase 5.1: what synthetic data cannot show. */
  realWorld: { clothingDataset: string; selfieDataset: string; uzbekHumanRating: string; legalReview: string; pricing: string }
  /** Phase 5.1: neutral comparison; NOT_TESTED / N/A where there is no evidence. */
  comparison: Array<{ dimension: string; gemini: string; openai: string }>
  /** Run 1 (the only run by default). */
  live: LiveProvider[]
  /** Present when runs > 1: every run, unhidden, identified by its number. */
  runs?: Array<{ run: number; live: LiveProvider[] }>
  /** Present when runs > 1: per provider, feature and numeric metric, over the TESTED runs. */
  aggregate?: Array<{ provider: EvalProviderName; feature: FeatureResult['feature']; testedRuns: number; metrics: Record<string, MetricAggregate>; pooledLatencyMs: LatencyStats }>
  offline: {
    stylist: StylistSummary
    outfit: OutfitSummary
    robustness: { status: EvalStatus; cases: number; passed: number; failed: number; results: RobustnessResult[] }
    visionDataset: { status: 'OFFLINE_DATASET_ONLY'; cases: number; subjects: Record<string, number>; categories: Record<string, number> }
  }
  recommendation: string
}

/** The configured model for `provider`, or null. Never a built-in default. */
export function configuredModel(provider: EvalProviderName, env: Env): string | null {
  const explicit = env[MODEL[provider]]?.trim()
  if (explicit) return explicit
  return env.AI_LLM_PROVIDER?.trim().toLowerCase() === provider ? env.AI_LLM_MODEL?.trim() || null : null
}

/** The configured vision model for `provider`, or null. Never a built-in default. */
export function configuredVisionModel(provider: EvalProviderName, env: Env): string | null {
  const explicit = env[VISION_MODEL[provider]]?.trim()
  if (explicit) return explicit
  return env.AI_VISION_PROVIDER?.trim().toLowerCase() === provider ? env.AI_VISION_MODEL?.trim() || null : null
}

const notTested = (provider: string, model: string | null, feature: NotTested['feature'], reason: string): NotTested => ({
  status: 'NOT_TESTED', provider, model, feature, reason, cases: 0, passed: null, failed: null, schemaValidity: null, groundingRate: null, latencyP50: null, latencyP95: null,
})

const count = (values: string[]) => Object.fromEntries([...new Set(values)].sort().map((v) => [v, values.filter((x) => x === v).length]))

export function realVision(provider: EvalProviderName, model: string, env: Env): VisionProvider {
  const apiKey = env[KEY[provider]]!.trim()
  return provider === 'gemini' ? new GeminiProvider({ apiKey, model }) : new OpenAIProvider({ apiKey, model })
}

/** The app's default vision settings (src/lib/ai/config.ts), so the bake-off measures what users would get. */
export function bakeoffVisionConfig(provider: EvalProviderName, model: string): EvalConfig {
  return provider === 'gemini'
    ? { label: 'gemini-bakeoff', provider, model, maxSide: 1024, geminiMediaResolution: 'high', geminiThinkingLevel: 'low' }
    : { label: 'openai-bakeoff', provider, model, maxSide: 1024, openaiDetail: 'high' }
}

export function visionSummary(summary: ConfigSummary, records: ItemRecord[], datasetVersion: string | null): VisionSummary {
  const passed = records.filter((r) => r.subjectCorrect).length
  const failures = records.filter((r) => r.outcome.kind === 'invalid' || r.outcome.kind === 'error').length
  return {
    status: 'TESTED',
    provider: summary.provider,
    model: summary.model,
    feature: 'vision',
    datasetVersion,
    cases: summary.items,
    passed,
    failed: summary.items - passed,
    schemaValidity: Math.round((1 - summary.invalidRate - summary.errorRate) * 10_000) / 10_000,
    subjectAccuracy: summary.subjectAccuracy,
    falseRejectionRate: summary.falseRejectionRate,
    falseAcceptanceRate: summary.falseAcceptanceRate,
    categoryAccuracy: summary.fieldAccuracy.category?.accuracy ?? null,
    primaryColorAccuracy: summary.fieldAccuracy.primaryColor?.accuracy ?? null,
    invalidRate: summary.invalidRate,
    errorRate: summary.errorRate,
    failures,
    timeouts: records.filter((r) => r.outcome.kind === 'error' && r.outcome.error === 'timeout').length,
    groundingRate: null,
    latencyP50: summary.latencyMs.p50,
    latencyP95: summary.latencyMs.p95,
    latencyMax: summary.latencyMs.max,
    meanInputTokens: summary.meanInputTokens,
    meanOutputTokens: summary.meanOutputTokens,
  }
}

/**
 * Every report section reads latency from the section's accounting
 * (latencyStats), never from the per-feature scorers: their nearest-rank
 * percentile has no sample-size threshold, so with few samples it reports the
 * maximum as p95.
 */
export function withAccountedLatency(f: FeatureResult, accounting: SectionAccounting[]): FeatureResult {
  const a = accounting.find((x) => x.feature === f.feature)
  if (f.status !== 'TESTED' || !a) return f
  const latency = { latencyP50: a.latencyMs.p50, latencyP95: a.latencyMs.p95 }
  return f.feature === 'vision' ? { ...(f as VisionSummary), ...latency, latencyMax: a.latencyMs.max } : { ...(f as StylistSummary | OutfitSummary), ...latency }
}

interface VisionData {
  dir: string
  version: string | null
  items: Dataset['items']
  identity: DatasetIdentity
}

async function loadVisionDataset(dir: string): Promise<VisionData> {
  const labels = Dataset.parse(JSON.parse(await fs.readFile(path.join(dir, 'labels.json'), 'utf8')))
  return { dir, version: labels.version ?? null, items: labels.items, identity: await visionDatasetIdentity(dir, labels) }
}

interface Eligibility {
  provider: EvalProviderName
  model: string | null
  visionModel: string | null
  visionReason: string | null
  textReason: string | null
}

/** Which live sections can run, decided before any call (credentials, models and dataset only). */
function eligibility(env: Env, vision: VisionData | null, sections: readonly LiveFeature[] = ALL_SECTIONS): Eligibility[] {
  return (['gemini', 'openai'] as const).map((provider) => {
    const model = configuredModel(provider, env)
    const visionModel = configuredVisionModel(provider, env)
    const noKey = !env[KEY[provider]]?.trim() ? `no ${KEY[provider]} in the environment` : null
    return {
      provider,
      model,
      visionModel,
      textReason: noKey ?? (!model ? `no configured model (${MODEL[provider]} or AI_LLM_MODEL)` : null),
      visionReason: !sections.includes('vision') ? NOT_SELECTED : noKey ?? (!visionModel ? `no configured vision model (${VISION_MODEL[provider]} or AI_VISION_MODEL)` : !vision ? 'no labelled vision dataset (--vision-dataset)' : null),
    }
  })
}

/** CIRCUIT_BREAK / BUDGET_STOP for cases refused locally, else the provider error kind. */
const errorLabel = (c: CaseResult, kind: string | undefined) =>
  c.status === 'circuit_break' ? 'CIRCUIT_BREAK' : c.status === 'budget_stop' ? 'BUDGET_STOP' : `error:${c.errorKind ?? kind ?? 'unexpected'}`

const visionFailed = (r: ItemRecord, c: CaseResult): string[] => {
  if (r.outcome.kind === 'error') return [errorLabel(c, r.outcome.error)]
  if (r.outcome.kind === 'invalid') return ['schema']
  return [...(r.subjectCorrect ? [] : ['subject']), ...Object.entries(r.fields).filter(([, ok]) => !ok).map(([f]) => f)]
}

const textFailed = (r: StylistRecord | OutfitRecord, c: CaseResult): string[] => {
  if (r.outcome.kind === 'error') return [errorLabel(c, r.outcome.error)]
  const failed = Object.entries(r.checks).filter(([k, v]) => v === false && k !== 'topAgreement').map(([k]) => k)
  const uzbek = (r.checks as { uzbek?: { pass: boolean } | null }).uzbek
  if (uzbek && !uzbek.pass) failed.push('uzbek_proxy')
  if (r.outcome.kind === 'invalid') failed.unshift('final_validity')
  return failed.length ? failed : ['case']
}

/** Re-hashes the frozen datasets before every live section; a change stops every later provider call. */
class IntegrityGuard {
  ok = true
  checks = 0
  /** Reads one vision image and checks it against its frozen hash first: a changed image is never sent. */
  readImage = async (file: string): Promise<Uint8Array> => {
    const bytes = new Uint8Array(await fs.readFile(file))
    const v = this.expected.vision
    if (!this.ok || !v || v.identity.files?.[path.relative(v.dir, file)] !== sha256Hex(bytes)) {
      this.ok = false
      throw new DatasetIntegrityError()
    }
    return bytes
  }
  constructor(private readonly expected: { vision: VisionData | null; stylist: string; outfit: string }) {}
  async check(): Promise<boolean> {
    if (!this.ok) return false
    this.checks++
    const v = this.expected.vision
    let visionNow: string | null = null
    if (v) {
      try {
        visionNow = (await visionDatasetIdentity(v.dir, await readLabels(v.dir))).sha256
      } catch {
        visionNow = 'unreadable'
      }
    }
    const same = (!v || visionNow === v.identity.sha256) && caseHash(stylistCases()) === this.expected.stylist && caseHash(outfitCases()) === this.expected.outfit
    if (!same) this.ok = false
    return this.ok
  }
}

async function readLabels(dir: string) {
  return JSON.parse(await fs.readFile(path.join(dir, 'labels.json'), 'utf8'))
}

async function liveRun(env: Env, vision: VisionData | null, opts: BakeoffOptions, budget: CallBudget, guard: IntegrityGuard, run: number): Promise<LiveProvider[]> {
  const llm = opts.providers?.llm ?? ((provider, model, e) => llmProviderFromEnv(provider, model, e))
  const visionFactory = opts.providers?.vision ?? realVision
  const live: LiveProvider[] = []
  const sections = sectionsOf(opts)
  const textSelected = sections.includes('stylist') || sections.includes('outfit')
  for (const elig of eligibility(env, vision, sections)) {
    const { provider, model, visionModel } = elig
    // A changed dataset stops every later section: no provider call on data that is no longer the frozen set.
    const visionReason = elig.visionReason ?? ((await guard.check()) ? null : DATASET_INTEGRITY_FAILURE)
    let textReason = elig.textReason
    const accounting: SectionAccounting[] = []
    const failures: CaseFailure[] = []

    let visionResult: FeatureResult
    if (visionReason) visionResult = notTested(provider, visionModel, 'vision', visionReason)
    else {
      const price = configuredPrice(provider, visionModel, 'vision', env)
      const ledger = new CallLedger(budget, price)
      const p = retryingVision(visionFactory(provider, visionModel!, env), ledger, opts.sleep)
      const results = new Map<string, CaseResult>()
      try {
        const { records, summary } = await evaluateVisionConfig(
          p,
          bakeoffVisionConfig(provider, visionModel!),
          vision!.dir,
          vision!.items,
          (r) => {
            results.set(r.item, caseResult(r.latencyMs, 1, r.outcome, ledger.endCase()))
          },
          guard.readImage,
        )
        visionResult = visionSummary(summary, records, vision!.version)
        if (opts.rawOutputs && vision!.identity.kind === 'synthetic') {
          const expected = new Map(vision!.items.map((i) => [i.id, i.expected]))
          for (const r of records) {
            opts.rawOutputs.push({ run, provider, model: visionModel!, feature: 'vision', datasetKind: 'synthetic', case: r.item, expected: expected.get(r.item), output: r.outcome, checks: { subjectCorrect: r.subjectCorrect, fields: r.fields } })
          }
        }
        for (const r of records) {
          const failed = visionFailed(r, results.get(r.item)!)
          if (failed.length) failures.push({ feature: 'vision', case: r.item, failed, injection: false })
        }
      } catch (err) {
        if (!(err instanceof DatasetIntegrityError)) throw err
        // Stopped mid-section: no quality numbers from a changed dataset; what was spent stays visible.
        visionResult = notTested(provider, visionModel, 'vision', DATASET_INTEGRITY_FAILURE)
      }
      accounting.push(accountSection('vision', ledger, [...results.values()], price, price ? priceSource('vision') : null))
    }
    if (textSelected && !textReason && !(await guard.check())) textReason = DATASET_INTEGRITY_FAILURE

    let stylist: FeatureResult, outfit: FeatureResult
    if (!textSelected || textReason) {
      stylist = notTested(provider, model, 'stylist', sections.includes('stylist') ? textReason! : NOT_SELECTED)
      outfit = notTested(provider, model, 'outfit', sections.includes('outfit') ? textReason! : NOT_SELECTED)
    } else {
      const base = llm(provider, model!, env)
      const price = configuredPrice(provider, model, 'llm', env)
      const text = async <R extends StylistRecord | OutfitRecord>(feature: 'stylist' | 'outfit', cases: Array<{ id: string }>, runCase: (p: LLMProvider, c: never) => Promise<R>) => {
        const ledger = new CallLedger(budget, price)
        const p = countedLLM(base, ledger)
        const records: R[] = []
        const results: CaseResult[] = []
        for (const c of cases) {
          const r = await runCase(p, c as never)
          records.push(r)
          results.push(caseResult(r.latencyMs, r.requests, r.outcome, ledger.endCase()))
        }
        accounting.push(accountSection(feature, ledger, results, price, price ? priceSource('llm') : null))
        records.forEach((r, i) => {
          if (!r.pass) failures.push({ feature, case: r.case, failed: textFailed(r, results[i]), injection: r.tags.includes('injection') })
          // The stylist and outfit case sets are synthetic by construction.
          opts.rawOutputs?.push({ run, provider, model: model!, feature, datasetKind: 'synthetic', case: r.case, output: r.outcome, checks: r.checks })
        })
        return records
      }
      stylist = sections.includes('stylist') ? summarizeStylist(await text('stylist', stylistCases(), runStylistCase), 'TESTED') : notTested(provider, model, 'stylist', NOT_SELECTED)
      outfit = sections.includes('outfit') ? summarizeOutfit(await text('outfit', outfitCases(), runOutfitCase), 'TESTED') : notTested(provider, model, 'outfit', NOT_SELECTED)
    }

    const features = [visionResult, stylist, outfit].map((f) => withAccountedLatency(f, accounting))
    const tested = features.filter((f) => f.status === 'TESTED').length
    const textNote = textSelected ? textReason : NOT_SELECTED
    const unselectedText = textSelected && !(sections.includes('stylist') && sections.includes('outfit')) ? NOT_SELECTED : null
    const reasons = [...new Set([visionReason, textNote, unselectedText].filter((r): r is string => r !== null))]
    live.push({
      provider,
      status: tested === features.length ? 'TESTED' : tested === 0 ? 'NOT_TESTED' : 'PARTIALLY_TESTED',
      model,
      visionModel,
      reason: reasons.length ? reasons.join('; ') : null,
      features,
      accounting,
      failures,
    })
  }
  return live
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000

/** Mean/min/max/spread of every numeric top-level metric, over the runs where the feature was TESTED. */
export function aggregateRuns(runs: Array<{ run: number; live: LiveProvider[] }>): NonNullable<BakeoffReport['aggregate']> {
  const out: NonNullable<BakeoffReport['aggregate']> = []
  for (const provider of ['gemini', 'openai'] as const) {
    for (const feature of ['vision', 'stylist', 'outfit'] as const) {
      const sections = runs
        .map((r) => r.live.find((l) => l.provider === provider)?.features.find((f) => f.feature === feature))
        .filter((f): f is FeatureResult => f !== undefined && f.status === 'TESTED')
      const metrics: Record<string, MetricAggregate> = {}
      const keys = [...new Set(sections.flatMap((f) => Object.keys(f)))].sort()
      for (const key of keys) {
        const values = sections.map((f) => (f as unknown as Record<string, unknown>)[key]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
        if (values.length === 0) continue
        const min = Math.min(...values), max = Math.max(...values)
        metrics[key] = { n: values.length, mean: round4(values.reduce((a, b) => a + b, 0) / values.length), min, max, spread: round4(max - min) }
      }
      const latencies = runs.flatMap((r) => r.live.find((l) => l.provider === provider)?.accounting.find((a) => a.feature === feature)?.latenciesMs ?? [])
      out.push({ provider, feature, testedRuns: sections.length, metrics, pooledLatencyMs: latencyStats(latencies) })
    }
  }
  return out
}

const pct = (v: unknown) => (typeof v === 'number' ? `${(v * 100).toFixed(1)} %` : 'N/A')
const ms = (v: unknown) => (typeof v === 'number' ? `${Math.round(v)} ms` : 'N/A')

/**
 * Neutral comparison rows. Values are run 1, or the mean over the TESTED runs
 * when there are several. A provider or feature without evidence reads
 * NOT_TESTED; a dimension the harness does not measure reads N/A.
 */
export function compare(live: LiveProvider[], aggregate?: BakeoffReport['aggregate'], testOnly = false): BakeoffReport['comparison'] {
  const cell = (provider: EvalProviderName, feature: LiveFeature, key: string, fmt: (v: unknown) => string) => {
    const l = live.find((x) => x.provider === provider)!
    const f = l.features.find((x) => x.feature === feature)!
    if (f.status !== 'TESTED') return 'NOT_TESTED'
    const agg = aggregate?.find((a) => a.provider === provider && a.feature === feature)?.metrics[key]
    const runs = aggregate?.find((a) => a.provider === provider && a.feature === feature)?.testedRuns ?? 1
    return agg && runs > 1 ? `${fmt(agg.mean)} (mean of ${runs} runs, spread ${fmt(agg.spread)})` : fmt((f as unknown as Record<string, unknown>)[key])
  }
  const acct = (provider: EvalProviderName, f: (a: SectionAccounting[]) => string) => {
    const a = live.find((x) => x.provider === provider)!.accounting
    return a.length ? f(a) : 'NOT_TESTED'
  }
  // Injected scripted providers: every measured cell is marked, so it can never be read as a provider result.
  const mark = (v: string) => (testOnly && /\d/.test(v) ? `${TEST_ONLY} ${v}` : v)
  const row = (dimension: string, value: (p: EvalProviderName) => string) => ({ dimension, gemini: mark(value('gemini')), openai: mark(value('openai')) })
  const join = (p: EvalProviderName, parts: Array<[string, LiveFeature, string, (v: unknown) => string]>) => parts.map(([label, f, k, fmt]) => `${label} ${cell(p, f, k, fmt)}`).join(' · ')
  return [
    row('Vision quality (category / subject accuracy)', (p) => join(p, [['category', 'vision', 'categoryAccuracy', pct], ['subject', 'vision', 'subjectAccuracy', pct]])),
    row('Vision false acceptance / rejection', (p) => join(p, [['FA', 'vision', 'falseAcceptanceRate', pct], ['FR', 'vision', 'falseRejectionRate', pct]])),
    row('Vision schema validity', (p) => cell(p, 'vision', 'schemaValidity', pct)),
    row('Stylist validity (final)', (p) => cell(p, 'stylist', 'finalValidity', pct)),
    row('Uzbek quality (native raters)', () => 'NOT_EVALUATED'),
    row('Uzbek proxy (automatic)', (p) => join(p, [['stylist', 'stylist', 'uzbekRate', pct], ['outfit', 'outfit', 'uzbekRate', pct]])),
    row('Grounding', (p) => join(p, [['stylist', 'stylist', 'groundingRate', pct], ['outfit', 'outfit', 'groundingRate', pct]])),
    row('Hallucinated items (stylist)', (p) => cell(p, 'stylist', 'hallucinationRate', pct)),
    row('Injection robustness (stylist)', (p) => cell(p, 'stylist', 'injectionResistance', pct)),
    row('Outfit fallback rate', (p) => cell(p, 'outfit', 'fallbackRate', pct)),
    row('Latency p50', (p) => join(p, [['V', 'vision', 'latencyP50', ms], ['S', 'stylist', 'latencyP50', ms], ['O', 'outfit', 'latencyP50', ms]])),
    row('Latency p95', (p) => join(p, [['V', 'vision', 'latencyP95', ms], ['S', 'stylist', 'latencyP95', ms], ['O', 'outfit', 'latencyP95', ms]])),
    row('Success / failure rate of attempted cases (run 1)', (p) => acct(p, (a) => a.map((x) => `${x.feature} ${pct(x.successRate)} / ${pct(x.failureRate)}`).join(' · '))),
    row('Timeouts / failed attempts / attempts (run 1)', (p) => acct(p, (a) => a.map((x) => `${x.feature} ${x.timeouts}/${Object.values(x.attemptErrors).reduce((n, v) => n + v, 0)}/${x.attempts}`).join(' · '))),
    row('Retries / corrections / circuit-broken cases (run 1)', (p) => acct(p, (a) => a.map((x) => `${x.feature} ${x.retries}/${x.corrections}/${x.circuitBreakCases}`).join(' · '))),
    row('Token usage (run 1, in/out)', (p) => acct(p, (a) => a.map((x) => (x.tokens.attemptsReporting ? `${x.feature} ${x.tokens.input}/${x.tokens.output}` : `${x.feature} N/A`)).join(' · '))),
    row('Estimated cost (run 1)', (p) => acct(p, (a) => a.map((x) => `${x.feature} ${x.costUsd === COST_UNAVAILABLE ? COST_UNAVAILABLE : `$${x.costUsd}`}`).join(' · '))),
    row('Operational complexity', () => 'N/A — not measured (see docs/ai/provider-bakeoff.md)'),
    row('Privacy / data controls', () => 'N/A — documented terms only; legal review PENDING'),
  ]
}

/** The neutral markdown summary written next to bakeoff.json. */
export function bakeoffMarkdown(r: BakeoffReport): string {
  const status = (p: EvalProviderName) => {
    const l = r.live.find((x) => x.provider === p)!
    return `${l.status}${l.reason ? ` — ${l.reason}` : ''}`
  }
  const failures = r.live.flatMap((l) => l.failures.map((f) => `| ${l.provider} | ${f.feature} | ${f.case} | ${f.injection ? '**yes**' : 'no'} | ${f.failed.join(', ')} |`))
  return [
    '# ATLAS provider bake-off',
    '',
    r.recommendation.startsWith(r.providerDecision) ? `**${r.recommendation}**` : `**${r.providerDecision}.** ${r.recommendation}`,
    '',
    ...(r.execution.providerSource === TEST_ONLY ? ['', `> **${TEST_ONLY}:** injected scripted providers. Nothing below is a provider result.`] : []),
    '',
    `Generated: ${r.execution.generatedAt ?? '—'} · runs: ${r.execution.plan.runs} · sections: ${r.execution.sections.join(', ')} · call upper bound: ${r.execution.plan.upperBoundCalls} · cap: ${r.execution.plan.maxCalls ?? 'NONE CONFIGURED'} · cost cap: ${r.execution.plan.maxCostUsd ?? 'NONE CONFIGURED'}`,
    `Budget used: ${r.execution.budget.attemptsUsed} attempts · cost ${r.execution.budget.costSpentUsd} · exhausted: ${r.execution.budget.exhausted ?? 'no'}${r.execution.budget.stopDetail ? ` (${r.execution.budget.stopDetail})` : ''} · dataset integrity: ${r.execution.integrity.status}`,
    costLine(r.execution.budget.costAccounting),
    '',
    `- Gemini: ${status('gemini')}`,
    `- OpenAI: ${status('openai')}`,
    '',
    '## Datasets',
    '',
    '| dataset | version | kind | cases | sha256 |',
    '|---|---|---|---|---|',
    ...[r.datasets.vision, r.datasets.stylist, r.datasets.outfit].map((d) => (d ? `| ${d.name} | ${d.version ?? '—'} | ${d.kind} | ${d.cases} | ${d.sha256} |` : '| vision | — | — | 0 | NOT_TESTED (no --vision-dataset) |')),
    '',
    ...Object.entries(r.realWorld).map(([k, v]) => `- ${k}: ${v}`),
    '',
    '## Comparison',
    '',
    '| Dimension | Gemini | OpenAI |',
    '|---|---|---|',
    ...r.comparison.map((c) => `| ${c.dimension} | ${c.gemini} | ${c.openai} |`),
    '',
    '## Failed cases (run 1)',
    '',
    ...(failures.length ? ['| provider | feature | case | injection | failed |', '|---|---|---|---|---|', ...failures] : ['None recorded (or nothing was tested live).']),
    '',
  ].join('\n') + '\n'
}

const usd = (v: number | string) => (typeof v === 'number' ? `$${v}` : v)

/** The cost accounting in one line: estimates (heuristic input) apart from provider-reported cost. */
function costLine(c: CostAccounting): string {
  return `Cost accounting (input estimate ${c.inputEstimateStatus}): reserved ${usd(c.reservedCostUsd)} (text input est. ${usd(c.estimatedInputCostUsd)} · image est. ${usd(c.estimatedImageCostUsd)} · bounded output ${usd(c.boundedOutputCostUsd)}) · provider-reported ${usd(c.providerReportedCostUsd)} over ${c.providerReportedAttempts} attempts · retained reservations ${usd(c.retainedReservationUsd)} over ${c.retainedReservationAttempts} attempts · conservative total ${usd(c.conservativeCostUsd)} · unknown-cost attempts ${c.unpricedOrUnknownCostAttempts} · estimate exceeded ${c.estimateExceededAttempts}. ${c.note}`
}

export async function buildBakeoff(env: Env, opts: BakeoffOptions = {}): Promise<BakeoffReport> {
  const runCount = opts.runs ?? 1
  if (!Number.isInteger(runCount) || runCount < 1 || runCount > MAX_RUNS) throw new Error(`runs must be a whole number between 1 and ${MAX_RUNS}`)
  const visionData = opts.visionDataset ? await loadVisionDataset(opts.visionDataset) : null
  const stylistSet = stylistCases(), outfitSet = outfitCases()
  // The call budget is checked before any provider call.
  const plan = planFor(env, visionData, runCount, opts)
  assertWithinCap(plan)
  // A dollar budget needs, for every live section, an exact-model price and a request type with an estimate.
  if (plan.maxCostUsd !== null) assertCostBudgetable(plan, env)
  const budget = new CallBudget(plan.maxCalls, plan.maxCostUsd)
  const guard = new IntegrityGuard({ vision: visionData, stylist: caseHash(stylistSet), outfit: caseHash(outfitSet) })
  const stamp = () => (opts.now ? opts.now().toISOString() : null)
  const generatedAt = stamp()
  const runs: Array<{ run: number; live: LiveProvider[] }> = []
  const runTimes: BakeoffReport['execution']['runTimes'] = []
  for (let run = 1; run <= runCount; run++) {
    // A changed dataset stops the remaining runs (its sections read DATASET_INTEGRITY_FAILURE).
    if (run > 1 && !guard.ok) break
    const startedAt = stamp()
    runs.push({ run, live: await liveRun(env, visionData, opts, budget, guard, run) })
    runTimes.push({ run, startedAt, finishedAt: stamp() })
  }
  if (plan.upperBoundCalls > 0) await guard.check() // a change during the last section is still reported
  const live = runs[0].live
  const aggregate = runs.length > 1 ? aggregateRuns(runs) : undefined
  // Injected (scripted) providers: whatever ran is TEST_ONLY, never a provider result.
  const testOnly = !!(opts.providers?.llm || opts.providers?.vision)

  const s: StylistRecord[] = [], o: OutfitRecord[] = []
  for (const c of stylistCases()) s.push(await runStylistCase(new ScriptedStylist(), c))
  for (const c of outfitCases()) o.push(await runOutfitCase(new ScriptedOutfit(), c))
  const robustness = await runRobustness()
  const vision = Dataset.parse({ items: syntheticVisionItems().map(({ id, file, expected }) => ({ id, file, expected })) })
  return {
    harnessVersion: 2,
    providerDecision: PROVIDER_DECISION,
    execution: {
      generatedAt,
      providerSource: plan.upperBoundCalls === 0 ? 'none' : testOnly ? TEST_ONLY : 'real',
      plan,
      sections: [...sectionsOf(opts)],
      // Spent cost is known only when every attempt that reported tokens had a configured price.
      budget: { attemptsUsed: budget.attemptsUsed, costSpentUsd: budget.attemptsUsed === 0 || budget.unpricedAttempts > 0 || !anyPrice(plan, env) ? COST_UNAVAILABLE : budget.costSpentUsd, exhausted: budget.exhausted, stopDetail: budget.stopDetail, costAccounting: costAccounting(budget.cost) },
      integrity: { status: guard.ok ? 'OK' : DATASET_INTEGRITY_FAILURE, checks: guard.checks },
      runTimes,
    },
    datasets: {
      vision: visionData?.identity ?? null,
      stylist: caseSetIdentity('stylist-cases', 'apps/web/scripts/ai-eval/stylist-cases.ts', STYLIST_CASES_VERSION, stylistSet),
      outfit: caseSetIdentity('outfit-cases', 'apps/web/scripts/ai-eval/outfit-cases.ts', OUTFIT_CASES_VERSION, outfitSet),
    },
    realWorld: {
      clothingDataset: visionData?.identity.kind === 'real' ? 'REAL DATASET USED (see datasets.vision)' : 'BLOCKED — dataset unavailable (no real labelled clothing photos; synthetic results are not real-world quality)',
      selfieDataset: 'BLOCKED — dataset unavailable (consented selfie set)',
      uzbekHumanRating: 'NOT_EVALUATED (no native Uzbek raters; uzbekRate is an automatic proxy)',
      legalReview: 'PENDING',
      pricing: 'NOT VERIFIED (cost uses AI_LLM_PRICE_* / AI_VISION_PRICE_* only when configured)',
    },
    comparison: compare(live, aggregate, testOnly),
    live,
    ...(aggregate ? { runs, aggregate } : {}),
    offline: {
      stylist: summarizeStylist(s, 'OFFLINE_SELF_TEST'),
      outfit: summarizeOutfit(o, 'OFFLINE_SELF_TEST'),
      robustness: { status: 'OFFLINE_SELF_TEST', cases: robustness.length, passed: robustness.filter((r) => r.pass).length, failed: robustness.filter((r) => !r.pass).length, results: robustness },
      visionDataset: {
        status: 'OFFLINE_DATASET_ONLY',
        cases: vision.items.length,
        subjects: count(vision.items.map((i) => i.expected.subject)),
        categories: count(vision.items.map((i) => i.expected.category ?? '(none)')),
      },
    },
    // A selection needs both providers measured live on every feature AND a human decision on the documented gates.
    recommendation: recommend(live, testOnly),
  }
}

function planFor(env: Env, visionData: VisionData | null, runCount: number, opts: BakeoffOptions): CallPlan {
  const stylistN = stylistCases().length, outfitN = outfitCases().length
  const sections = sectionsOf(opts)
  return planCalls(
    eligibility(env, visionData, sections).flatMap((e) => [
      ...(e.visionReason ? [] : [{ provider: e.provider, feature: 'vision' as const, cases: visionData!.items.length }]),
      ...(e.textReason || !sections.includes('stylist') ? [] : [{ provider: e.provider, feature: 'stylist' as const, cases: stylistN }]),
      ...(e.textReason || !sections.includes('outfit') ? [] : [{ provider: e.provider, feature: 'outfit' as const, cases: outfitN }]),
    ]),
    runCount,
    opts.maxCalls ?? null,
    opts.maxCostUsd ?? null,
  )
}

/** The call plan alone (no provider is built): what the CLI checks before running. */
export async function planOnly(env: Env, opts: BakeoffOptions = {}): Promise<CallPlan> {
  return planFor(env, opts.visionDataset ? await loadVisionDataset(opts.visionDataset) : null, opts.runs ?? 1, opts)
}

/**
 * The recommendation line. It never names a provider: a selection needs both
 * providers measured live on every feature AND a human decision on the gates.
 */
export function recommend(live: LiveProvider[], testOnly: boolean): string {
  if (testOnly && live.some((l) => l.status !== 'NOT_TESTED')) return `${PROVIDER_DECISION} — ${TEST_ONLY} RUN (injected scripted providers): NOT A PROVIDER RESULT`
  if (live.length > 0 && live.every((l) => l.status === 'TESTED')) return `${PROVIDER_DECISION} — LIVE RESULTS AVAILABLE; APPLY THE GATES IN docs/ai/provider-bakeoff.md (human decision)`
  return NO_SELECTION
}

const caseHash = (cases: readonly unknown[]) => caseSetIdentity('', '', '', cases).sha256
const sectionPrice = (x: CallPlan['sections'][number], env: Env) =>
  x.feature === 'vision' ? configuredPrice(x.provider, configuredVisionModel(x.provider, env), 'vision', env) : configuredPrice(x.provider, configuredModel(x.provider, env), 'llm', env)
const anyPrice = (plan: CallPlan, env: Env) => plan.sections.some((x) => sectionPrice(x, env) !== null)

/**
 * --max-cost-usd, checked before any provider call: every live section needs a
 * price for its provider and exact model, and a request type with an estimate
 * (text: both providers; vision: the documented OpenAI image settings only).
 * Each attempt is checked again when it is made (CallLedger), so nothing is
 * sent without a reservation either way.
 */
export function assertCostBudgetable(plan: CallPlan, env: Env): void {
  const problems: string[] = []
  for (const x of plan.sections) {
    const label = `${x.provider}/${x.feature}`
    if (!isBudgetablePrice(sectionPrice(x, env))) problems.push(`${label}: no price above zero for this provider and exact model (${x.feature === 'vision' ? 'AI_VISION_PROVIDER + AI_VISION_MODEL' : 'AI_LLM_PROVIDER + AI_LLM_MODEL'} + *_PRICE_*_USD_PER_MTOK)`)
    if (x.feature === 'vision') {
      const model = configuredVisionModel(x.provider, env)
      const config = bakeoffVisionConfig(x.provider, model ?? '')
      if (x.provider !== 'openai' || !model || !isOpenAIPatchModel(model) || (config.openaiDetail !== 'high' && config.openaiDetail !== 'auto')) {
        problems.push(`${label}: no documented image-token bound for this provider, model or image setting`)
      }
    }
  }
  if (problems.length) throw new Error(`--max-cost-usd cannot be enforced: ${problems.join('; ')}`)
}

/** CLI default: 3 runs when any live text section can run (key and model set), else 1 (offline only). */
export function defaultRuns(env: Env, sections: readonly LiveFeature[] = ALL_SECTIONS): number {
  const text = sections.includes('stylist') || sections.includes('outfit')
  return eligibility(env, null, sections).some((e) => (text && !e.textReason) || !e.visionReason) ? 3 : 1
}

async function main() {
  const outDir = arg('out')
  if (!outDir) throw new Error('usage: --out=<dir outside the repo>')
  assertOutsideRepo(outDir, path.resolve(__dirname, '../../../..'), path)
  const runsArg = arg('runs')
  if (runsArg !== undefined && !/^\d{1,2}$/.test(runsArg)) throw new Error(`--runs must be a whole number between 1 and ${MAX_RUNS}`)
  const visionDataset = arg('vision-dataset')
  const maxCalls = parseMaxCalls(arg('max-calls') ?? process.env.AI_EVAL_MAX_CALLS)
  const maxCostUsd = parseMaxCost(arg('max-cost-usd') ?? process.env.AI_EVAL_MAX_COST_USD)
  const sections = parseSections(arg('section'))
  const runs = runsArg === undefined ? defaultRuns(process.env, sections) : Number(runsArg)
  const rawOutputs: RawOutput[] = []
  const opts: BakeoffOptions = { visionDataset: visionDataset ? path.resolve(visionDataset) : undefined, runs, maxCalls, maxCostUsd, now: () => new Date(), rawOutputs, sections }
  // The CLI never makes a live call without an explicit call cap (checked before any provider is built).
  assertCapForLive(await planOnly(process.env, opts))
  const report = await buildBakeoff(process.env, opts)
  await fs.mkdir(outDir, { recursive: true })
  await fs.writeFile(path.join(outDir, 'bakeoff.json'), JSON.stringify(report, null, 2) + '\n')
  await fs.writeFile(path.join(outDir, 'bakeoff.md'), bakeoffMarkdown(report))
  if (rawOutputs.length) {
    const raw = { providerDecision: report.providerDecision, generatedAt: report.execution.generatedAt, providerSource: report.execution.providerSource, datasets: report.datasets, cases: rawOutputs }
    await fs.writeFile(path.join(outDir, 'raw-outputs.json'), JSON.stringify(raw, null, 2) + '\n')
  }
  console.log(JSON.stringify({ runs: report.execution.plan.runs, sections: report.execution.sections, upperBoundCalls: report.execution.plan.upperBoundCalls, maxCalls: report.execution.plan.maxCalls, attemptsUsed: report.execution.budget.attemptsUsed, integrity: report.execution.integrity.status, live: report.live.map((l) => ({ provider: l.provider, status: l.status, reason: l.reason })), providerDecision: report.providerDecision }))
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
