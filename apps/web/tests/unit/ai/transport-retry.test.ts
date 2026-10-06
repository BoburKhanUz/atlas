import { describe, expect, it, vi } from 'vitest'
import { AiProviderError } from '@/lib/ai/providers/errors'
import { errorForStatus, parseRetryAfterMs, postJson } from '@/lib/ai/providers/http'
import { MAX_RETRY_WAIT_MS, RetriedError, withRetry } from '@/lib/ai/providers/retry'
import { fakeFetch } from './fake-fetch'

const SECRET_CONTENT = 'USER-PROMPT-SHOULD-NEVER-LEAK'

async function failureOf(p: Promise<unknown>): Promise<AiProviderError> {
  try {
    await p
  } catch (err) {
    return err as AiProviderError
  }
  throw new Error('expected a failure')
}

const post = (fetch: ReturnType<typeof fakeFetch>['fetch'], extra: Partial<Parameters<typeof postJson>[0]> = {}) =>
  postJson({ provider: 'p', url: 'https://ai.test/x', headers: {}, body: { prompt: SECRET_CONTENT }, timeoutMs: 1000, fetch, ...extra })

describe('HTTP status classification', () => {
  it.each([
    [429, 'rate_limited', true],
    [401, 'auth', false],
    [403, 'auth', false],
    [500, 'unavailable', true],
    [502, 'unavailable', true],
    [503, 'unavailable', true],
    [504, 'unavailable', true],
    [400, 'invalid_request', false],
    [404, 'invalid_request', false],
    [422, 'invalid_request', false],
    [501, 'provider_error', false],
    [505, 'provider_error', false],
  ])('%i → %s (retryable: %s)', (status, kind, retryable) => {
    const e = errorForStatus('p', status, null)
    expect(e.kind).toBe(kind)
    expect(e.retryable).toBe(retryable)
    expect(e.status).toBe(status)
  })

  it('Retry-After: seconds, HTTP date, garbage; capped at 60 s', () => {
    expect(parseRetryAfterMs('2')).toBe(2000)
    expect(parseRetryAfterMs('9999')).toBe(60_000)
    const now = Date.parse('2026-10-07T10:00:00Z')
    expect(parseRetryAfterMs('Wed, 07 Oct 2026 10:00:05 GMT', now)).toBe(5000)
    expect(parseRetryAfterMs('soon')).toBeUndefined()
    expect(parseRetryAfterMs(null)).toBeUndefined()
  })
})

describe('postJson', () => {
  it('sends JSON with no-store and returns the parsed body', async () => {
    const f = fakeFetch([{ status: 200, json: { ok: 1 } }])
    expect(await post(f.fetch)).toEqual({ ok: 1 })
    expect(f.calls[0].headers['content-type']).toBe('application/json')
  })

  it('error responses never carry the provider body (which may echo the prompt)', async () => {
    const f = fakeFetch([{ status: 400, json: { error: { message: `bad: ${SECRET_CONTENT}` } } }])
    const e = await failureOf(post(f.fetch))
    expect(e.kind).toBe('invalid_request')
    expect(e.message).not.toContain(SECRET_CONTENT)
    expect(JSON.stringify(e)).not.toContain(SECRET_CONTENT)
  })

  it('429 keeps Retry-After', async () => {
    const e = await failureOf(post(fakeFetch([{ status: 429, headers: { 'retry-after': '1' } }]).fetch))
    expect(e.kind).toBe('rate_limited')
    expect(e.retryAfterMs).toBe(1000)
  })

  it('a hung request times out', async () => {
    const e = await failureOf(post(fakeFetch([{ hang: true }]).fetch, { timeoutMs: 20 }))
    expect(e.kind).toBe('timeout')
  })

  it('a connection failure is a network error', async () => {
    const e = await failureOf(post(fakeFetch([{ throw: new TypeError('fetch failed') }]).fetch))
    expect(e.kind).toBe('network')
  })

  it('the caller aborting is "cancelled", before or during the request', async () => {
    const pre = new AbortController()
    pre.abort()
    const f = fakeFetch([{ status: 200, json: {} }])
    expect((await failureOf(post(f.fetch, { signal: pre.signal }))).kind).toBe('cancelled')
    expect(f.calls).toHaveLength(0)
    const during = new AbortController()
    setTimeout(() => during.abort(), 10)
    expect((await failureOf(post(fakeFetch([{ hang: true }]).fetch, { signal: during.signal, timeoutMs: 5000 }))).kind).toBe('cancelled')
  })

  it('a 2xx that is not JSON is malformed', async () => {
    const e = await failureOf(post(fakeFetch([{ status: 200, text: '<html>' }]).fetch))
    expect(e.kind).toBe('malformed_response')
  })
})

