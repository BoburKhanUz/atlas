/**
 * CLI-W1..W6: web client session recovery (src/lib/session-recovery.ts and its
 * use in src/lib/api-client.ts) — every response row of the recovery table,
 * attempt limits, the 30 s cool-down, the 45 s network window, and that the
 * client never calls logout or touches storage on a failure.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COOL_DOWN_MS,
  MAX_REFRESH_ATTEMPTS,
  classifyRefreshResponse,
  createRecovery,
  runEpisode,
  type RecoveryDeps,
  type RefreshOutcome,
} from '@/lib/session-recovery'

/** Deterministic deps: a scripted refresh sequence and a fake clock advanced by sleep(). */
function script(outcomes: RefreshOutcome[], opts: { retryStatus?: number[]; refreshTakesMs?: number } = {}) {
  let t = 0
  const calls = { refresh: 0, retry: 0, sleeps: [] as number[] }
  const retryStatuses = [...(opts.retryStatus ?? [])]
  const deps: RecoveryDeps = {
    refresh: async () => {
      calls.refresh++
      t += opts.refreshTakesMs ?? 0
      const next = outcomes.shift()
      if (!next) throw new Error('unexpected refresh call')
      return next
    },
    retryOriginal: async () => {
      calls.retry++
      return new Response(null, { status: retryStatuses.shift() ?? 200 })
    },
    sleep: async (ms) => {
      calls.sleeps.push(ms)
      t += ms
    },
    now: () => t,
    random: () => 0.5,
  }
  return { deps, calls, time: () => t }
}

const R = {
  ok: { kind: 'refreshed' } as const,
  race: { kind: 'race' } as const,
  busy: { kind: 'busy', retryAfterMs: 1000 } as const,
  net: { kind: 'network' } as const,
  terminal: (code = 'REFRESH_REUSED') => ({ kind: 'terminal', code }) as const,
}

describe('CLI-W1: response classification', () => {
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

  it('maps server responses to outcomes', async () => {
    expect(await classifyRefreshResponse(json(200, { user: {} }))).toEqual({ kind: 'refreshed' })
    expect(await classifyRefreshResponse(json(401, { code: 'SESSION_RACE' }))).toEqual({ kind: 'race' })
    expect(await classifyRefreshResponse(json(503, { code: 'SESSION_BUSY' }, { 'retry-after': '2' }))).toEqual({ kind: 'busy', retryAfterMs: 2000 })
    expect(await classifyRefreshResponse(json(503, { code: 'SESSION_BUSY' }))).toEqual({ kind: 'busy', retryAfterMs: 1000 })
    for (const code of ['INVALID_TOKEN', 'SESSION_EXPIRED', 'SESSION_REVOKED', 'REFRESH_REUSED', 'CLIENT_MISMATCH']) {
      expect(await classifyRefreshResponse(json(401, { code }))).toEqual({ kind: 'terminal', code })
    }
    expect(await classifyRefreshResponse(json(401, { code: 'UNAUTHORIZED' }))).toEqual({ kind: 'terminal', code: 'UNAUTHORIZED' })
    expect(await classifyRefreshResponse(null)).toEqual({ kind: 'network' })
    expect(await classifyRefreshResponse(new Response('bad gateway', { status: 502 }))).toEqual({ kind: 'network' })
  })
})

