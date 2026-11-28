/**
 * MANUAL stylist evaluation (Phase 4.5). Never run in CI with a real
 * provider: it calls paid APIs. See docs/ai/provider-evaluation.md.
 *
 *   GEMINI_API_KEY=… bun scripts/ai-eval/stylist-eval.ts --provider=gemini --model=<configured model> --out=<dir outside the repo>
 *   bun scripts/ai-eval/stylist-eval.ts --provider=scripted --out=<dir>   # offline self-test of the harness (NOT a provider result)
 *
 * Each synthetic case goes through the Go server's production path (`lookly
 * eval`): engine candidates → the context → the messages → the provider (the
 * server's retry policy) → validation → at most one correction → reference
 * resolution. No quota, no database. Outputs: results.jsonl (synthetic
 * prompts/answers only), summary.json, summary.md.
 */
import { promises as fs } from 'fs'
import path from 'path'
import type { LLMProvider, LLMRequest, StylistSetup } from './protocol'
import { caseSetIdentity } from './live-accounting'
import { arg, assertOutsideRepo } from './eval-common'
import { STYLIST_CASES_VERSION, stylistCases, type StylistCase } from './stylist-cases'
import { resolveCaseRubric, syntheticStylistRubricSet, type RubricResolution, type RubricSet } from './case-rubric'
import type { DatasetIdentityRef } from './eval-rubric'
import { stylistSetupOf } from './case-setups'
import { openGoPipeline, refuseRemovedPipelineFlag, stylistRequest, type GoPipeline } from './go-pipeline'
import { requestIsClean, scoreStylist, summarizeStylist, type StylistOutcome, type StylistRecord, type StylistSummary } from './stylist-scoring'


/** Offline stand-in: a grounded Uzbek answer from the context. Exercises the harness only. */
export class ScriptedStylist implements LLMProvider {
  readonly name = 'scripted'
  readonly model = 'scripted-offline'
  async generate(req: LLMRequest) {
    const ctx = JSON.parse(req.messages[1].content.slice(req.messages[1].content.indexOf('\n') + 1)) as { wardrobe: Array<{ ref: string }>; outfitCandidates: Array<{ items: string[] }> }
    const refs = ctx.outfitCandidates[0]?.items ?? ctx.wardrobe.slice(0, 2).map((w) => w.ref)
    const output = refs.length
      ? { answer: `Bugun ${refs.map((r) => `[${r}]`).join(', ')} bilan qulay va mos obraz tuzing.`, referencedItems: refs, needsMoreInfo: false }
      : { answer: 'Garderobingizda hali kiyim yo‘q. Qanday kiyimlaringiz bor?', referencedItems: [], needsMoreInfo: true }
    return { text: JSON.stringify(output), metadata: { provider: this.name, model: this.model, usage: {} } }
  }
}

/** The identity of the current case set (version + SHA-256 of its JSON, as the bake-off records it). */
export function stylistCaseSetIdentity() {
  return { version: STYLIST_CASES_VERSION, sha256: caseSetIdentity('', '', STYLIST_CASES_VERSION, stylistCases()).sha256 }
}

/** Which rubric set scores a case, and the verified identity of the case set the case belongs to. */
export interface StylistRubricContext {
  set: RubricSet
  dataset: DatasetIdentityRef
}

let syntheticContext: StylistRubricContext | null = null
/** Default: the synthetic bake-off cases (synthetic-v1), every case declared. */
export function syntheticRubricContext(): StylistRubricContext {
  syntheticContext ??= { set: syntheticStylistRubricSet(), dataset: stylistCaseSetIdentity() }
  return syntheticContext
}

/**
 * The rubric of case `c` from its declared metadata: throws RubricIdentityError
 * when the rubric set belongs to another case set; UNSCORABLE when the case
 * has no declaration or lacks metadata a required check needs. For the
 * synthetic set, a case object that differs from the pinned case of the same
 * id is refused.
 */
function rubricFor(c: StylistCase, ctx: StylistRubricContext): RubricResolution {
  const r = resolveCaseRubric(ctx.set, ctx.dataset, c.id)
  if (ctx.set === syntheticStylistRubricSet() && r.status === 'SCORABLE' && r.rubric) {
    const pinned = stylistCases().find((x) => x.id === c.id)
    if (!pinned || JSON.stringify(pinned) !== JSON.stringify(c)) throw new Error(`case ${c.id} differs from the pinned case set: its evaluator rubric does not apply`)
  }
  return r
}

/**
 * Scores an outcome of case `c` with the current evaluator (live runs and
 * offline replays share this), against Go's setup of the case: the one its
 * run returned, else the frozen one (case-setups.json). An UNSCORABLE case
 * fails closed (pass false) and carries the reason: it is neither a pass nor
 * a model failure.
 */