describe('retry policy: at most one retry, only for transient failures', () => {
  const noSleep = vi.fn(async () => undefined)

  it.each(['timeout', 'network', 'rate_limited', 'unavailable'] as const)('%s is retried once, then succeeds', async (kind) => {
    const attempt = vi.fn().mockRejectedValueOnce(new AiProviderError(kind, 'p')).mockResolvedValueOnce('ok')
    expect(await withRetry(attempt, { sleep: noSleep })).toEqual({ value: 'ok', attempts: 2 })
  })

  it.each(['timeout', 'unavailable'] as const)('%s twice → fails after exactly 2 attempts', async (kind) => {
    const attempt = vi.fn().mockRejectedValue(new AiProviderError(kind, 'p'))
    const e = (await withRetry(attempt, { sleep: noSleep }).catch((x) => x)) as RetriedError
    expect(e).toBeInstanceOf(RetriedError)
    expect(e.attempts).toBe(2)
    expect(attempt).toHaveBeenCalledTimes(2)
  })

  it.each(['auth', 'config', 'invalid_request', 'malformed_response', 'content_filtered', 'cancelled', 'provider_error'] as const)(
    '%s is never retried',
    async (kind) => {
      const attempt = vi.fn().mockRejectedValue(new AiProviderError(kind, 'p'))
      const e = (await withRetry(attempt, { sleep: noSleep }).catch((x) => x)) as RetriedError
      expect(e.attempts).toBe(1)
      expect(attempt).toHaveBeenCalledTimes(1)
    },
  )

  it('non-provider errors (bugs) are never retried', async () => {
    const attempt = vi.fn().mockRejectedValue(new TypeError('bug'))
    expect(((await withRetry(attempt, { sleep: noSleep }).catch((x) => x)) as RetriedError).attempts).toBe(1)
  })

  it('429 waits for Retry-After when it is short, and gives up when it is long', async () => {
    const sleep = vi.fn(async () => undefined)
    const short = vi.fn().mockRejectedValueOnce(new AiProviderError('rate_limited', 'p', { retryAfterMs: 1500 })).mockResolvedValueOnce('ok')
    await withRetry(short, { sleep })
    expect(sleep).toHaveBeenCalledWith(1500)
    const long = vi.fn().mockRejectedValue(new AiProviderError('rate_limited', 'p', { retryAfterMs: MAX_RETRY_WAIT_MS + 1 }))
    expect(((await withRetry(long, { sleep }).catch((x) => x)) as RetriedError).attempts).toBe(1)
  })

  it('backoff is 400–800 ms with jitter', async () => {
    const sleep = vi.fn(async () => undefined)
    const attempt = vi.fn().mockRejectedValueOnce(new AiProviderError('network', 'p')).mockResolvedValueOnce('ok')
    await withRetry(attempt, { sleep, random: () => 0.5 })
    expect(sleep).toHaveBeenCalledWith(600)
  })

  it('no retry after the caller aborted', async () => {
    const ac = new AbortController()
    const attempt = vi.fn().mockImplementation(async () => {
      ac.abort()
      throw new AiProviderError('timeout', 'p')
    })
    const e = (await withRetry(attempt, { sleep: noSleep, signal: ac.signal }).catch((x) => x)) as RetriedError
    expect(e.attempts).toBe(1)
  })
})
