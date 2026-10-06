/**
 * Typed AI provider errors. Messages never contain provider response bodies,
 * prompts, user content or credentials: only the provider name, the kind and
 * (when there is one) the HTTP status.
 */

export type AiErrorKind =
  /** The attempt ran past its timeout. */
  | 'timeout'
  /** The connection failed before an HTTP response arrived. */
  | 'network'
  /** HTTP 429. */
  | 'rate_limited'
  /** Transient server-side failure (HTTP 500, 502, 503, 504). */
  | 'unavailable'
  /** HTTP 401 or 403: wrong or missing credentials. */
  | 'auth'
  /** Missing or invalid local configuration. */
  | 'config'
  /** HTTP 4xx other than 401/403/429: the request itself is wrong. */
  | 'invalid_request'
  /** A 2xx response that does not have the expected shape (or invalid JSON output). */
  | 'malformed_response'
  /** The provider refused or filtered the content. */
  | 'content_filtered'
  /** The caller aborted. */
  | 'cancelled'
  /** Any other HTTP failure (e.g. 501). */
  | 'provider_error'

const RETRYABLE: ReadonlySet<AiErrorKind> = new Set(['timeout', 'network', 'rate_limited', 'unavailable'])

export class AiProviderError extends Error {
  readonly kind: AiErrorKind
  readonly provider: string
  readonly status?: number
  /** From a 429's Retry-After header, when present. */
  readonly retryAfterMs?: number

  constructor(kind: AiErrorKind, provider: string, opts: { status?: number; retryAfterMs?: number; detail?: string } = {}) {
    const parts = [`${provider}: ${kind}`]
    if (opts.status !== undefined) parts.push(`HTTP ${opts.status}`)
    if (opts.detail) parts.push(opts.detail)
    super(parts.join(' — '))
    this.name = 'AiProviderError'
    this.kind = kind
    this.provider = provider
    this.status = opts.status
    this.retryAfterMs = opts.retryAfterMs
  }

  /** Only timeouts, transient network errors, 429 and transient 5xx are retried. */
  get retryable(): boolean {
    return RETRYABLE.has(this.kind)
  }
}

export function isAiProviderError(err: unknown): err is AiProviderError {
  return err instanceof AiProviderError
}