describe('CLI-W2: one episode', () => {
  it('200 → recovered after one refresh', async () => {
    const s = script([R.ok])
    expect(await runEpisode(s.deps)).toEqual({ kind: 'recovered' })
    expect(s.calls).toMatchObject({ refresh: 1, retry: 0 })
  })

  it('terminal codes → login immediately, no retries', async () => {
    for (const code of ['INVALID_TOKEN', 'SESSION_EXPIRED', 'SESSION_REVOKED', 'REFRESH_REUSED', 'CLIENT_MISMATCH']) {
      const s = script([R.terminal(code)])
      expect(await runEpisode(s.deps)).toEqual({ kind: 'login' })
      expect(s.calls).toMatchObject({ refresh: 1, retry: 0, sleeps: [] })
    }
  })

  it('SESSION_RACE → wait 300–800 ms, retry the request without refreshing; success ends the episode', async () => {
    const s = script([R.race], { retryStatus: [200] })
    const result = await runEpisode(s.deps)
    expect(result.kind).toBe('recovered')
    expect(result.kind === 'recovered' && result.response?.status).toBe(200)
    expect(s.calls.refresh).toBe(1)
    expect(s.calls.retry).toBe(1)
    expect(s.calls.sleeps).toEqual([550])
    expect(s.calls.sleeps[0]).toBeGreaterThanOrEqual(300)
    expect(s.calls.sleeps[0]).toBeLessThanOrEqual(800)
  })

  it('SESSION_RACE, retry still 401 → one more refresh; a second race → login', async () => {
    const s1 = script([R.race, R.ok], { retryStatus: [401] })
    expect(await runEpisode(s1.deps)).toEqual({ kind: 'recovered' })
    expect(s1.calls).toMatchObject({ refresh: 2, retry: 1 })
    const s2 = script([R.race, R.race], { retryStatus: [401] })
    expect(await runEpisode(s2.deps)).toEqual({ kind: 'login' })
    expect(s2.calls).toMatchObject({ refresh: 2, retry: 1 })
  })

  it('SESSION_BUSY → waits Retry-After + jitter between attempts; gives up as busy after 3 refreshes', async () => {
    const s = script([R.busy, R.busy, R.busy])
    expect(await runEpisode(s.deps)).toEqual({ kind: 'busy' })
    expect(s.calls.refresh).toBe(MAX_REFRESH_ATTEMPTS)
    expect(s.calls.sleeps).toEqual([1250, 1250])
    const ok = script([R.busy, R.ok])
    expect(await runEpisode(ok.deps)).toEqual({ kind: 'recovered' })
  })

  it('network errors → retry the same refresh after 1 s, then 2 s; then offline (never more than 3 calls)', async () => {
    const s = script([R.net, R.net, R.net])
    expect(await runEpisode(s.deps)).toEqual({ kind: 'offline' })
    expect(s.calls.refresh).toBe(3)
    expect(s.calls.sleeps).toEqual([1000, 2000])
    const recovered = script([R.net, R.ok])
    expect(await runEpisode(recovered.deps)).toEqual({ kind: 'recovered' })
  })

  it('CLI-W5: network retries stop once 45 s have passed since the first attempt', async () => {
    // each refresh attempt hangs until its 12 s client timeout
    const s = script([R.net, R.net, R.net], { refreshTakesMs: 12_000 })
    expect(await runEpisode(s.deps)).toEqual({ kind: 'offline' })
    expect(s.calls.refresh).toBe(3) // 12 + 1 + 12 + 2 + 12 = 39 s < 45 s
    const slow = script([R.net, R.net, R.net], { refreshTakesMs: 22_000 })
    expect(await runEpisode(slow.deps)).toEqual({ kind: 'offline' })
    expect(slow.calls.refresh).toBe(2) // 22 + 1 + 22 = 45 s → no third attempt
    expect(slow.time()).toBeLessThan(46_000)
  })

  it('CLI-W3: the attempt limit holds for every mix of outcomes', async () => {
    const kinds: RefreshOutcome[] = [R.busy, R.net, R.race]
    for (const a of kinds) for (const b of kinds) for (const c of kinds) for (const d of kinds) {
      const s = script([a, b, c, d], { retryStatus: [401, 401, 401] })
      await runEpisode(s.deps)
      expect(s.calls.refresh).toBeLessThanOrEqual(MAX_REFRESH_ATTEMPTS)
      expect(s.calls.retry).toBeLessThanOrEqual(1)
    }
  })
})

describe('CLI-W4: per-tab coordinator', () => {
  it('concurrent 401s share one episode (one refresh)', async () => {
    let refreshes = 0
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const rec = createRecovery((retryOriginal) => ({
      refresh: async () => {
        refreshes++
        await gate
        return R.ok
      },
      retryOriginal,
      sleep: async () => {},
      now: () => 0,
      random: () => 0,
    }))
    const all = Promise.all([1, 2, 3].map(() => rec.recover(async () => new Response(null, { status: 200 }))))
    release()
    expect((await all).map((r) => r.kind)).toEqual(['recovered', 'recovered', 'recovered'])
    expect(refreshes).toBe(1)
  })

  it('a failed episode starts a 30 s cool-down without refresh calls; afterwards a new episode runs', async () => {
    let t = 0
    let refreshes = 0
    const outcomes: RefreshOutcome[] = [R.busy, R.busy, R.busy, R.ok]
    const rec = createRecovery((retryOriginal) => ({
      refresh: async () => {
        refreshes++
        return outcomes.shift()!
      },
      retryOriginal,
      sleep: async (ms) => {
        t += ms
      },
      now: () => t,
      random: () => 0,
    }))
    const probe = async () => new Response(null, { status: 401 })
    expect(await rec.recover(probe)).toEqual({ kind: 'busy' })
    expect(refreshes).toBe(3)
    t += COOL_DOWN_MS - 1
    expect(await rec.recover(probe)).toEqual({ kind: 'busy' })
    expect(refreshes).toBe(3) // no network during the cool-down
    t += 1
    expect(await rec.recover(probe)).toEqual({ kind: 'recovered' })
    expect(refreshes).toBe(4)
  })
})

