/**
 * Browser error reporter (src/lib/client-errors.ts): each distinct error once,
 * at most 10 per page load, scrubbed before it leaves the page, batched and
 * sent with keepalive; a failing send never throws.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reportClientError, resetClientErrorReportingForTesting } from '@/lib/client-errors'

const fetchMock = vi.fn()
const sent = () => fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string).reports).flat()

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock.mockReset().mockResolvedValue(new Response('{"ok":true}'))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('window', { location: { pathname: '/wardrobe/cm9x8y7z6w5v4u3t2s1r' } })
  resetClientErrorReportingForTesting()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('reportClientError', () => {
  it('sends one scrubbed batch after a short delay, with keepalive', async () => {
    reportClientError(new TypeError('cannot read x of ali@example.uz at https://a.uz/api/v1/media/k?sig=s'), 'web_error', true)
    expect(fetchMock).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/client-errors')
    expect(init).toMatchObject({ method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' } })
    const [r] = sent()
    expect(r).toMatchObject({ platform: 'web', kind: 'web_error', fatal: true, errorType: 'TypeError', route: '/wardrobe/:id' })
    expect(r.message).toBe('cannot read x of [REDACTED_EMAIL] at https://a.uz/api/v1/media/k?[REDACTED]')
  })

  it('reports each distinct error once and at most 10 per page', async () => {
    const same = new Error('boom')
    for (let i = 0; i < 3; i++) reportClientError(same, 'react')
    for (let i = 0; i < 20; i++) reportClientError(new Error(`error ${i}`), 'web_rejection')
    await vi.advanceTimersByTimeAsync(2_000)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(sent()).toHaveLength(10)
    expect(sent().filter((r: { message: string }) => r.message === 'boom')).toHaveLength(1)
  })

  it('a failing send and a non-Error value never throw', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    expect(() => reportClientError('plain string', 'web_rejection')).not.toThrow()
    expect(() => reportClientError({ weird: true }, 'web_rejection')).not.toThrow()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(sent().map((r: { message: string }) => r.message)).toEqual(['plain string', 'Non-error value thrown'])
  })
})
