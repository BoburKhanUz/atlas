/**
 * Session glue for routes and the page proxy (server only, Node.js runtime).
 * The protocol itself — families, rotation, grace replay, reuse detection,
 * revocation — lives in src/server/session/protocol.ts.
 *
 * Client modes (`X-Atlas-Client` selects the response format only; the
 * security rules come from the stored family's clientType):
 *   web (default, any other value) — tokens only in HttpOnly cookies:
 *     ACCESS_COOKIE  access JWT, HttpOnly, SameSite=Lax, Path=/
 *     REFRESH_COOKIE opaque refresh token (stored hashed), HttpOnly,
 *                    SameSite=Lax, Path=/ (sent on page loads so the proxy can
 *                    renew a session)
 *   mobile (`X-Atlas-Client: mobile`) — tokens in JSON bodies, never cookies;
 *     refresh and logout take `{ refreshToken }` in the body; API calls use
 *     `Authorization: Bearer <accessToken>`.
 * Cookies are `Secure` in production unless COOKIE_SECURE=0 (see config.ts).
 *
 * Access tokens are NOT checked against the database per request: a revoked
 * family keeps API access until its access token expires (≤ 15 min).
 */

import { cookies } from 'next/headers'
import type { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getUserFromAuthHeader, verifyAccessTokenOrNull, type JwtPayload } from '@/lib/auth'
import { secureCookiesEnabled } from '@/lib/config'
import {
  TERMINAL_SESSION_CODES,
  endSession,
  refreshSession,
  startSession,
  type ClientType,
  type IssuedSession,
  type RefreshResult,
  type SessionErrorCode,
  type SessionUser,
} from '@/server/session/protocol'

export type { ClientType, IssuedSession, SessionErrorCode, SessionUser } from '@/server/session/protocol'

export const ACCESS_COOKIE = 'atlas_at'
export const REFRESH_COOKIE = 'atlas_rt'
export const REFRESH_COOKIE_PATH = '/'
export const CLIENT_HEADER = 'x-atlas-client'

/** `X-Atlas-Client: mobile` selects mobile (body-token) mode; anything else is web. */
export function clientTypeOf(req: Request): ClientType {
  return req.headers.get(CLIENT_HEADER)?.trim().toLowerCase() === 'mobile' ? 'mobile' : 'web'
}

// ─── Cookies ────────────────────────────────────────────────────────────────

type CookieJar = NextResponse['cookies']

function baseCookie() {
  return { httpOnly: true, sameSite: 'lax' as const, secure: secureCookiesEnabled() }
}

// Rounded up: JWT expiries are whole seconds while issuedAt has milliseconds,
// so a cookie may outlive its token by < 1 s (the server rejects it then).
const secondsBetween = (from: Date, to: Date) => Math.max(0, Math.ceil((to.getTime() - from.getTime()) / 1000))

export function setSessionCookies(res: { cookies: CookieJar }, issued: IssuedSession) {
  res.cookies.set(ACCESS_COOKIE, issued.accessToken, {
    ...baseCookie(),
    path: '/',
    maxAge: secondsBetween(issued.issuedAt, issued.accessTokenExpiresAt),
  })
  res.cookies.set(REFRESH_COOKIE, issued.refreshToken, {
    ...baseCookie(),
    path: REFRESH_COOKIE_PATH,
    maxAge: secondsBetween(issued.issuedAt, issued.refreshTokenExpiresAt),
  })
}

export function clearSessionCookies(res: { cookies: CookieJar }) {
  res.cookies.set(ACCESS_COOKIE, '', { ...baseCookie(), path: '/', maxAge: 0 })
  res.cookies.set(REFRESH_COOKIE, '', { ...baseCookie(), path: REFRESH_COOKIE_PATH, maxAge: 0 })
}

/** JSON body of a mobile-mode login / register / refresh. */
export function mobileTokenBody(user: SessionUser, issued: IssuedSession) {
  return {
    user,
    accessToken: issued.accessToken,
    accessTokenExpiresAt: issued.accessTokenExpiresAt.toISOString(),
    refreshToken: issued.refreshToken,
    refreshTokenExpiresAt: issued.refreshTokenExpiresAt.toISOString(),
    sessionExpiresAt: issued.sessionExpiresAt.toISOString(),
  }
}

