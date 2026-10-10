/**
 * MANUAL stylist evaluation (Phase 4.5). Never run in CI with a real
 * provider: it calls paid APIs. See docs/ai/provider-evaluation.md.
 *
 *   GEMINI_API_KEY=… bun scripts/ai-eval/stylist-eval.ts --provider=gemini --model=<configured model> --out=<dir outside the repo>
 *   bun scripts/ai-eval/stylist-eval.ts --provider=scripted --out=<dir>   # offline self-test of the harness (NOT a provider result)
 *
 * Each synthetic case goes through the production path: engine candidates →
 * buildStylistContext → stylistMessages → the provider (with the app's retry
 * policy) → interpretStylistOutput → at most one correction → reference
 * resolution. No quota, no database. Outputs: results.jsonl (synthetic
 * prompts/answers only), summary.json, summary.md.
 */
import { promises as fs } from 'fs'
import path from 'path'
import { generateOutfits } from '../../src/lib/ai/outfit-engine'
import { isAiProviderError } from '../../src/lib/ai/providers/errors'
import { RetriedError, withRetry } from '../../src/lib/ai/providers/retry'
import type { LLMMessage, LLMProvider, LLMRequest } from '../../src/lib/ai/providers/types'
import { InvalidStylistOutputError, interpretStylistOutput, parseStylistText, resolveReferences, STYLIST_LIMITS, STYLIST_SYSTEM_PROMPT, stylistJsonSchema } from '../../src/lib/ai/stylist'
import { buildStylistContext, stylistMessages } from '../../src/lib/ai/stylist-context'
import { stylistCorrectionMessages } from '../../src/lib/ai/stylist-service'
import { caseSetIdentity, LocalRefusalError } from './live-accounting'
import { arg, assertOutsideRepo, llmProviderFromEnv } from './eval-common'
import { STYLIST_CASES_VERSION, stylistCases, type StylistCase } from './stylist-cases'
import { resolveCaseRubric, syntheticStylistRubricSet, type RubricResolution, type RubricSet } from './case-rubric'
import type { DatasetIdentityRef } from './eval-rubric'
import { requestIsClean, scoreStylist, summarizeStylist, type StylistOutcome, type StylistRecord, type StylistSummary } from './stylist-scoring'

const TIMEOUT_MS = Number(process.env.AI_LLM_TIMEOUT_MS ?? 25_000)

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

/** The deterministic part of a case (engine, context, messages, schema): what a live run sends, and what a replay re-scores against. */
export function stylistCaseSetup(c: StylistCase) {
  const candidates = generateOutfits({ wardrobe: c.wardrobe, occasion: c.occasion, weather: c.weather, topN: STYLIST_LIMITS.outfitCandidates })
  const context = buildStylistContext({ items: c.wardrobe, candidates, occasion: c.occasion, weather: c.weather, preferences: c.preferences, colorProfile: c.colorProfile })
  const messages = stylistMessages({ system: STYLIST_SYSTEM_PROMPT, context: context.data, history: [], message: c.message, occasionText: c.occasionText ?? null })
  const schema = { name: 'stylist_answer', schema: stylistJsonSchema(context.refs) }
  const owned = new Set(c.wardrobe.map((w) => w.subcategory).filter((s): s is string => !!s))
  return { context, messages, schema, owned }
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
 * offline replays share this). An UNSCORABLE case fails closed (pass false)
 * and carries the reason: it is neither a pass nor a model failure.
 */
export function scoreStylistCase(c: StylistCase, outcome: StylistOutcome, ctx: StylistRubricContext = syntheticRubricContext()) {
  const { context, messages, owned } = stylistCaseSetup(c)
  const r = rubricFor(c, ctx)
  const scored = scoreStylist(c.expect, outcome, owned, requestIsClean(messages, c.expect.injectMarker), { rubric: r.status === 'SCORABLE' ? r.rubric : null, contextRefs: context.refs })
  return r.status === 'UNSCORABLE' ? { checks: scored.checks, pass: false, unscorable: r.reason } : { ...scored, unscorable: undefined }
}

