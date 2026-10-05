/**
 * Session lifecycle (server only, Node.js runtime).
 *
 * Cookies:
 *   ACCESS_COOKIE  — short-lived access JWT (15 min, claim `sid`), HttpOnly,
 *                    SameSite=Lax, Path=/
 *   REFRESH_COOKIE — opaque refresh token (32 random bytes, stored only as a
 *                    SHA-256 hash in Session), HttpOnly, SameSite=Lax, Path=/.
 *                    It must be sent on page requests so src/proxy.ts can
 *                    rotate it on a reload/navigation after the access token
 *                    expired (a narrower Path=/api/v1/auth was never sent on
 *                    page loads — found by the Playwright session suite).
 *   Both are `Secure` in production unless COOKIE_SECURE=0 (see config.ts).
 *
 * Refresh rotation: every refresh revokes the presented session and issues a
 * new one (old.replacedById = new.id). Presenting an already-rotated token is
 * treated as theft and revokes all of the user's sessions — except within a
 * short grace window, which covers two tabs refreshing at the same moment.
 *
 * Access tokens are NOT checked against the Session table on every request:
 * revocation (logout, reuse detection) takes effect for API calls when the
 * access token expires (≤ 15 min). Logout also clears the cookie immediately.
 */

import { cookies } from 'next/headers'
import type { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  generateRefreshToken,
  getUserFromAuthHeader,
  hashToken,
  signAccessToken,
  verifyAccessTokenOrNull,
  type JwtPayload,
} from '@/lib/auth'
import { getAccessTokenTtlSeconds, getRefreshTokenTtlSeconds, secureCookiesEnabled } from '@/lib/config'
import { log } from '@/server/log'

export const ACCESS_COOKIE = 'atlas_at'
export const REFRESH_COOKIE = 'atlas_rt'
export const REFRESH_COOKIE_PATH = '/'

/** A rotated token presented again within this window is a concurrent-tab race, not theft. */
export const REUSE_GRACE_MS = 30_000

const USER_AGENT_MAX = 200
const REFRESH_TOKEN_MAX_LENGTH = 128

export interface SessionUser {
  id: string
  email: string
  name: string | null
}

export interface IssuedSession {
  sessionId: string
  accessToken: string
  /** null for a grace-period access grant: the refresh cookie is left as-is. */
  refreshToken: string | null
}

// ─── Cookies ────────────────────────────────────────────────────────────────

type CookieJar = NextResponse['cookies']

function baseCookie() {
  return { httpOnly: true, sameSite: 'lax' as const, secure: secureCookiesEnabled() }
}

export function setSessionCookies(res: { cookies: CookieJar }, issued: Pick<IssuedSession, 'accessToken' | 'refreshToken'>) {
  res.cookies.set(ACCESS_COOKIE, issued.accessToken, {
    ...baseCookie(),
    path: '/',
    maxAge: getAccessTokenTtlSeconds(),
  })
  if (issued.refreshToken === null) return
  res.cookies.set(REFRESH_COOKIE, issued.refreshToken, {
    ...baseCookie(),
    path: REFRESH_COOKIE_PATH,
    maxAge: getRefreshTokenTtlSeconds(),
  })
}

export function clearSessionCookies(res: { cookies: CookieJar }) {
  res.cookies.set(ACCESS_COOKIE, '', { ...baseCookie(), path: '/', maxAge: 0 })
  res.cookies.set(REFRESH_COOKIE, '', { ...baseCookie(), path: REFRESH_COOKIE_PATH, maxAge: 0 })
}

// ─── Session rows ───────────────────────────────────────────────────────────

function truncateUserAgent(ua: string | null | undefined): string | null {
  return ua ? ua.slice(0, USER_AGENT_MAX) : null
}

/** Create a session row for a freshly authenticated user and mint both tokens. */
export async function createSession(
  user: { id: string; email: string },
  userAgent?: string | null,
  now: Date = new Date(),
): Promise<IssuedSession> {
  const refreshToken = generateRefreshToken()
  const session = await db.session.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(now.getTime() + getRefreshTokenTtlSeconds() * 1000),
      userAgent: truncateUserAgent(userAgent),
    },
    select: { id: true },
  })
  const accessToken = await signAccessToken({ sub: user.id, email: user.email, sid: session.id })
  return { sessionId: session.id, accessToken, refreshToken }
}

export type RotateFailure = 'missing' | 'invalid' | 'expired' | 'revoked' | 'race' | 'reuse'

export type RotateResult =
  /** graced: a concurrent request already rotated this token; only an access token was issued. */
  | { ok: true; user: SessionUser; issued: IssuedSession; graced?: boolean }
  /** clearCookies=false for `race`: the winning response already set fresh cookies. */
  | { ok: false; reason: RotateFailure; clearCookies: boolean }

class LostRotationRace extends Error {}

