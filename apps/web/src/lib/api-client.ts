/**
 * Browser-side API client.
 *
 * Auth is cookie-based (HttpOnly access + refresh cookies set by the server),
 * so nothing auth-related is stored in JS. Every request is sent with
 * `credentials: 'same-origin'`. When a non-auth endpoint answers 401, one
 * recovery episode per tab refreshes the session (src/lib/session-recovery.ts:
 * race / busy / network handling, at most 3 refresh calls) and the request is
 * retried once. A session that cannot be recovered sends the user to
 * /login?next=…&expired=1; a busy server or a lost connection surfaces as an
 * ApiError (SESSION_BUSY / NETWORK_ERROR) and keeps the session.
 *
 * Errors are thrown as ApiError with the server's Uzbek `error` message and
 * machine-readable `code` ({ error, code, details?, requestId? }).
 */

import { createTranslator } from 'next-intl'
import uzMessages from '../../messages/uz.json'
import { classifyRefreshResponse, createRecovery } from '@/lib/session-recovery'

// Fallback strings come from the message catalogue (errors namespace). The
// client runs outside React here, so we build a translator directly.
const tErrors = createTranslator({ locale: 'uz', messages: uzMessages, namespace: 'errors' })

// ─── Legacy cleanup: tokens used to live in localStorage ────────────────────
const LEGACY_TOKEN_KEYS = ['fashion_access_token', 'fashion_refresh_token']
if (typeof window !== 'undefined') {
  try {
    for (const k of LEGACY_TOKEN_KEYS) window.localStorage.removeItem(k)
  } catch {
    /* storage unavailable (private mode etc.) — nothing to clean */
  }
}

export class ApiError extends Error {
  status: number
  code: string
  details?: unknown
  requestId?: string
  constructor(
    message: string,
    status: number,
    code = 'UNKNOWN',
    extra: { details?: unknown; requestId?: string } = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = extra.details
    this.requestId = extra.requestId
  }
}

interface FetchOpts {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT'
  body?: unknown
  /** Multipart payload — sent as-is instead of a JSON body. */
  asForm?: FormData
  signal?: AbortSignal
}

const AUTH_PREFIX = '/api/v1/auth/'
const REFRESH_PATH = '/api/v1/auth/refresh'

// ─── Session recovery (one episode per tab) ─────────────────────────────────
const REFRESH_TIMEOUT_MS = 12_000

async function postRefresh(): Promise<Response | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS)
  try {
    return await fetch(REFRESH_PATH, { method: 'POST', credentials: 'same-origin', signal: controller.signal })
  } catch {
    return null // network error or timeout
  } finally {
    clearTimeout(timer)
  }
}

export const sessionRecovery = createRecovery((retryOriginal) => ({
  refresh: async () => classifyRefreshResponse(await postRefresh()),
  retryOriginal,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  random: Math.random,
}))

let redirectingToLogin = false

function redirectToLogin(): Promise<never> {
  if (typeof window !== 'undefined' && !redirectingToLogin) {
    redirectingToLogin = true
    const here = window.location.pathname + window.location.search
    // Deliberate full document navigation (not router.push): this module has no
    // router, and after a terminal session error every in-memory store/cache of
    // the signed-out user must be discarded and the proxy must see the cleared
    // cookies. A client-side transition would keep that state alive.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- intentional hard navigation, see above
    window.location.assign(`/login?next=${encodeURIComponent(here)}&expired=1`)
  }
  // Never settles: the page is navigating away, so callers shouldn't flash
  // error toasts / states in the meantime.
  return new Promise<never>(() => {})
}

// ─── Core request ───────────────────────────────────────────────────────────
function buildInit(opts: FetchOpts): RequestInit {
  const headers: Record<string, string> = {}
  const init: RequestInit = {
    method: opts.method ?? 'GET',
    credentials: 'same-origin',
    signal: opts.signal,
  }
  if (opts.asForm !== undefined) {
    init.body = opts.asForm
    // Do NOT set Content-Type for FormData — browser sets it with boundary
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(opts.body)
  }
  init.headers = headers
  return init
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function toApiError(res: Response, data: unknown): ApiError {
  const obj = data && typeof data === 'object' ? (data as Record<string, unknown>) : null
  const message =
    (obj && typeof obj.error === 'string' && obj.error) ||
    tErrors('request', { status: res.status })
  const code =
    (obj && typeof obj.code === 'string' && obj.code) ||
    (res.status === 401 ? 'UNAUTHORIZED' : `HTTP_${res.status}`)
  return new ApiError(message, res.status, code, {
    details: obj?.details,
    requestId: typeof obj?.requestId === 'string' ? obj.requestId : undefined,
  })
}

async function send(path: string, opts: FetchOpts): Promise<Response> {
  try {
    return await fetch(path, buildInit(opts))
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new ApiError(tErrors('network'), 0, 'NETWORK_ERROR')
  }
}

export async function api<T = unknown>(path: string, opts: FetchOpts = {}): Promise<T> {
  let res = await send(path, opts)

  const isAuthEndpoint = path.startsWith(AUTH_PREFIX)
  if (res.status === 401 && !isAuthEndpoint) {
    const outcome = await sessionRecovery.recover(() => send(path, opts))
    if (outcome.kind === 'login') return redirectToLogin()
    if (outcome.kind === 'busy') throw new ApiError(tErrors('sessionBusy'), 503, 'SESSION_BUSY')
    if (outcome.kind === 'offline') throw new ApiError(tErrors('network'), 0, 'NETWORK_ERROR')
    res = outcome.response ?? (await send(path, opts))
    if (res.status === 401) return redirectToLogin()
  }

  const data = await parseBody(res)
  if (!res.ok) throw toApiError(res, data)
  return data as T
}

/** Ends the server session (clears cookies). Never throws. */
export async function logoutRequest(): Promise<void> {
  try {
    await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'same-origin' })
  } catch {
    /* even if the network call fails, the caller navigates to /login */
  }
}