// ─── Sessions (bound to the app database) ───────────────────────────────────

/** Start a new session family for a freshly authenticated user. */
export function createSession(
  user: SessionUser,
  opts: { clientType: ClientType; userAgent?: string | null; deviceName?: string | null },
): Promise<IssuedSession> {
  return startSession(db, user, opts)
}

export type RotateResult =
  | Extract<RefreshResult, { ok: true }>
  /** clearCookies: web clients drop their cookies only on terminal codes (never on SESSION_RACE / SESSION_BUSY). */
  | { ok: false; code: SessionErrorCode; clearCookies: boolean }

/** Refresh (rotate or grace-replay). Shared by POST /api/v1/auth/refresh and the page proxy. */
export async function rotateSession(
  refreshToken: string | null | undefined,
  opts: { clientType: ClientType; userAgent?: string | null },
): Promise<RotateResult> {
  const result = await refreshSession(db, refreshToken, opts)
  if (result.ok) return result
  return { ok: false, code: result.code, clearCookies: TERMINAL_SESSION_CODES.has(result.code) }
}

/** Logout: revoke the family of the session named by a refresh token or an access-token sid. */
export function revokeSession(opts: { refreshToken?: string | null; sid?: string | null; userId?: string | null }) {
  return endSession(db, opts)
}

// ─── Request authentication ─────────────────────────────────────────────────

/**
 * Authenticate an API request. An Authorization header, when present, is the
 * only credential considered (no fallback to cookies) — that is what makes
 * bearer requests safe to exempt from the CSRF origin check.
 */
export async function authenticateRequest(
  req: NextRequest,
): Promise<{ user: JwtPayload | null; via: 'bearer' | 'cookie' | null }> {
  const authz = req.headers.get('authorization')
  if (authz !== null) return { user: await getUserFromAuthHeader(authz), via: 'bearer' }
  const token = req.cookies.get(ACCESS_COOKIE)?.value
  if (!token) return { user: null, via: null }
  return { user: await verifyAccessTokenOrNull(token), via: 'cookie' }
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function requestHost(req: NextRequest): string {
  const forwarded = process.env.TRUST_PROXY === '1' ? req.headers.get('x-forwarded-host')?.split(',')[0]?.trim() : null
  return (forwarded || req.headers.get('host') || req.nextUrl.host).toLowerCase()
}

/**
 * CSRF guard: a state-changing, cookie-carrying request (no Authorization
 * header) whose Origin header names another host. Requests without an Origin
 * header pass (SameSite=Lax already keeps the cookies off cross-site POSTs in
 * modern browsers; this is the second layer).
 */
export function isCrossOriginCookieRequest(req: NextRequest): boolean {
  if (!STATE_CHANGING.has(req.method.toUpperCase())) return false
  if (req.headers.get('authorization') !== null) return false
  if (!req.cookies.has(ACCESS_COOKIE) && !req.cookies.has(REFRESH_COOKIE)) return false
  const origin = req.headers.get('origin')
  if (!origin) return false
  let originHost: string
  try {
    originHost = new URL(origin).host.toLowerCase()
  } catch {
    return true // "null" or garbage — never same-origin
  }
  return originHost !== requestHost(req)
}

/** Only same-origin relative paths are allowed as post-login redirect targets. */
// One implementation for client and server — see src/lib/routes.ts.
export { safeNextPath } from '@/lib/routes'

/**
 * For Server Components / layouts: the signed-in user from the access cookie,
 * or null when there is no valid session. Never throws for a bad/expired token
 * (a ConfigError — missing/insecure secret — is rethrown).
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies()
  const payload = await verifyAccessTokenOrNull(store.get(ACCESS_COOKIE)?.value)
  if (!payload) return null
  const user = await db.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true, name: true },
  })
  return user ?? null
}
