/**
 * Web client session recovery (browser). When an API call gets 401, the API
 * client runs one recovery *episode* per tab (concurrent 401s share it):
 *
 *   refresh 200                → recovered: callers retry their request once
 *   401 SESSION_RACE           → another tab rotated the shared cookies: wait
 *                                300–800 ms, retry the request once WITHOUT
 *                                refreshing; still 401 → one more refresh;
 *                                a second race → login
 *   401 terminal codes         → login (?expired=1); no retries
 *   503 SESSION_BUSY           → wait Retry-After + jitter, try again
 *   network error / timeout    → retry the same refresh after 1 s, then 2 s,
 *                                only within 45 s of the first attempt
 *   at most 3 refresh calls per episode; a failed episode (busy / offline)
 *   starts a 30 s cool-down without automatic refreshes. Cookies are never
 *   touched by the client and logout is never called because of a failure.
 *
 * Pure logic with injected dependencies (tests use fake time).
 */

export type RefreshOutcome =
  | { kind: 'refreshed' }
  | { kind: 'race' }
  | { kind: 'busy'; retryAfterMs: number }
  | { kind: 'terminal'; code: string }
  | { kind: 'network' }

export type EpisodeResult =
  /** Session usable again. `response` = the caller's request already retried (race path). */
  | { kind: 'recovered'; response?: Response }
  | { kind: 'login' }
  | { kind: 'busy' }
  | { kind: 'offline' }

export interface RecoveryDeps {
  /** One POST /api/v1/auth/refresh, classified. */
  refresh(): Promise<RefreshOutcome>
  /** Re-send the request that got 401 (race path only). */
  retryOriginal(): Promise<Response>
  sleep(ms: number): Promise<void>
  /** Monotonic milliseconds. */
  now(): number
  random(): number
}

export const MAX_REFRESH_ATTEMPTS = 3
export const COOL_DOWN_MS = 30_000
export const NETWORK_RETRY_WINDOW_MS = 45_000
const NETWORK_DELAYS_MS = [1_000, 2_000]

export const TERMINAL_CODES = new Set(['INVALID_TOKEN', 'SESSION_EXPIRED', 'SESSION_REVOKED', 'REFRESH_REUSED', 'CLIENT_MISMATCH'])

/** Classify a refresh response (or a thrown fetch) into an outcome. */
export async function classifyRefreshResponse(res: Response | null): Promise<RefreshOutcome> {
  if (!res) return { kind: 'network' }
  if (res.ok) return { kind: 'refreshed' }
  let code = ''
  try {
    const body = (await res.json()) as { code?: unknown }
    if (typeof body?.code === 'string') code = body.code
  } catch {
    /* not JSON */
  }
  if (res.status === 503 && code === 'SESSION_BUSY') {
    const seconds = Number(res.headers.get('retry-after'))
    return { kind: 'busy', retryAfterMs: Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 10) * 1000 : 1000 }
  }
  if (res.status === 401 && code === 'SESSION_RACE') return { kind: 'race' }
  if (res.status >= 500 || res.status === 0) return { kind: 'network' }
  // terminal codes, an unknown 401, or anything else: the session cannot be recovered
  return { kind: 'terminal', code: code || `HTTP_${res.status}` }
}

/** One recovery episode (see the module comment). */
export async function runEpisode(deps: RecoveryDeps): Promise<EpisodeResult> {
  const started = deps.now()
  let networkFailures = 0
  let racesSeen = 0
  let last: EpisodeResult = { kind: 'login' }

  for (let attempt = 1; attempt <= MAX_REFRESH_ATTEMPTS; attempt++) {
    const outcome = await deps.refresh()
    switch (outcome.kind) {
      case 'refreshed':
        return { kind: 'recovered' }
      case 'terminal':
        return { kind: 'login' }
      case 'race': {
        racesSeen++
        if (racesSeen > 1) return { kind: 'login' }
        await deps.sleep(300 + Math.floor(deps.random() * 500))
        const res = await deps.retryOriginal()
        if (res.status !== 401) return { kind: 'recovered', response: res }
        last = { kind: 'login' }
        continue // one more refresh
      }
      case 'busy':
        last = { kind: 'busy' }
        if (attempt < MAX_REFRESH_ATTEMPTS) await deps.sleep(outcome.retryAfterMs + Math.floor(deps.random() * 500))
        continue
      case 'network': {
        last = { kind: 'offline' }
        const delay = NETWORK_DELAYS_MS[Math.min(networkFailures, NETWORK_DELAYS_MS.length - 1)]
        networkFailures++
        // retrying with the same token is safe only while the server would still replay it (< 60 s)
        if (attempt >= MAX_REFRESH_ATTEMPTS || deps.now() + delay - started >= NETWORK_RETRY_WINDOW_MS) return last
        await deps.sleep(delay)
        continue
      }
    }
  }
  return last
}

/** Per-tab coordinator: one episode at a time, cool-down after a failed one. */
export function createRecovery(depsFor: (retryOriginal: () => Promise<Response>) => RecoveryDeps) {
  let inFlight: Promise<EpisodeResult> | null = null
  let coolDownUntil = 0
  let coolDownResult: EpisodeResult = { kind: 'busy' }

  return {
    /** Recover after a 401. The first caller's request doubles as the race probe; others re-send their own. */
    async recover(retryOriginal: () => Promise<Response>): Promise<EpisodeResult> {
      const deps = depsFor(retryOriginal)
      if (deps.now() < coolDownUntil) return coolDownResult
      if (inFlight) {
        const shared = await inFlight
        // a cached probe response belongs to the first caller only
        return shared.kind === 'recovered' ? { kind: 'recovered' } : shared
      }
      inFlight = runEpisode(deps).then((result) => {
        if (result.kind === 'busy' || result.kind === 'offline') {
          coolDownUntil = deps.now() + COOL_DOWN_MS
          coolDownResult = result
        }
        return result
      })
      try {
        return await inFlight
      } finally {
        inFlight = null
      }
    },
    /** Tests only. */
    reset() {
      inFlight = null
      coolDownUntil = 0
    },
  }
}
