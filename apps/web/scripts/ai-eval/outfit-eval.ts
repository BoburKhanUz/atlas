/**
 * MANUAL outfit-AI evaluation (Phase 4.5). Never run in CI with a real
 * provider: it calls paid APIs. See docs/ai/provider-evaluation.md.
 *
 *   OPENAI_API_KEY=… bun scripts/ai-eval/outfit-eval.ts --provider=openai --model=<configured model> --out=<dir outside the repo>
 *   bun scripts/ai-eval/outfit-eval.ts --provider=scripted --out=<dir>   # offline self-test of the harness (NOT a provider result)
 *
 * Each case: the deterministic engine's candidates → outfitMessages (the
 * production prompt and context) → the provider (with the app's retry policy)
 * → interpretOutfitOutput → at most one correction (outfitCorrectionMessages).
 * No quota, no database.
 */
import { promises as fs } from 'fs'
import path from 'path'
import { deterministicExplanation, interpretOutfitOutput, InvalidOutfitOutputError, outfitCorrectionMessages, outfitJsonSchema, outfitMessages } from '../../src/lib/ai/outfit-intelligence'
import { OUTFIT_AI_TIMEOUT_MS } from '../../src/lib/ai/outfit-config'
import { generateOutfitResult, profileContext } from '../../src/lib/ai/outfit-engine'
import { isAiProviderError } from '../../src/lib/ai/providers/errors'
import { withRetry } from '../../src/lib/ai/providers/retry'
import type { LLMMessage, LLMProvider, LLMRequest } from '../../src/lib/ai/providers/types'
import { arg, assertOutsideRepo, llmProviderFromEnv } from './eval-common'
import { outfitCases, type OutfitCase } from './outfit-cases'
import { scoreOutfit, summarizeOutfit, type OutfitOutcome, type OutfitRecord, type OutfitSummary } from './outfit-scoring'

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

export async function runOutfitCase(p: LLMProvider, c: OutfitCase): Promise<OutfitRecord> {
  const result = generateOutfitResult({ wardrobe: c.wardrobe, occasion: c.occasion, weather: c.weather, colorProfile: c.colorProfile, topN: c.topN })
  const candidates = result.outfits
  const refs = candidates.map((_, i) => `O${i + 1}`)
  const messages = outfitMessages({ candidates, occasion: c.occasion, weather: result.weather, colorProfile: c.colorProfile ?? null })
  const schema = { name: 'outfit_ranking', schema: outfitJsonSchema(refs) }
  let calls = 0, inputTokens: number | undefined, outputTokens: number | undefined
  const add = (a: number | undefined, b: number | undefined) => (a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0))
  const call = async (msgs: LLMMessage[]) => {
    const { value, attempts } = await withRetry(() => p.generate({ messages: msgs, temperature: 0.3, maxOutputTokens: 400, jsonSchema: schema, timeoutMs: OUTFIT_AI_TIMEOUT_MS }))
    calls += attempts
    inputTokens = add(inputTokens, value.metadata.usage.inputTokens)
    outputTokens = add(outputTokens, value.metadata.usage.outputTokens)
    return value.text
  }
  const started = performance.now()
  let outcome: OutfitOutcome
  try {
    const first = await call(messages)
    try {
      const r = interpretOutfitOutput(first, refs)
      outcome = { kind: 'ranked', firstError: null, ...r }
    } catch (err) {
      if (!(err instanceof InvalidOutfitOutputError)) throw err
      const second = await call(outfitCorrectionMessages(messages, first, err.reason, refs))
      try {
        outcome = { kind: 'ranked', firstError: err.reason, ...interpretOutfitOutput(second, refs) }
      } catch (again) {
        if (!(again instanceof InvalidOutfitOutputError)) throw again
        outcome = { kind: 'invalid', firstError: err.reason, finalError: again.reason }
      }
    }
  } catch (err) {
    const cause = (err as { lastError?: unknown }).lastError ?? err
    outcome = { kind: 'error', error: isAiProviderError(cause) ? cause.kind : 'unexpected' }
  }
  const cp = profileContext(c.colorProfile)
  const sent = !!c.colorProfile && (c.colorProfile.confidence ?? 0) >= 0.3 && !!c.colorProfile.season
  const { checks, pass } = scoreOutfit({ candidates, weatherProvided: !!result.weather, profileSent: sent, profileStrong: !!cp && cp.strength >= 0.6 }, outcome)
  return { case: c.id, tags: c.tags, provider: p.name, model: p.model, candidates: candidates.length, latencyMs: Math.round(performance.now() - started), calls, inputTokens, outputTokens, outcome, checks, pass }
}

/** The deterministic explanation of each case's best outfit (what the fallback shows), for review. */
export function fallbackExplanations(): Array<{ case: string; explanation: string }> {
  return outfitCases().map((c) => {
    const r = generateOutfitResult({ wardrobe: c.wardrobe, occasion: c.occasion, weather: c.weather, colorProfile: c.colorProfile, topN: c.topN })
    return { case: c.id, explanation: r.outfits[0] ? deterministicExplanation(r.outfits[0], { occasion: c.occasion, weather: r.weather }) : '' }
  })
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
  if (!outDir) throw new Error('usage: --provider=gemini|openai|scripted [--model=…] --out=<dir outside the repo>')
  assertOutsideRepo(outDir, path.resolve(__dirname, '../../../..'), path)
  const p = arg('provider') === 'scripted' ? new ScriptedOutfit() : llmProviderFromEnv(arg('provider'), arg('model'))
  await fs.mkdir(outDir, { recursive: true })
  const records: OutfitRecord[] = []
  for (const c of outfitCases()) {
    const r = await runOutfitCase(p, c)
    records.push(r)
    process.stdout.write(`${c.id} ${r.pass ? 'pass' : 'FAIL'} ${r.outcome.kind}\n`)
  }
  const summary = summarizeOutfit(records, p.name === 'scripted' ? 'OFFLINE_SELF_TEST' : 'TESTED')
  await fs.writeFile(path.join(outDir, 'outfit-results.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n')
  await fs.writeFile(path.join(outDir, 'outfit-summary.json'), JSON.stringify(summary, null, 2) + '\n')
  await fs.writeFile(path.join(outDir, 'outfit-summary.md'), outfitMarkdown(summary, records))
  await fs.writeFile(path.join(outDir, 'outfit-fallback-explanations.json'), JSON.stringify(fallbackExplanations(), null, 2) + '\n')
  console.log(JSON.stringify(summary))
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