export function scoreStylistCase(c: StylistCase, outcome: StylistOutcome, ctx: StylistRubricContext = syntheticRubricContext(), given?: StylistSetup) {
  // The rubric's own refusals (another case set, a changed case) come first.
  const r = rubricFor(c, ctx)
  const setup = given ?? stylistSetupOf(c)
  const owned = new Set(c.wardrobe.map((w) => w.subcategory).filter((s): s is string => !!s))
  const scored = scoreStylist(c.expect, outcome, owned, requestIsClean(setup.messages, c.expect.injectMarker), { rubric: r.status === 'SCORABLE' ? r.rubric : null, contextRefs: setup.refs })
  return r.status === 'UNSCORABLE' ? { checks: scored.checks, pass: false, unscorable: r.reason } : { ...scored, unscorable: undefined }
}

/**
 * The same case through the Go pipeline (`lookly eval`, go-pipeline.ts):
 * the outcome is Go's, the scoring this file's. `p` names the provider in
 * the record.
 */
export async function runStylistCaseGo(go: GoPipeline, p: { name: string; model: string }, c: StylistCase, ctx: StylistRubricContext = syntheticRubricContext()): Promise<StylistRecord> {
  const r = await go.run('stylist', stylistRequest(c))
  const outcome = r.outcome as unknown as StylistOutcome
  // Scored against what Go made of the case in this very run.
  const { checks, pass, unscorable } = scoreStylistCase(c, outcome, ctx, r.setup as StylistSetup)
  return {
    case: c.id, tags: c.tags, provider: p.name, model: p.model, latencyMs: r.latencyMs, calls: r.calls, requests: r.requests,
    inputTokens: r.inputTokens, outputTokens: r.outputTokens, outcome, checks, pass, ...(unscorable ? { unscorable } : {}),
  }
}

const pct = (n: number | null) => (n === null ? '—' : `${(n * 100).toFixed(1)}%`)
export function stylistMarkdown(s: StylistSummary, records: StylistRecord[]): string {
  return [
    `# Stylist evaluation — ${s.provider} / ${s.model}`,
    '',
    `Cases ${s.cases} · passed ${s.passed} · failed ${s.failed}`,
    '',
    '| schema (1st) | valid (final) | invalid ref (1st) | grounding | hallucination | Uzbek (auto) | relevance | injection | errors | p50 ms | p95 ms | in tok p50/p95 | out tok p50/p95 |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    `| ${pct(s.schemaValidity)} | ${pct(s.finalValidity)} | ${pct(s.invalidReferenceRate)} | ${pct(s.groundingRate)} | ${pct(s.hallucinationRate)} | ${pct(s.uzbekRate)} | ${pct(s.relevanceRate)} | ${pct(s.injectionResistance)} | ${pct(s.providerErrorRate)} | ${s.latencyP50 ?? '—'} | ${s.latencyP95 ?? '—'} | ${s.inputTokensP50 ?? '—'}/${s.inputTokensP95 ?? '—'} | ${s.outputTokensP50 ?? '—'}/${s.outputTokensP95 ?? '—'} |`,
    '',
    '| case | pass | outcome | refs | failed checks |',
    '|---|---|---|---|---|',
    ...records.map((r) => {
      const failedChecks = Object.entries(r.checks).filter(([, v]) => v === false).map(([k]) => k)
      if (r.checks.uzbek && !r.checks.uzbek.pass) failedChecks.push('uzbek')
      return `| ${r.case} | ${r.pass ? '✓' : '✗'} | ${r.outcome.kind} | ${r.outcome.kind === 'answer' ? r.outcome.refs.length : '—'} | ${failedChecks.join(', ')} |`
    }),
    '',
    'Uzbek (auto) is a proxy (Latin script, Uzbek markers, no English); the native-speaker rubric is separate.',
  ].join('\n') + '\n'
}

async function main() {
  const outDir = arg('out')
  if (!outDir) throw new Error('usage: --provider=gemini|openai|scripted [--model=…] [--max-calls=N] --out=<dir outside the repo>')
  assertOutsideRepo(outDir, path.resolve(__dirname, '../../../..'), path)
  refuseRemovedPipelineFlag()
  // The cases run through the Go server's pipeline (lookly eval, LOOKLY_BINARY); a live run needs --max-calls.
  const pipeline = await openGoPipeline(arg('provider') === 'scripted' ? { scripted: new ScriptedStylist() } : { provider: arg('provider'), model: arg('model'), maxCalls: arg('max-calls') })
  const p = { name: pipeline.name, model: pipeline.model }
  await fs.mkdir(outDir, { recursive: true })
  const records: StylistRecord[] = []
  for (const c of stylistCases()) {
    const r = await runStylistCaseGo(pipeline.go, p, c)
    records.push(r)
    process.stdout.write(`${c.id} ${r.pass ? 'pass' : 'FAIL'} ${r.outcome.kind}\n`)
  }
  const summary = summarizeStylist(records, p.name === 'scripted' ? 'OFFLINE_SELF_TEST' : 'TESTED')
  await fs.writeFile(path.join(outDir, 'stylist-results.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n')
  await fs.writeFile(path.join(outDir, 'stylist-summary.json'), JSON.stringify(summary, null, 2) + '\n')
  await fs.writeFile(path.join(outDir, 'stylist-summary.md'), stylistMarkdown(summary, records))
  await pipeline.close()
  console.log(JSON.stringify(summary))
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
