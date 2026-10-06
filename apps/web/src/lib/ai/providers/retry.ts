/**
 * At most ONE retry, and only for failures that are safe and likely to pass a
 * second time: timeout, transient network error, HTTP 429 and transient 5xx.
 * Provider calls have no side effects on our data, so repeating one is safe;
 * auth, configuration, validation and malformed-response errors never retry.
 */
import { AiProviderError, isAiProviderError } from './errors'

export const MAX_RETRIES = 1
/** A 429 asking us to wait longer than this fails instead of retrying. */
export const MAX_RETRY_WAIT_MS = 3_000
const BASE_DELAY_MS = 400

export interface RetryOptions {
  signal?: AbortSignal
  sleep?: (ms: number) => Promise<void>
  random?: () => number
}

export interface RetryOutcome<T> {
  value: T
  attempts: number
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export class RetriedError extends Error {
  constructor(
    readonly lastError: unknown,
    readonly attempts: number,
  ) {
    super(lastError instanceof Error ? lastError.message : 'AI call failed')
    this.name = 'RetriedError'
  }
}

/**
 * Runs `attempt` once, and once more if the first failure is retryable.
 * Failures are rethrown wrapped in `RetriedError` so callers know how many
 * attempts ran (for telemetry); `RetriedError.lastError` is the last error.
 */
export async function withRetry<T>(attempt: () => Promise<T>, opts: RetryOptions = {}): Promise<RetryOutcome<T>> {
  const sleep = opts.sleep ?? defaultSleep
  const random = opts.random ?? Math.random
  let attempts = 0
  for (;;) {
    attempts++
    try {
      return { value: await attempt(), attempts }
    } catch (err) {
      if (!isAiProviderError(err) || !err.retryable || attempts > MAX_RETRIES || opts.signal?.aborted) {
        throw new RetriedError(err, attempts)
      }
      const wait = err.kind === 'rate_limited' && err.retryAfterMs !== undefined ? err.retryAfterMs : BASE_DELAY_MS + Math.floor(random() * BASE_DELAY_MS)
      if (wait > MAX_RETRY_WAIT_MS) throw new RetriedError(err, attempts)
      await sleep(wait)
      if (opts.signal?.aborted) throw new RetriedError(new AiProviderError('cancelled', err.provider), attempts)
    }
  }
}