/**
 * Concurrent-request race: the presented token was rotated moments ago by a
 * parallel request (another tab, a page load + an API call). Instead of
 * failing — which bounced the losing page load to /login — grant a short-lived
 * access token for the REPLACEMENT session, provided it is still live. The
 * refresh cookie is not touched: the winning response sets the new one.
 */
async function graceAccess(
  replacementId: string,
  user: SessionUser,
  now: Date,
): Promise<RotateResult> {
  const replacement = await db.session.findUnique({
    where: { id: replacementId },
    select: { id: true, revokedAt: true, expiresAt: true },
  })
  if (!replacement || replacement.revokedAt || replacement.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: 'race', clearCookies: false }
  }
  const accessToken = await signAccessToken({ sub: user.id, email: user.email, sid: replacement.id })
  return {
    ok: true,
    graced: true,
    user: { id: user.id, email: user.email, name: user.name },
    issued: { sessionId: replacement.id, accessToken, refreshToken: null },
  }
}

/**
 * Exchange a refresh token for a new session (refresh-token rotation).
 * Shared by POST /api/v1/auth/refresh and the page proxy.
 */
export async function rotateSession(
  refreshToken: string | null | undefined,
  userAgent?: string | null,
  now: Date = new Date(),
): Promise<RotateResult> {
  if (!refreshToken) return { ok: false, reason: 'missing', clearCookies: true }
  if (refreshToken.length > REFRESH_TOKEN_MAX_LENGTH) return { ok: false, reason: 'invalid', clearCookies: true }

  const current = await db.session.findUnique({
    where: { tokenHash: hashToken(refreshToken) },
    include: { user: { select: { id: true, email: true, name: true } } },
  })
  if (!current) return { ok: false, reason: 'invalid', clearCookies: true }

  if (current.revokedAt) {
    if (current.replacedById && now.getTime() - current.revokedAt.getTime() <= REUSE_GRACE_MS) {
      // Another request rotated this token moments ago; its response carries
      // the new refresh cookie. Do not punish the user.
      return graceAccess(current.replacedById, current.user, now)
    }
    if (current.replacedById) {
      // A rotated token came back: someone else holds a copy. Kill every session.
      await db.session.updateMany({
        where: { userId: current.userId, revokedAt: null },
        data: { revokedAt: now },
      })
      log.warn('refresh token reuse detected; all sessions revoked', { userId: current.userId })
      return { ok: false, reason: 'reuse', clearCookies: true }
    }
    // Revoked by logout / mass revocation — not a rotation, nothing more to do.
    return { ok: false, reason: 'revoked', clearCookies: true }
  }

  if (current.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: 'expired', clearCookies: true }
  }

  const nextToken = generateRefreshToken()
  let nextId: string
  try {
    nextId = await db.$transaction(async (tx) => {
      const next = await tx.session.create({
        data: {
          userId: current.userId,
          tokenHash: hashToken(nextToken),
          expiresAt: new Date(now.getTime() + getRefreshTokenTtlSeconds() * 1000),
          userAgent: truncateUserAgent(userAgent) ?? current.userAgent,
          lastUsedAt: now,
        },
        select: { id: true },
      })
      // Conditional update: if a concurrent request already rotated this row,
      // count is 0 and the whole transaction (incl. the new row) rolls back.
      const { count } = await tx.session.updateMany({
        where: { id: current.id, revokedAt: null },
        data: { revokedAt: now, replacedById: next.id, lastUsedAt: now },
      })
      if (count !== 1) throw new LostRotationRace()
      return next.id
    })
  } catch (err) {
    if (err instanceof LostRotationRace) {
      const winner = await db.session.findUnique({ where: { id: current.id }, select: { replacedById: true } })
      if (winner?.replacedById) return graceAccess(winner.replacedById, current.user, now)
      return { ok: false, reason: 'race', clearCookies: false }
    }
    throw err
  }

  const user = current.user
  const accessToken = await signAccessToken({ sub: user.id, email: user.email, sid: nextId })
  return {
    ok: true,
    user: { id: user.id, email: user.email, name: user.name },
    issued: { sessionId: nextId, accessToken, refreshToken: nextToken },
  }
}

/** Revoke the session identified by a refresh token and/or an access-token sid. Idempotent. */
export async function revokeSession(
  opts: { refreshToken?: string | null; sid?: string | null; userId?: string | null },
  now: Date = new Date(),
): Promise<void> {
  if (opts.refreshToken && opts.refreshToken.length <= REFRESH_TOKEN_MAX_LENGTH) {
    await db.session.updateMany({
      where: { tokenHash: hashToken(opts.refreshToken), revokedAt: null },
      data: { revokedAt: now },
    })
  }
  if (opts.sid && opts.userId) {
    await db.session.updateMany({
      where: { id: opts.sid, userId: opts.userId, revokedAt: null },
      data: { revokedAt: now },
    })
  }
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
