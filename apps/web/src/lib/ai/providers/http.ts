/**
 * Shared JSON-over-HTTPS transport for the REST adapters: one attempt with a
 * hard timeout, the caller's abort signal, and a fixed classification of
 * failures into `AiProviderError` kinds. Response bodies are parsed but never
 * copied into errors or logs (they can echo prompts).
 */
import { AiProviderError } from './errors'

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export interface PostJsonOptions {
  provider: string
  url: string
  headers: Record<string, string>
  body: unknown
  timeoutMs: number
  signal?: AbortSignal
  fetch: FetchLike
}

const TRANSIENT_5XX = new Set([500, 502, 503, 504])
/** Retry-After values above this are not worth waiting for in a request. */
const MAX_RETRY_AFTER_MS = 60_000

export function parseRetryAfterMs(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) return Math.min(Number(trimmed) * 1000, MAX_RETRY_AFTER_MS)
  const at = Date.parse(trimmed)
  if (Number.isNaN(at)) return undefined
  return Math.min(Math.max(0, at - now), MAX_RETRY_AFTER_MS)
}

export function errorForStatus(provider: string, status: number, retryAfter: string | null): AiProviderError {
  if (status === 429) return new AiProviderError('rate_limited', provider, { status, retryAfterMs: parseRetryAfterMs(retryAfter) })
  if (status === 401 || status === 403) return new AiProviderError('auth', provider, { status })
  if (TRANSIENT_5XX.has(status)) return new AiProviderError('unavailable', provider, { status })
  if (status >= 400 && status < 500) return new AiProviderError('invalid_request', provider, { status })
  return new AiProviderError('provider_error', provider, { status })
}

/** POSTs `body` as JSON and returns the parsed JSON response of a 2xx. */
export async function postJson({ provider, url, headers, body, timeoutMs, signal, fetch }: PostJsonOptions): Promise<unknown> {
  if (signal?.aborted) throw new AiProviderError('cancelled', provider)
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), timeoutMs)
  const combined = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: combined,
      // Provider responses are per request and contain user data: never cache.
      cache: 'no-store',
    })
  } catch {
    clearTimeout(timer)
    if (signal?.aborted) throw new AiProviderError('cancelled', provider)
    if (timeout.signal.aborted) throw new AiProviderError('timeout', provider)
    throw new AiProviderError('network', provider)
  }
  try {
    if (!response.ok) {
      // Drain without reading the content into anything that could be logged.
      await response.body?.cancel().catch(() => undefined)
      throw errorForStatus(provider, response.status, response.headers.get('retry-after'))
    }
    try {
      return await response.json()
    } catch {
      if (signal?.aborted) throw new AiProviderError('cancelled', provider)
      if (timeout.signal.aborted) throw new AiProviderError('timeout', provider)
      throw new AiProviderError('malformed_response', provider, { detail: 'response is not JSON' })
    }
  } finally {
    clearTimeout(timer)
  }
}

/** Parses provider text that must be JSON (structured output). */
export function parseJsonOutput(provider: string, text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new AiProviderError('malformed_response', provider, { detail: 'output is not valid JSON' })
  }
}
