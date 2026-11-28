/**
 * MANUAL outfit-AI evaluation (Phase 4.5). Never run in CI with a real
 * provider: it calls paid APIs. See docs/ai/provider-evaluation.md.
 *
 *   OPENAI_API_KEY=… bun scripts/ai-eval/outfit-eval.ts --provider=openai --model=<configured model> --out=<dir outside the repo>
 *   bun scripts/ai-eval/outfit-eval.ts --provider=scripted --out=<dir>   # offline self-test of the harness (NOT a provider result)
 *
 * Each case through the Go server's production path (`lookly eval`): the
 * deterministic engine's candidates → the ranking prompt and context → the
 * provider (the server's retry policy) → validation → at most one correction.
 * No quota, no database.
 */
import { promises as fs } from 'fs'
import path from 'path'
import { outfitSetupOf } from './case-setups'
import type { LLMProvider, LLMRequest, OutfitSetup } from './protocol'
import { openGoPipeline, refuseRemovedPipelineFlag, outfitRequest, type GoPipeline } from './go-pipeline'
import { arg, assertOutsideRepo } from './eval-common'
import { outfitCases, type OutfitCase } from './outfit-cases'
import { scoreOutfit, summarizeOutfit, type OutfitCaseContext, type OutfitOutcome, type OutfitRecord, type OutfitSummary } from './outfit-scoring'

/** Offline stand-in: keeps the engine order, explains with a fixed Uzbek sentence. Exercises the harness only. */
export class ScriptedOutfit implements LLMProvider {
  readonly name = 'scripted'
  readonly model = 'scripted-offline'
  async generate(req: LLMRequest) {
    const refs = (req.jsonSchema!.schema as { properties: { ranking: { items: { enum: string[] } } } }).properties.ranking.items.enum
    const text = JSON.stringify({ selectedCandidate: refs[0], ranking: refs, explanation: 'Bu obraz kiyimlari bir-biriga mos va qulay.', needsMoreInfo: false })
    return { text, metadata: { provider: this.name, model: this.model, usage: {} } }
  }
}

/** The scoring context of a setup Go made: a strong profile is one the engine uses at 0.6 or more. */
export function outfitScoringContext(setup: OutfitSetup): OutfitCaseContext {
  return { candidates: setup.candidates, weatherProvided: setup.weatherProvided, profileSent: setup.profileSent, profileStrong: (setup.profileStrength ?? 0) >= 0.6 }
}

/** The scoring context of case `c`, from Go's setup (case-setups.json): live runs and offline replays share it. */
export const outfitCaseContext = (c: OutfitCase): OutfitCaseContext => outfitScoringContext(outfitSetupOf(c))

/** The same case through the Go pipeline (`lookly eval`): Go's outcome, this file's scoring. */
export async function runOutfitCaseGo(go: GoPipeline, p: { name: string; model: string }, c: OutfitCase): Promise<OutfitRecord> {
  const r = await go.run('outfit', outfitRequest(c))
  const outcome = r.outcome as unknown as OutfitOutcome
  // Scored against what Go made of the case in this very run.
  const { checks, pass } = scoreOutfit(outfitScoringContext(r.setup as OutfitSetup), outcome)
  return {
    case: c.id, tags: c.tags, provider: p.name, model: p.model, candidates: r.candidates ?? 0, latencyMs: r.latencyMs, calls: r.calls,
    requests: r.requests, inputTokens: r.inputTokens, outputTokens: r.outputTokens, outcome, checks, pass,
  }
}

/** The deterministic explanation of each case's best outfit (what the fallback shows, from Go's setup), for review. */
export function fallbackExplanations(): Array<{ case: string; explanation: string }> {
  return outfitCases().map((c) => ({ case: c.id, explanation: outfitSetupOf(c).fallbackExplanation ?? '' }))
}

const pct = (n: number | null) => (n === null ? '—' : `${(n * 100).toFixed(1)}%`)
export function outfitMarkdown(s: OutfitSummary, records: OutfitRecord[]): string {
  return [
    `# Outfit AI evaluation — ${s.provider} / ${s.model}`,
    '',
    `Cases ${s.cases} · passed ${s.passed} · failed ${s.failed}`,
    '',
    '| schema (1st) | valid (final) | fallback | grounding | explanation grounding | top-1 agreement | mean tau | weather | colour profile | Uzbek (auto) | p50 ms | p95 ms | in tok p50/p95 | out tok p50/p95 |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    `| ${pct(s.schemaValidity)} | ${pct(s.finalValidity)} | ${pct(s.fallbackRate)} | ${pct(s.groundingRate)} | ${pct(s.explanationGroundingRate)} | ${pct(s.topAgreementRate)} | ${s.meanTau ?? '—'} | ${pct(s.weatherSuitability)} | ${pct(s.colorProfileUsage)} | ${pct(s.uzbekRate)} | ${s.latencyP50 ?? '—'} | ${s.latencyP95 ?? '—'} | ${s.inputTokensP50 ?? '—'}/${s.inputTokensP95 ?? '—'} | ${s.outputTokensP50 ?? '—'}/${s.outputTokensP95 ?? '—'} |`,
    '',
    '| case | candidates | pass | outcome | tau | failed checks |',
    '|---|---|---|---|---|---|',
    ...records.map((r) => {
      const failedChecks = Object.entries(r.checks).filter(([k, v]) => v === false && k !== 'topAgreement').map(([k]) => k)
      if (r.checks.uzbek && !r.checks.uzbek.pass) failedChecks.push('uzbek')
      return `| ${r.case} | ${r.candidates} | ${r.pass ? '✓' : '✗'} | ${r.outcome.kind} | ${r.checks.tau ?? '—'} | ${failedChecks.join(', ')} |`
    }),
    '',
    'Top-1 agreement and tau describe how far the model reorders the engine; they are not pass/fail criteria.',
  ].join('\n') + '\n'
}

async function main() {
  const outDir = arg('out')
  if (!outDir) throw new Error('usage: --provider=gemini|openai|scripted [--model=…] [--max-calls=N] --out=<dir outside the repo>')
  assertOutsideRepo(outDir, path.resolve(__dirname, '../../../..'), path)
  refuseRemovedPipelineFlag()
  // The cases run through the Go server's pipeline (lookly eval, LOOKLY_BINARY); a live run needs --max-calls.
  const pipeline = await openGoPipeline(arg('provider') === 'scripted' ? { scripted: new ScriptedOutfit() } : { provider: arg('provider'), model: arg('model'), maxCalls: arg('max-calls') })
  const p = { name: pipeline.name, model: pipeline.model }
  await fs.mkdir(outDir, { recursive: true })
  const records: OutfitRecord[] = []
  for (const c of outfitCases()) {
    const r = await runOutfitCaseGo(pipeline.go, p, c)
    records.push(r)
    process.stdout.write(`${c.id} ${r.pass ? 'pass' : 'FAIL'} ${r.outcome.kind}\n`)
  }
  const summary = summarizeOutfit(records, p.name === 'scripted' ? 'OFFLINE_SELF_TEST' : 'TESTED')
  await fs.writeFile(path.join(outDir, 'outfit-results.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n')
  await fs.writeFile(path.join(outDir, 'outfit-summary.json'), JSON.stringify(summary, null, 2) + '\n')
  await fs.writeFile(path.join(outDir, 'outfit-summary.md'), outfitMarkdown(summary, records))
  await fs.writeFile(path.join(outDir, 'outfit-fallback-explanations.json'), JSON.stringify(fallbackExplanations(), null, 2) + '\n')
  await pipeline.close()
  console.log(JSON.stringify(summary))
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
