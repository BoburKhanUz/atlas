/**
 * Provider bake-off (Phase 4.5, vision and repeated runs Phase 5.0): one
 * deterministic, machine-readable report.
 *
 *   bun scripts/ai-eval/bakeoff.ts --out=<dir outside the repo> \
 *     [--vision-dataset=<dir with labels.json and the photos>] [--runs=N]
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
import { evaluateVisionConfig } from './vision-eval'
import { Dataset, type ConfigSummary, type EvalConfig, type ItemRecord } from './vision-scoring'

export const NO_SELECTION = 'NO FINAL PROVIDER SELECTED — LIVE BAKE-OFF REQUIRED'

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
  latencyP50: number
  latencyP95: number
  latencyMax: number
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
  /** Provider factories (tests inject scripted providers; the default builds the real ones). */
  providers?: {
    llm?: (provider: EvalProviderName, model: string, env: Env) => LLMProvider
    vision?: (provider: EvalProviderName, model: string, env: Env) => VisionProvider
  }
}

export interface BakeoffReport {
  harnessVersion: 1
  /** Run 1 (the only run by default). */
  live: LiveProvider[]
  /** Present when runs > 1: every run, unhidden, identified by its number. */
  runs?: Array<{ run: number; live: LiveProvider[] }>
  /** Present when runs > 1: per provider, feature and numeric metric, over the TESTED runs. */
  aggregate?: Array<{ provider: EvalProviderName; feature: FeatureResult['feature']; testedRuns: number; metrics: Record<string, MetricAggregate> }>
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

function realVision(provider: EvalProviderName, model: string, env: Env): VisionProvider {
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

interface VisionData {
  dir: string
  version: string | null
  items: Dataset['items']
}

async function loadVisionDataset(dir: string): Promise<VisionData> {
  const labels = Dataset.parse(JSON.parse(await fs.readFile(path.join(dir, 'labels.json'), 'utf8')))
  return { dir, version: labels.version ?? null, items: labels.items }
}

async function liveRun(env: Env, vision: VisionData | null, opts: BakeoffOptions): Promise<LiveProvider[]> {
  const llm = opts.providers?.llm ?? ((provider, model, e) => llmProviderFromEnv(provider, model, e))
  const visionFactory = opts.providers?.vision ?? realVision
  const live: LiveProvider[] = []
  for (const provider of ['gemini', 'openai'] as const) {
    const model = configuredModel(provider, env)
    const visionModel = configuredVisionModel(provider, env)
    const noKey = !env[KEY[provider]]?.trim() ? `no ${KEY[provider]} in the environment` : null
    const textReason = noKey ?? (!model ? `no configured model (${MODEL[provider]} or AI_LLM_MODEL)` : null)
    const visionReason =
      noKey ?? (!visionModel ? `no configured vision model (${VISION_MODEL[provider]} or AI_VISION_MODEL)` : !vision ? 'no labelled vision dataset (--vision-dataset)' : null)

    let visionResult: FeatureResult
    if (visionReason) visionResult = notTested(provider, visionModel, 'vision', visionReason)
    else {
      const { records, summary } = await evaluateVisionConfig(visionFactory(provider, visionModel!, env), bakeoffVisionConfig(provider, visionModel!), vision!.dir, vision!.items)
      visionResult = visionSummary(summary, records, vision!.version)
    }

    let stylist: FeatureResult, outfit: FeatureResult
    if (textReason) {
      stylist = notTested(provider, model, 'stylist', textReason)
      outfit = notTested(provider, model, 'outfit', textReason)
    } else {
      const p = llm(provider, model!, env)
      const s: StylistRecord[] = [], o: OutfitRecord[] = []
      for (const c of stylistCases()) s.push(await runStylistCase(p, c))
      for (const c of outfitCases()) o.push(await runOutfitCase(p, c))
      stylist = summarizeStylist(s, 'TESTED')
      outfit = summarizeOutfit(o, 'TESTED')
    }

    const features = [visionResult, stylist, outfit]
    const tested = features.filter((f) => f.status === 'TESTED').length
    const reasons = [...new Set([visionReason, textReason].filter((r): r is string => r !== null))]
    live.push({
      provider,
      status: tested === features.length ? 'TESTED' : tested === 0 ? 'NOT_TESTED' : 'PARTIALLY_TESTED',
      model,
      visionModel,
      reason: reasons.length ? reasons.join('; ') : null,
      features,
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
      out.push({ provider, feature, testedRuns: sections.length, metrics })
    }
  }
  return out
}

export async function buildBakeoff(env: Env, opts: BakeoffOptions = {}): Promise<BakeoffReport> {
  const runCount = opts.runs ?? 1
  if (!Number.isInteger(runCount) || runCount < 1 || runCount > MAX_RUNS) throw new Error(`runs must be a whole number between 1 and ${MAX_RUNS}`)
  const visionData = opts.visionDataset ? await loadVisionDataset(opts.visionDataset) : null
  const runs: Array<{ run: number; live: LiveProvider[] }> = []
  for (let run = 1; run <= runCount; run++) runs.push({ run, live: await liveRun(env, visionData, opts) })
  const live = runs[0].live

  const s: StylistRecord[] = [], o: OutfitRecord[] = []
  for (const c of stylistCases()) s.push(await runStylistCase(new ScriptedStylist(), c))
  for (const c of outfitCases()) o.push(await runOutfitCase(new ScriptedOutfit(), c))
  const robustness = await runRobustness()
  const vision = Dataset.parse({ items: syntheticVisionItems().map(({ id, file, expected }) => ({ id, file, expected })) })
  const allTested = live.every((l) => l.status === 'TESTED')
  return {
    harnessVersion: 1,
    live,
    ...(runCount > 1 ? { runs, aggregate: aggregateRuns(runs) } : {}),
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
    recommendation: allTested ? 'LIVE RESULTS AVAILABLE — APPLY THE GATES IN docs/ai/provider-evaluation.md' : NO_SELECTION,
  }
}

async function main() {
  const outDir = arg('out')
  if (!outDir) throw new Error('usage: --out=<dir outside the repo>')
  assertOutsideRepo(outDir, path.resolve(__dirname, '../../../..'), path)
  const runsArg = arg('runs')
  if (runsArg !== undefined && !/^\d{1,2}$/.test(runsArg)) throw new Error(`--runs must be a whole number between 1 and ${MAX_RUNS}`)
  const visionDataset = arg('vision-dataset')
  const report = await buildBakeoff(process.env, { visionDataset: visionDataset ? path.resolve(visionDataset) : undefined, runs: runsArg === undefined ? 1 : Number(runsArg) })
  await fs.mkdir(outDir, { recursive: true })
  await fs.writeFile(path.join(outDir, 'bakeoff.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ runs: report.runs?.length ?? 1, live: report.live.map((l) => ({ provider: l.provider, status: l.status, reason: l.reason })), recommendation: report.recommendation }))
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
