/**
 * The application layer's single entry point to AI providers: picks the
 * configured provider, applies the timeout and the retry policy, and records
 * one `ai.call` telemetry line per call. Errors reach the caller as
 * `AiProviderError` (safe to log: no content).
 */
import { getAiConfig, type AiPrice } from './config'
import { AiProviderError, isAiProviderError } from './providers/errors'
import { getLLMProvider, getVisionProvider } from './providers'
import { RetriedError, withRetry, type RetryOptions } from './providers/retry'
import type { AiFeature, LLMRequest, LLMResult, VisionRequest, VisionResult } from './providers/types'
import { recordAiCall } from './telemetry'

export type TextRequest = Omit<LLMRequest, 'timeoutMs'> & { timeoutMs?: number }
export type ImageRequest = Omit<VisionRequest, 'timeoutMs'> & { timeoutMs?: number }

/** Clock and retry hooks, for tests. */
export interface CallOptions extends Pick<RetryOptions, 'sleep' | 'random'> {
  now?: () => number
}

async function run<T extends { metadata: { usage: LLMResult['metadata']['usage'] } }>(
  feature: AiFeature,
  provider: { name: string; model: string },
  attempt: () => Promise<T>,
  signal: AbortSignal | undefined,
  price: AiPrice | null,
  opts: CallOptions,
): Promise<T> {
  const now = opts.now ?? (() => performance.now())
  const started = now()
  try {
    const { value, attempts } = await withRetry(attempt, { signal, sleep: opts.sleep, random: opts.random })
    recordAiCall({ feature, provider: provider.name, model: provider.model, outcome: 'ok', latencyMs: now() - started, attempts, usage: value.metadata.usage, price })
    return value
  } catch (err) {
    const attempts = err instanceof RetriedError ? err.attempts : 1
    const cause = err instanceof RetriedError ? err.lastError : err
    recordAiCall({
      feature,
      provider: provider.name,
      model: provider.model,
      outcome: isAiProviderError(cause) ? cause.kind : 'error',
      latencyMs: now() - started,
      attempts,
    })
    throw cause
  }
}

/** Text (or JSON, with `jsonSchema`) generation for `feature`. */
export async function generateText(feature: AiFeature, request: TextRequest, opts: CallOptions = {}): Promise<LLMResult> {
  const provider = getLLMProvider()
  const { timeoutMs: defaultTimeout, price } = getAiConfig().llm
  const timeoutMs = request.timeoutMs ?? defaultTimeout
  return run(feature, provider, () => provider.generate({ ...request, timeoutMs }), request.signal, price, opts)
}

/** Image analysis for `feature`. The image must already be prepared (see prepareVisionImage). */
export async function analyzeImage(feature: AiFeature, request: ImageRequest, opts: CallOptions = {}): Promise<VisionResult> {
  const provider = getVisionProvider()
  const { timeoutMs: defaultTimeout, price } = getAiConfig().vision
  const timeoutMs = request.timeoutMs ?? defaultTimeout
  return run(feature, provider, () => provider.analyzeImage({ ...request, timeoutMs }), request.signal, price, opts)
}

export { AiProviderError, isAiProviderError }