describe('CLI-W6: api() — retries once, never calls logout, never touches storage', () => {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
  const assign = vi.fn()
  const storage = { setItem: vi.fn(), removeItem: vi.fn(), getItem: vi.fn(), clear: vi.fn() }

  beforeEach(async () => {
    vi.resetModules()
    fetchMock.mockReset()
    assign.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('window', { location: { pathname: '/outfits', search: '', assign }, localStorage: storage, sessionStorage: storage })
    storage.setItem.mockReset()
    storage.removeItem.mockReset()
  })
  afterEach(() => vi.unstubAllGlobals())

  const jsonRes = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
  const urls = () => fetchMock.mock.calls.map((c) => String(c[0]))

  async function load() {
    const mod = await import('@/lib/api-client')
    storage.removeItem.mockReset() // ignore the one-time legacy-token cleanup at import
    return mod
  }

  it('401 → refresh 200 → the request is retried once and succeeds', async () => {
    const { api } = await load()
    fetchMock
      .mockResolvedValueOnce(jsonRes(401, { code: 'UNAUTHORIZED' }))
      .mockResolvedValueOnce(jsonRes(200, { user: {} }))
      .mockResolvedValueOnce(jsonRes(200, { items: [] }))
    expect(await api('/api/v1/wardrobe/items')).toEqual({ items: [] })
    expect(urls()).toEqual(['/api/v1/wardrobe/items', '/api/v1/auth/refresh', '/api/v1/wardrobe/items'])
  })

  it('terminal refresh failure → /login?next=…&expired=1, no logout call, nothing stored', async () => {
    const { api } = await load()
    fetchMock.mockResolvedValueOnce(jsonRes(401, { code: 'UNAUTHORIZED' })).mockResolvedValueOnce(jsonRes(401, { code: 'REFRESH_REUSED' }))
    void api('/api/v1/outfits')
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('/login?next=%2Foutfits&expired=1'))
    expect(urls()).not.toContain('/api/v1/auth/logout')
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(storage.removeItem).not.toHaveBeenCalled()
  })

  it('SESSION_BUSY ×3 → ApiError SESSION_BUSY (session kept, no redirect, no logout)', async () => {
    vi.useFakeTimers()
    try {
      const { api, ApiError } = await load()
      fetchMock.mockResolvedValueOnce(jsonRes(401, { code: 'UNAUTHORIZED' }))
      for (let i = 0; i < 3; i++) fetchMock.mockResolvedValueOnce(jsonRes(503, { code: 'SESSION_BUSY' }, { 'retry-after': '1' }))
      const p = api<{ code?: string }>('/api/v1/outfits').catch((e: { code?: string }) => e)
      await vi.runAllTimersAsync()
      const err = await p
      expect(err).toBeInstanceOf(ApiError)
      expect(err.code).toBe('SESSION_BUSY')
      expect(urls().filter((u) => u.endsWith('/auth/refresh'))).toHaveLength(3)
      expect(urls()).not.toContain('/api/v1/auth/logout')
      expect(assign).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('SESSION_RACE → the request is retried without another refresh and succeeds', async () => {
    vi.useFakeTimers()
    try {
      const { api } = await load()
      fetchMock
        .mockResolvedValueOnce(jsonRes(401, { code: 'UNAUTHORIZED' }))
        .mockResolvedValueOnce(jsonRes(401, { code: 'SESSION_RACE' }))
        .mockResolvedValueOnce(jsonRes(200, { ok: true }))
      const p = api('/api/v1/outfits')
      await vi.runAllTimersAsync()
      expect(await p).toEqual({ ok: true })
      expect(urls()).toEqual(['/api/v1/outfits', '/api/v1/auth/refresh', '/api/v1/outfits'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('network failure on refresh → ApiError NETWORK_ERROR after 3 attempts; cookies are the server’s business', async () => {
    vi.useFakeTimers()
    try {
      const { api } = await load()
      fetchMock.mockResolvedValueOnce(jsonRes(401, { code: 'UNAUTHORIZED' }))
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
      const p = api<{ code?: string }>('/api/v1/outfits').catch((e: { code?: string }) => e)
      await vi.runAllTimersAsync()
      expect((await p).code).toBe('NETWORK_ERROR')
      expect(urls().filter((u) => u.endsWith('/auth/refresh'))).toHaveLength(3)
      expect(assign).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('auth endpoints are never auto-refreshed', async () => {
    const { api } = await load()
    fetchMock.mockResolvedValueOnce(jsonRes(401, { code: 'UNAUTHORIZED', error: 'x' }))
    await expect(api('/api/v1/auth/me')).rejects.toMatchObject({ status: 401 })
    expect(urls()).toEqual(['/api/v1/auth/me'])
  })
})
