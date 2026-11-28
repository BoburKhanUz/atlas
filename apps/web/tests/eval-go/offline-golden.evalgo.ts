/**
 * The offline regression guard of the evaluation harness (docs/plan/B7.md,
 * B7.4): every offline scenario (scripted cases, provider failures,
 * corrections, preferences, synthetic pictures, robustness) through `lookly
 * eval`, served the scripted providers by a stand-in on 127.0.0.1, must give
 * the records and requests frozen in golden/offline.json. While the TypeScript
 * pipeline exists, it must give them too: the freeze is honest.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { GoPipeline, serveStandIn } from '../../scripts/ai-eval/go-pipeline'
import { collectOffline, VISION_SETTINGS, type OfflineGolden, type OfflinePipeline } from '../../scripts/ai-eval/offline-scenarios'
import { runOutfitCase, runOutfitCaseGo } from '../../scripts/ai-eval/outfit-eval'
import { runStylistCase, runStylistCaseGo } from '../../scripts/ai-eval/stylist-eval'
import { runOne, runOneGo } from '../../scripts/ai-eval/vision-eval'
import type { LLMProvider, VisionProvider } from '@/lib/ai/providers/types'

if (!process.env.LOOKLY_BINARY) throw new Error('LOOKLY_BINARY is not set: build apps/api (go build -tags nodynamic -o <path> ./cmd/lookly) and point it there')

const golden = JSON.parse(readFileSync(path.join(__dirname, 'golden/offline.json'), 'utf8')) as OfflineGolden & { generatedBy: string }

async function withGo<T>(text: LLMProvider | null, vision: VisionProvider | null, model: string, fn: (go: GoPipeline) => Promise<T>, timeout = '10s'): Promise<T> {
  const standIn = await serveStandIn(text, vision)
  const go = new GoPipeline({ args: ['--provider=openai', `--model=${model}`, `--base-url=${standIn.url}`, `--timeout=${timeout}`] })
  try {
    return await fn(go)
  } finally {
    await go.close()
    await standIn.close()
  }
}

const goRunners = (timeout: string) => ({
  stylist: (p: LLMProvider, c: Parameters<typeof runStylistCase>[1]) => withGo(p, null, p.model, (g) => runStylistCaseGo(g, p, c), timeout),
  outfit: (p: LLMProvider, c: Parameters<typeof runOutfitCase>[1]) => withGo(p, null, p.model, (g) => runOutfitCaseGo(g, p, c), timeout),
})

const onGo: OfflinePipeline = {
  ...goRunners('10s'),
  // A timeout is the attempt's own time limit on Go: keep it short.
  withShortTimeout: goRunners('300ms'),
  vision: (p, bytes) => withGo(null, p, 'offline', async (g) => {
    const r = await runOneGo(g, VISION_SETTINGS as never, bytes)
    return { outcome: r.outcome, usage: r.usage }
  }),
}

const onTypeScript: OfflinePipeline = {
  stylist: runStylistCase,
  outfit: runOutfitCase,
  withShortTimeout: { stylist: runStylistCase, outfit: runOutfitCase },
  vision: async (p, bytes) => {
    const r = await runOne(p, VISION_SETTINGS as never, bytes)
    return { outcome: r.outcome, usage: r.usage }
  },
}

/**
 * The Go OpenAI adapter refuses an answer that is not JSON when a schema was
 * asked (malformed_response, not retried, not corrected: B6.2); the user gets
 * the same AI_UNAVAILABLE or fallback either way. Owner decision 2026-11-28:
 * the evaluator expects Go's outcome (applied when the harness runs on Go only).
 */
const GO_ON_MALFORMED_JSON: Record<string, { actual: string; calls: number }> = {
  'stylist:malformed JSON (never retried)': { actual: 'error_malformed_response', calls: 1 },
  'outfit:malformed JSON twice': { actual: 'fallback_error_malformed_response', calls: 1 },
}

function sameAsGolden(got: OfflineGolden, onGoPipeline: boolean) {
  const { robustness, ...rest } = got
  const { robustness: goldenRobustness, generatedBy: _generatedBy, ...goldenRest } = golden
  void _generatedBy
  expect(rest).toEqual(goldenRest)
  expect(robustness.map((r) => `${r.feature}:${r.scenario}`)).toEqual(goldenRobustness.map((r) => `${r.feature}:${r.scenario}`))
  for (const [i, r] of robustness.entries()) {
    const known = onGoPipeline ? GO_ON_MALFORMED_JSON[`${r.feature}:${r.scenario}`] : undefined
    if (known) expect({ actual: r.actual, calls: r.calls }, r.scenario).toEqual(known)
    else expect(r, r.scenario).toEqual(goldenRobustness[i])
  }
}

describe('the offline golden records', () => {
  it('the Go pipeline gives them', async () => {
    sameAsGolden(await collectOffline(onGo), true)
  }, 180_000)

  it('the TypeScript pipeline gives them too (while it exists): the freeze is honest', async () => {
    sameAsGolden(await collectOffline(onTypeScript), false)
  }, 180_000)
})
