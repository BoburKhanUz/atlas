/**
 * Provider bake-off (Phase 4.5): one deterministic, machine-readable report.
 *
 *   bun scripts/ai-eval/bakeoff.ts --out=<dir outside the repo>
 *
 * - Live sections: for each provider whose key AND configured model are in the
 *   environment (AI_EVAL_GEMINI_MODEL / AI_EVAL_OPENAI_MODEL, else AI_LLM_MODEL
 *   when AI_LLM_PROVIDER names that provider), the stylist and outfit
 *   harnesses run against the live API. Otherwise the provider is reported
 *   status "NOT_TESTED" with every metric null — never estimated.
 * - Offline sections: the scripted self-tests, the adversarial robustness
 *   suite and the synthetic vision dataset check (no latency: not meaningful).
 * - Vision live evaluation needs a labelled dataset and a matrix: run
 *   vision-eval.ts (see docs/ai/vision-evaluation.md); here it is NOT_TESTED.
 *
 * Keys are read from the environment only and never written anywhere.
 */
import { promises as fs } from 'fs'
import path from 'path'
import { arg, assertOutsideRepo, llmProviderFromEnv, type EvalProviderName, type EvalStatus } from './eval-common'
import { outfitCases } from './outfit-cases'
import { runOutfitCase, ScriptedOutfit } from './outfit-eval'
import { summarizeOutfit, type OutfitRecord, type OutfitSummary } from './outfit-scoring'
import { runRobustness, type RobustnessResult } from './robustness'
import { stylistCases } from './stylist-cases'
import { runStylistCase, ScriptedStylist } from './stylist-eval'
import { summarizeStylist, type StylistRecord, type StylistSummary } from './stylist-scoring'
import { syntheticVisionItems } from './synthetic-vision'
import { Dataset } from './vision-scoring'

export const NO_SELECTION = 'NO FINAL PROVIDER SELECTED — LIVE BAKE-OFF REQUIRED'

type Env = Record<string, string | undefined>
const KEY: Record<EvalProviderName, string> = { gemini: 'GEMINI_API_KEY', openai: 'OPENAI_API_KEY' }
const MODEL: Record<EvalProviderName, string> = { gemini: 'AI_EVAL_GEMINI_MODEL', openai: 'AI_EVAL_OPENAI_MODEL' }

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

export interface BakeoffReport {
  harnessVersion: 1
  live: Array<{ provider: EvalProviderName; status: EvalStatus; model: string | null; reason: string | null; features: Array<StylistSummary | OutfitSummary | NotTested> }>
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

const notTested = (provider: string, model: string | null, feature: NotTested['feature'], reason: string): NotTested => ({
  status: 'NOT_TESTED', provider, model, feature, reason, cases: 0, passed: null, failed: null, schemaValidity: null, groundingRate: null, latencyP50: null, latencyP95: null,
})

const count = (values: string[]) => Object.fromEntries([...new Set(values)].sort().map((v) => [v, values.filter((x) => x === v).length]))

export async function buildBakeoff(env: Env): Promise<BakeoffReport> {
  const live: BakeoffReport['live'] = []
  for (const provider of ['gemini', 'openai'] as const) {
    const model = configuredModel(provider, env)
    const reason = !env[KEY[provider]]?.trim() ? `no ${KEY[provider]} in the environment` : !model ? `no configured model (${MODEL[provider]} or AI_LLM_MODEL)` : null
    if (reason) {
      live.push({ provider, status: 'NOT_TESTED', model, reason, features: (['vision', 'stylist', 'outfit'] as const).map((f) => notTested(provider, model, f, reason)) })
      continue
    }
    const p = llmProviderFromEnv(provider, model!, env)
    const s: StylistRecord[] = [], o: OutfitRecord[] = []
    for (const c of stylistCases()) s.push(await runStylistCase(p, c))
    for (const c of outfitCases()) o.push(await runOutfitCase(p, c))
    live.push({
      provider, status: 'TESTED', model, reason: null,
      features: [notTested(provider, model, 'vision', 'run vision-eval.ts with a labelled dataset'), summarizeStylist(s, 'TESTED'), summarizeOutfit(o, 'TESTED')],
    })
  }

  const s: StylistRecord[] = [], o: OutfitRecord[] = []
  for (const c of stylistCases()) s.push(await runStylistCase(new ScriptedStylist(), c))
  for (const c of outfitCases()) o.push(await runOutfitCase(new ScriptedOutfit(), c))
  const robustness = await runRobustness()
  const vision = Dataset.parse({ items: syntheticVisionItems().map(({ id, file, expected }) => ({ id, file, expected })) })
  const allTested = live.every((l) => l.status === 'TESTED')
  return {
    harnessVersion: 1,
    live,
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
    // A selection needs both providers measured live AND a human decision on the documented gates.
    recommendation: allTested ? 'LIVE RESULTS AVAILABLE — APPLY THE GATES IN docs/ai/provider-evaluation.md' : NO_SELECTION,
  }
}

async function main() {
  const outDir = arg('out')
  if (!outDir) throw new Error('usage: --out=<dir outside the repo>')
  assertOutsideRepo(outDir, path.resolve(__dirname, '../../../..'), path)
  const report = await buildBakeoff(process.env)
  await fs.mkdir(outDir, { recursive: true })
  await fs.writeFile(path.join(outDir, 'bakeoff.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ live: report.live.map((l) => ({ provider: l.provider, status: l.status, reason: l.reason })), recommendation: report.recommendation }))
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
