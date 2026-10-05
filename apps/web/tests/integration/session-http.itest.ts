/**
 * Auth routes and the page proxy against real PostgreSQL (the app's own `db`
 * client, DATABASE_URL = the integration app database). Web mode (HttpOnly
 * cookies) and mobile mode (`X-Atlas-Client: mobile`, tokens in bodies).
 */
import { NextRequest } from 'next/server'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { POST as login } from '@/app/api/v1/auth/login/route'
import { POST as register } from '@/app/api/v1/auth/register/route'
import { POST as refresh } from '@/app/api/v1/auth/refresh/route'
import { POST as logout } from '@/app/api/v1/auth/logout/route'
import { GET as me } from '@/app/api/v1/auth/me/route'
import { hashToken, verifyAccessTokenOrNull } from '@/lib/auth'
import { resetRateLimits } from '@/lib/rate-limit'
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/session'
import { proxy } from '@/proxy'
import { APP_DB, enabled, rows, setClock, sql } from './pg'

const DB = APP_DB
const PASSWORD = 'correct horse battery'
let seq = 0

function request(
  path: string,
  { method = 'POST', cookies = {}, headers = {}, body }: { method?: string; cookies?: Record<string, string | undefined>; headers?: Record<string, string>; body?: unknown } = {},
) {
  const cookie = Object.entries(cookies)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: {
      host: 'localhost',
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

const MOBILE = { 'x-atlas-client': 'mobile' }
const setCookies = (res: Response) => res.headers.getSetCookie()
function cookieValue(res: Response, name: string) {
  return setCookies(res).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1).split(';')[0]
}
function isCleared(res: Response, name: string) {
  const line = setCookies(res).find((c) => c.startsWith(`${name}=`))
  return !!line && /Max-Age=0/i.test(line) && line.startsWith(`${name}=;`)
}

async function newAccount(headers: Record<string, string> = {}, extra: Record<string, unknown> = {}) {
  const email = `http_${process.pid}_${++seq}@test.local`
  const res = await register(request('/api/v1/auth/register', { body: { email, password: PASSWORD, ...extra }, headers }))
  expect(res.status).toBe(201)
  return { email, res }
}

async function webLogin() {
  const { email } = await newAccount()
  const res = await login(request('/api/v1/auth/login', { body: { email, password: PASSWORD } }))
  expect(res.status).toBe(200)
  return { email, res, at: cookieValue(res, ACCESS_COOKIE)!, rt: cookieValue(res, REFRESH_COOKIE)! }
}

const familyOf = (rt: string) => sql(DB, `SELECT "familyId" FROM "Session" WHERE "tokenHash" = '${hashToken(rt)}'`)
const family = (id: string) =>
  rows<{ clientType: string; revokedAt: string | null; revokeReason: string | null }>(
    DB,
    `SELECT "clientType", "revokedAt"::text, "revokeReason" FROM "SessionFamily" WHERE "id" = '${id}'`,
  )[0]
const liveInFamily = (id: string) => Number(sql(DB, `SELECT count(*) FROM "Session" WHERE "familyId" = '${id}' AND "revokedAt" IS NULL`))
/** Move a family's last rotation back in time (instead of waiting). */
const ageRotation = (rt: string, seconds: number) =>
  sql(DB, `UPDATE "Session" SET "rotatedAt" = "rotatedAt" - interval '${seconds} seconds' WHERE "tokenHash" = '${hashToken(rt)}'`)

describe.skipIf(!enabled)('auth routes and proxy (real PostgreSQL)', () => {
  beforeAll(() => setClock(DB, null)) // real database clock
  beforeEach(() => resetRateLimits())

  describe('web mode', () => {
    it('login sets HttpOnly SameSite=Lax cookies (Path=/, 15 min / 30 days) and no tokens in the body; only the hash is stored', async () => {
      const { res, at, rt, email } = await webLogin()
      const body = await res.json()
      expect(body).toEqual({ user: { id: expect.any(String), email, name: null } })
      expect(JSON.stringify(body)).not.toContain(at)
      expect(JSON.stringify(body)).not.toContain(rt)
      const atLine = setCookies(res).find((c) => c.startsWith('atlas_at='))!
      const rtLine = setCookies(res).find((c) => c.startsWith('atlas_rt='))!
      for (const line of [atLine, rtLine]) {
        expect(line).toMatch(/; Path=\/(;|$)/)
        expect(line).toMatch(/HttpOnly/i)
        expect(line).toMatch(/SameSite=Lax/i)
        expect(line).not.toMatch(/Secure/i) // NODE_ENV=test
      }
      expect(atLine).toMatch(/Max-Age=900(;|$)/)
      expect(rtLine).toMatch(/Max-Age=2592000(;|$)/)
      expect(sql(DB, `SELECT count(*) FROM "Session" WHERE "tokenHash" = '${hashToken(rt)}'`)).toBe('1')
      expect(sql(DB, `SELECT count(*) FROM "Session" WHERE "tokenHash" = '${rt}'`)).toBe('0')
      expect(family(familyOf(rt))).toEqual({ clientType: 'web', revokedAt: null, revokeReason: null })
    })

    it('cookies are Secure in production unless COOKIE_SECURE=0', async () => {
      const env = process.env as Record<string, string | undefined>
      const saved = { NODE_ENV: env.NODE_ENV, COOKIE_SECURE: env.COOKIE_SECURE }
      try {
        env.NODE_ENV = 'production'
        delete env.COOKIE_SECURE
        expect(setCookies((await webLogin()).res).every((c) => /;\s*Secure/i.test(c))).toBe(true)
        env.COOKIE_SECURE = '0'
        expect(setCookies((await webLogin()).res).some((c) => /;\s*Secure/i.test(c))).toBe(false)
      } finally {
        env.NODE_ENV = saved.NODE_ENV
        if (saved.COOKIE_SECURE === undefined) delete env.COOKIE_SECURE
        else env.COOKIE_SECURE = saved.COOKIE_SECURE
      }
    })

    it('register returns 201 { user } and sets both cookies; wrong password → 401 UNAUTHORIZED, no cookies', async () => {
      const { res, email } = await newAccount()
      expect(await res.json()).toEqual({ user: { id: expect.any(String), email, name: null } })
      expect(cookieValue(res, ACCESS_COOKIE)).toBeTruthy()
      expect(cookieValue(res, REFRESH_COOKIE)).toBeTruthy()
      const bad = await login(request('/api/v1/auth/login', { body: { email, password: 'nope-nope' } }))
      expect(bad.status).toBe(401)
      expect(await bad.json()).toMatchObject({ code: 'UNAUTHORIZED' })
      expect(setCookies(bad)).toHaveLength(0)
    })

    it('refresh rotates; an immediate replay of the old token returns the SAME new refresh token (grace) without rotating again', async () => {
      const { rt } = await webLogin()
      const res = await refresh(request('/api/v1/auth/refresh', { cookies: { atlas_rt: rt } }))
      expect(res.status).toBe(200)
      expect((await res.json()).user.email).toMatch(/@test\.local$/)
      const rt2 = cookieValue(res, REFRESH_COOKIE)!
      expect(rt2).not.toBe(rt)
      const again = await refresh(request('/api/v1/auth/refresh', { cookies: { atlas_rt: rt } }))
      expect(again.status).toBe(200)
      expect(cookieValue(again, REFRESH_COOKIE)).toBe(rt2)
      const payload = await verifyAccessTokenOrNull(cookieValue(again, ACCESS_COOKIE)!)
      expect(payload?.sid).toBe(sql(DB, `SELECT "id" FROM "Session" WHERE "tokenHash" = '${hashToken(rt2)}'`))
      expect(liveInFamily(familyOf(rt))).toBe(1)
      expect((await refresh(request('/api/v1/auth/refresh', { cookies: { atlas_rt: rt2 } }))).status).toBe(200)
    })

    it('reuse after the grace window → 401 REFRESH_REUSED, cookies cleared, only that family revoked', async () => {
      const first = await webLogin()
      const otherDevice = await login(request('/api/v1/auth/login', { body: { email: first.email, password: PASSWORD } }))
      const otherRt = cookieValue(otherDevice, REFRESH_COOKIE)!
      await refresh(request('/api/v1/auth/refresh', { cookies: { atlas_rt: first.rt } }))
      ageRotation(first.rt, 61)
      const res = await refresh(request('/api/v1/auth/refresh', { cookies: { atlas_rt: first.rt } }))
      expect(res.status).toBe(401)
      expect(await res.json()).toMatchObject({ code: 'REFRESH_REUSED' })
      expect(isCleared(res, ACCESS_COOKIE)).toBe(true)
      expect(isCleared(res, REFRESH_COOKIE)).toBe(true)
      expect(family(familyOf(first.rt)).revokeReason).toBe('reuse')
      expect((await refresh(request('/api/v1/auth/refresh', { cookies: { atlas_rt: otherRt } }))).status).toBe(200)
    })

    it('SESSION_RACE keeps cookies: a legacy-style replay inside the window gets 401 without Set-Cookie', async () => {
      const { rt } = await webLogin()
      const r = await refresh(request('/api/v1/auth/refresh', { cookies: { atlas_rt: rt } }))
      expect(r.status).toBe(200)
      // no stored successor → a replay inside the window cannot be served
      sql(DB, `UPDATE "Session" SET "successorTokenEnc" = NULL WHERE "tokenHash" = '${hashToken(rt)}'`)
      const res = await refresh(request('/api/v1/auth/refresh', { cookies: { atlas_rt: rt } }))
      expect(res.status).toBe(401)
      expect(await res.json()).toMatchObject({ code: 'SESSION_RACE' })
      expect(setCookies(res)).toHaveLength(0)
    })

    it('expired session → 401 SESSION_EXPIRED and both cookies cleared; unknown/missing → INVALID_TOKEN', async () => {
      const { rt } = await webLogin()
      sql(DB, `UPDATE "Session" SET "expiresAt" = (now() AT TIME ZONE 'UTC') - interval '1 second' WHERE "tokenHash" = '${hashToken(rt)}'`)
      const res = await refresh(request('/api/v1/auth/refresh', { cookies: { atlas_rt: rt } }))
      expect(res.status).toBe(401)
      expect(await res.json()).toMatchObject({ code: 'SESSION_EXPIRED' })
      expect(isCleared(res, ACCESS_COOKIE)).toBe(true)
      expect(isCleared(res, REFRESH_COOKIE)).toBe(true)

      const missing = await refresh(request('/api/v1/auth/refresh'))
      expect(missing.status).toBe(401)
      expect(await missing.json()).toMatchObject({ code: 'INVALID_TOKEN' })
      const unknown = await refresh(request('/api/v1/auth/refresh', { cookies: { atlas_rt: 'not-a-real-token' } }))
      expect(await unknown.json()).toMatchObject({ code: 'INVALID_TOKEN' })
      expect(isCleared(unknown, REFRESH_COOKIE)).toBe(true)
    })

    it('logout revokes the family, clears both cookies and is idempotent; other devices survive; sid-only works', async () => {
      const a = await webLogin()
      const otherDevice = await login(request('/api/v1/auth/login', { body: { email: a.email, password: PASSWORD } }))
      const res = await logout(request('/api/v1/auth/logout', { cookies: { atlas_at: a.at, atlas_rt: a.rt } }))
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true })
      expect(isCleared(res, ACCESS_COOKIE)).toBe(true)
      expect(isCleared(res, REFRESH_COOKIE)).toBe(true)
      expect(family(familyOf(a.rt)).revokeReason).toBe('logout')
      const after = await refresh(request('/api/v1/auth/refresh', { cookies: { atlas_rt: a.rt } }))
      expect(await after.json()).toMatchObject({ code: 'SESSION_REVOKED' })
      expect((await logout(request('/api/v1/auth/logout', { cookies: { atlas_at: a.at, atlas_rt: a.rt } }))).status).toBe(200)
      expect((await logout(request('/api/v1/auth/logout'))).status).toBe(200)
      expect((await refresh(request('/api/v1/auth/refresh', { cookies: { atlas_rt: cookieValue(otherDevice, REFRESH_COOKIE)! } }))).status).toBe(200)

      const b = await webLogin()
      await logout(request('/api/v1/auth/logout', { cookies: { atlas_at: b.at } }))
      expect(family(familyOf(b.rt)).revokeReason).toBe('logout')
    })

    it('/auth/me works with the access cookie', async () => {
      const { at, email } = await webLogin()
      const res = await me(request('/api/v1/auth/me', { method: 'GET', cookies: { atlas_at: at } }))
      expect(res.status).toBe(200)
      expect((await res.json()).user.email).toBe(email)
    })
  })

  describe('mobile mode (X-Atlas-Client: mobile)', () => {
    it('register/login return tokens in the body with expiries and set no cookies; deviceName is stored', async () => {
      const { res } = await newAccount(MOBILE, { deviceName: 'iPhone 17' })
      const body = await res.json()
      expect(body).toMatchObject({
        user: { email: expect.any(String) },
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
        accessTokenExpiresAt: expect.stringMatching(/Z$/),
        refreshTokenExpiresAt: expect.stringMatching(/Z$/),
        sessionExpiresAt: expect.stringMatching(/Z$/),
      })
      expect(setCookies(res)).toHaveLength(0)
      const fam = family(familyOf(body.refreshToken))
      expect(fam.clientType).toBe('mobile')
      expect(sql(DB, `SELECT "deviceName" FROM "Session" WHERE "tokenHash" = '${hashToken(body.refreshToken)}'`)).toBe('iPhone 17')
      const days = (Date.parse(body.sessionExpiresAt) - Date.now()) / 86_400_000
      expect(days).toBeGreaterThan(89.9)
      expect(days).toBeLessThanOrEqual(90)

      const lg = await login(request('/api/v1/auth/login', { body: { email: body.user.email, password: PASSWORD }, headers: MOBILE }))
      expect(lg.status).toBe(200)
      expect(setCookies(lg)).toHaveLength(0)
      expect((await lg.json()).refreshToken).toBeTruthy()
    })

    it('refresh takes { refreshToken } in the body; Bearer access works; replay returns the same token; logout by body token', async () => {
      const { res } = await newAccount(MOBILE)
      const t = await res.json()
      const me1 = await me(request('/api/v1/auth/me', { method: 'GET', headers: { authorization: `Bearer ${t.accessToken}` } }))
      expect(me1.status).toBe(200)

      const r1 = await refresh(request('/api/v1/auth/refresh', { headers: MOBILE, body: { refreshToken: t.refreshToken } }))
      expect(r1.status).toBe(200)
      expect(setCookies(r1)).toHaveLength(0)
      const n1 = await r1.json()
      expect(n1.refreshToken).not.toBe(t.refreshToken)
      expect(n1.sessionExpiresAt).toBe(t.sessionExpiresAt)
      const replay = await (await refresh(request('/api/v1/auth/refresh', { headers: MOBILE, body: { refreshToken: t.refreshToken } }))).json()
      expect(replay.refreshToken).toBe(n1.refreshToken)

      // a refresh cookie is ignored in mobile mode; missing body → 400
      const noBody = await refresh(request('/api/v1/auth/refresh', { headers: MOBILE, cookies: { atlas_rt: n1.refreshToken }, body: {} }))
      expect(noBody.status).toBe(400)

      const out = await logout(request('/api/v1/auth/logout', { headers: MOBILE, body: { refreshToken: n1.refreshToken } }))
      expect(out.status).toBe(200)
      expect(setCookies(out)).toHaveLength(0)
      expect(family(familyOf(n1.refreshToken)).revokeReason).toBe('logout')
      const dead = await refresh(request('/api/v1/auth/refresh', { headers: MOBILE, body: { refreshToken: n1.refreshToken } }))
      expect(await dead.json()).toMatchObject({ code: 'SESSION_REVOKED' })
      expect(setCookies(dead)).toHaveLength(0)
    })

    it('AUTH-03: a web refresh token in mobile mode and a mobile token as a cookie → 401 CLIENT_MISMATCH; unknown header values mean web', async () => {
      const web = await webLogin()
      const viaMobile = await refresh(request('/api/v1/auth/refresh', { headers: MOBILE, body: { refreshToken: web.rt } }))
      expect(await viaMobile.json()).toMatchObject({ code: 'CLIENT_MISMATCH' })
      expect(setCookies(viaMobile)).toHaveLength(0)

      const mob = await (await newAccount(MOBILE)).res.json()
      const asCookie = await refresh(request('/api/v1/auth/refresh', { cookies: { atlas_rt: mob.refreshToken } }))
      expect(await asCookie.json()).toMatchObject({ code: 'CLIENT_MISMATCH' })
      expect(isCleared(asCookie, REFRESH_COOKIE)).toBe(true)
      expect(family(familyOf(mob.refreshToken)).revokedAt).toBeNull()

      const odd = await refresh(request('/api/v1/auth/refresh', { headers: { 'x-atlas-client': 'ios' }, cookies: { atlas_rt: web.rt } }))
      expect(odd.status).toBe(200)
      expect(cookieValue(odd, REFRESH_COOKIE)).toBeTruthy()
    })
  })

  describe('proxy page gate with rotation', () => {
    const page = (path: string, cookies: Record<string, string | undefined>) => request(path, { method: 'GET', cookies })

    it('rotates server-side when only the refresh cookie is valid; the render sees the new access token', async () => {
      const { rt } = await webLogin()
      const res = await proxy(page('/wardrobe', { atlas_rt: rt, atlas_at: 'expired.or.garbage' }))
      expect(res.headers.get('x-middleware-next')).toBe('1')
      const newAt = cookieValue(res, ACCESS_COOKIE)!
      expect(newAt).toBeTruthy()
      expect(cookieValue(res, REFRESH_COOKIE)).not.toBe(rt)
      expect(res.headers.get('x-middleware-request-cookie')).toContain(`atlas_at=${newAt}`)
    })

    it('a page load that loses the rotation race renders signed in with the same new refresh cookie (grace)', async () => {
      const { rt } = await webLogin()
      const winner = await proxy(page('/wardrobe', { atlas_rt: rt }))
      const loser = await proxy(page('/outfits', { atlas_rt: rt }))
      expect(loser.headers.get('x-middleware-next')).toBe('1')
      expect(cookieValue(loser, ACCESS_COOKIE)).toBeTruthy()
      expect(cookieValue(loser, REFRESH_COOKIE)).toBe(cookieValue(winner, REFRESH_COOKIE))
    })

    it('CLI-W8: SESSION_RACE on a page load → one retry of the same URL (5 s atlas_retry cookie); a second race → /login, session cookies kept', async () => {
      const { rt } = await webLogin()
      await proxy(page('/wardrobe', { atlas_rt: rt })) // winner rotates
      // no stored successor → the loser gets SESSION_RACE (not a grace replay)
      sql(DB, `UPDATE "Session" SET "successorTokenEnc" = NULL WHERE "tokenHash" = '${hashToken(rt)}'`)
      const first = await proxy(page('/outfits?x=1', { atlas_rt: rt }))
      expect(first.status).toBe(307)
      expect(first.headers.get('location')).toBe('http://localhost/outfits?x=1')
      const retryLine = setCookies(first).find((c) => c.startsWith('atlas_retry='))!
      expect(retryLine).toMatch(/Max-Age=5/)
      expect(retryLine).toMatch(/HttpOnly/i)
      expect(setCookies(first).some((c) => c.startsWith('atlas_rt=') || c.startsWith('atlas_at='))).toBe(false)

      const second = await proxy(page('/outfits?x=1', { atlas_rt: rt, atlas_retry: '1' }))
      expect(second.headers.get('location')).toBe('http://localhost/login?next=%2Foutfits%3Fx%3D1')
      expect(setCookies(second).some((c) => c.startsWith('atlas_rt=') || c.startsWith('atlas_at='))).toBe(false)
      expect(setCookies(second).find((c) => c.startsWith('atlas_retry='))).toMatch(/Max-Age=0/)
    })

    it('a successful page load clears a leftover atlas_retry cookie', async () => {
      const { rt } = await webLogin()
      const res = await proxy(page('/wardrobe', { atlas_rt: rt, atlas_retry: '1' }))
      expect(res.headers.get('x-middleware-next')).toBe('1')
      expect(setCookies(res).find((c) => c.startsWith('atlas_retry='))).toMatch(/Max-Age=0/)
    })

    it('redirects to /login and clears cookies when the refresh token is dead', async () => {
      const { rt, at } = await webLogin()
      await logout(request('/api/v1/auth/logout', { cookies: { atlas_at: at, atlas_rt: rt } }))
      const res = await proxy(page('/', { atlas_rt: rt }))
      expect(res.headers.get('location')).toBe('http://localhost/login?next=%2F')
      expect(isCleared(res, REFRESH_COOKIE)).toBe(true)
    })
  })
})