export async function runStylistCase(p: LLMProvider, c: StylistCase, ctx: StylistRubricContext = syntheticRubricContext()): Promise<StylistRecord> {
  const { context, messages, schema } = stylistCaseSetup(c)
  // calls = provider attempts (retries included, failed ones too); requests = logical requests (first + correction).
  let calls = 0, requests = 0, inputTokens: number | undefined, outputTokens: number | undefined
  const add = (a: number | undefined, b: number | undefined) => (a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0))
  const call = async (msgs: LLMMessage[]) => {
    requests++
    let result
    try {
      result = await withRetry(() => p.generate({ messages: msgs, temperature: 0.7, maxOutputTokens: STYLIST_LIMITS.maxOutputTokens, jsonSchema: schema, timeoutMs: TIMEOUT_MS }))
    } catch (err) {
      // A locally refused attempt (bake-off circuit breaker or budget) never reached the provider.
      if (err instanceof RetriedError) calls += err.attempts - (err.lastError instanceof LocalRefusalError ? 1 : 0)
      throw err
    }
    const { value, attempts } = result
    calls += attempts
    inputTokens = add(inputTokens, value.metadata.usage.inputTokens)
    outputTokens = add(outputTokens, value.metadata.usage.outputTokens)
    return value.text
  }
  const started = performance.now()
  let outcome: StylistOutcome
  try {
    const first = await call(messages)
    let firstError: null | 'schema' | 'invalid_reference' = null
    let answer
    try {
      answer = interpretStylistOutput(parseStylistText(first), context.refs)
    } catch (err) {
      if (!(err instanceof InvalidStylistOutputError)) throw err
      firstError = err.reason
      if (err.reason !== 'invalid_reference') throw err
      answer = interpretStylistOutput(parseStylistText(await call(stylistCorrectionMessages(messages, first, err.invalidRefs, context.refs))), context.refs)
    }
    outcome = { kind: 'answer', firstError, raw: answer.answer, shown: resolveReferences(answer.answer, context.items), refs: answer.referencedItems, needsMoreInfo: answer.needsMoreInfo }
  } catch (err) {
    const cause = (err as { lastError?: unknown }).lastError ?? err
    if (cause instanceof InvalidStylistOutputError) outcome = { kind: 'invalid', firstError: cause.reason }
    else outcome = { kind: 'error', error: isAiProviderError(cause) ? cause.kind : 'unexpected' }
  }
  const { checks, pass, unscorable } = scoreStylistCase(c, outcome, ctx)
  return { case: c.id, tags: c.tags, provider: p.name, model: p.model, latencyMs: Math.round(performance.now() - started), calls, requests, inputTokens, outputTokens, outcome, checks, pass, ...(unscorable ? { unscorable } : {}) }
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
  if (!outDir) throw new Error('usage: --provider=gemini|openai|scripted [--model=…] --out=<dir outside the repo>')
  assertOutsideRepo(outDir, path.resolve(__dirname, '../../../..'), path)
  const p = arg('provider') === 'scripted' ? new ScriptedStylist() : llmProviderFromEnv(arg('provider'), arg('model'))
  await fs.mkdir(outDir, { recursive: true })
  const records: StylistRecord[] = []
  for (const c of stylistCases()) {
    const r = await runStylistCase(p, c)
    records.push(r)
    process.stdout.write(`${c.id} ${r.pass ? 'pass' : 'FAIL'} ${r.outcome.kind}\n`)
  }
  const summary = summarizeStylist(records, p.name === 'scripted' ? 'OFFLINE_SELF_TEST' : 'TESTED')
  await fs.writeFile(path.join(outDir, 'stylist-results.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n')
  await fs.writeFile(path.join(outDir, 'stylist-summary.json'), JSON.stringify(summary, null, 2) + '\n')
  await fs.writeFile(path.join(outDir, 'stylist-summary.md'), stylistMarkdown(summary, records))
  console.log(JSON.stringify(summary))
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
