/**
 * Test helpers: a case through the Go pipeline with a scripted provider
 * behind the stand-in and the harness's ledger as the attempt gate — the
 * bake-off's own path (docs/plan/B7.md, B7.4).
 */
import { GoPipeline, serveStandIn, STAND_IN_TIMEOUT_MS } from '../../scripts/ai-eval/go-pipeline'
import { ledgerGate, type CallLedger } from '../../scripts/ai-eval/live-accounting'
import type { OutfitCase } from '../../scripts/ai-eval/outfit-cases'
import { runOutfitCaseGo } from '../../scripts/ai-eval/outfit-eval'
import type { AiErrorKind, LLMProvider, VisionProvider } from '../../scripts/ai-eval/protocol'
import type { StylistCase } from '../../scripts/ai-eval/stylist-cases'
import { runStylistCaseGo, type StylistRubricContext } from '../../scripts/ai-eval/stylist-eval'
import { runOneGo } from '../../scripts/ai-eval/vision-eval'
import type { EvalConfig } from '../../scripts/ai-eval/vision-scoring'

/** A scripted provider's failure of a kind (the stand-in answers it as Go reads that kind). */
export const failure = (kind: AiErrorKind) => Object.assign(new Error(`scripted: ${kind}`), { kind })

export async function withGate<T>(text: LLMProvider | null, vision: VisionProvider | null, model: string, ledger: CallLedger, fn: (go: GoPipeline) => Promise<T>): Promise<T> {
  const standIn = await serveStandIn(text, vision)
  const go = new GoPipeline({ args: ['--provider=openai', `--model=${model}`, `--base-url=${standIn.url}`, `--timeout=${STAND_IN_TIMEOUT_MS}ms`], gate: ledgerGate(ledger) })
  try {
    return await fn(go)
  } finally {
    await go.close()
    await standIn.close()
  }
}

export const stylistThroughGo = (p: LLMProvider, ledger: CallLedger, c: StylistCase, ctx?: StylistRubricContext) =>
  withGate(p, null, p.model, ledger, (go) => runStylistCaseGo(go, p, c, ctx))

export const outfitThroughGo = (p: LLMProvider, ledger: CallLedger, c: OutfitCase) => withGate(p, null, p.model, ledger, (go) => runOutfitCaseGo(go, p, c))

export const visionThroughGo = (p: VisionProvider, ledger: CallLedger, config: EvalConfig, bytes: Uint8Array) =>
  withGate(null, p, config.model, ledger, (go) => runOneGo(go, { ...config, timeoutMs: STAND_IN_TIMEOUT_MS }, bytes))
