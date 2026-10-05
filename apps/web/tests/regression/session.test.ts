/**
 * Regression: the MVP returned long-lived JWTs in the JSON body (stored in
 * localStorage) with no server-side sessions — no logout, no revocation, no
 * rotation, no CSRF story. Sessions now live in HttpOnly cookies backed by a
 * hashed, rotating refresh token in the Session table.
 *
 * This file covers the parts that need no session store: access-token
 * checks, the CSRF guard, the proxy page gate without rotation, safe
 * redirects and getCurrentUser. Login, refresh, logout and proxy rotation run
 * against a real PostgreSQL database in tests/integration/session-http.itest.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { SignJWT } from 'jose'

// ─── In-memory fake for db.user (the session store is not used here) ───────
const fake = vi.hoisted(() => {
  const state = { users: [] as Array<{ id: string; email: string; name: string | null }> }
  const db: any = {
    user: {
      findUnique: vi.fn(async ({ where, select }: any) => {
        const u = state.users.find((x) => (where.id ? x.id === where.id : x.email === where.email))
        if (!u) return null
        return select ? Object.fromEntries(Object.keys(select).map((k) => [k, (u as any)[k]])) : { ...u }
      }),
    },
    session: new Proxy({}, { get: () => () => { throw new Error('session store is not available in unit tests') } }),
  }
  return { state, db }
})
vi.mock('@/lib/db', () => ({ db: fake.db }))

const cookieStore = vi.hoisted(() => ({ value: undefined as string | undefined }))
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === 'atlas_at' && cookieStore.value ? { name, value: cookieStore.value } : undefined),
  }),
}))

import { GET as me } from '@/app/api/v1/auth/me/route'
import { requireAuth } from '@/lib/api-helpers'
import { signAccessToken } from '@/lib/auth'
import { getCurrentUser, safeNextPath } from '@/lib/session'
import { resetRateLimits } from '@/lib/rate-limit'
import { proxy } from '@/proxy'
import { TEST_USER } from '../helpers'

const USER = { id: TEST_USER.sub, email: TEST_USER.email, name: 'Tester' }

function cookieHeader(cookies: Record<string, string | undefined>) {
  return Object.entries(cookies)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
}

function req(
  path: string,
  { method = 'POST', cookies = {}, headers = {} }: { method?: string; cookies?: Record<string, string | undefined>; headers?: Record<string, string> } = {},
) {
  const cookie = cookieHeader(cookies)
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { host: 'localhost', ...(cookie ? { cookie } : {}), ...headers },
  })
}

function setCookies(res: Response): string[] {
  return res.headers.getSetCookie()
}

async function signedToken(secret: string, exp: string | number, extra: Record<string, string> = {}) {
  return new SignJWT({ sub: TEST_USER.sub, email: TEST_USER.email, ...extra })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
    .setIssuer('ai-fashion-stylist')
    .setExpirationTime(exp)
    .sign(new TextEncoder().encode(secret))
}

beforeEach(() => {
  resetRateLimits()
  fake.state.users = [{ ...USER }]
  cookieStore.value = undefined
  vi.clearAllMocks()
})

describe('requireAuth', () => {
  const SECRET = 'test-access-secret-0123456789abcdefghijklmnop'

  it('accepts the access cookie and a Bearer header', async () => {
    const token = await signAccessToken({ ...TEST_USER, sid: 'sess_x' })
    expect(await requireAuth(req('/api/v1/x', { method: 'GET', cookies: { atlas_at: token } }))).toMatchObject({
      sub: TEST_USER.sub,
      sid: 'sess_x',
    })
    expect(
      await requireAuth(req('/api/v1/x', { method: 'GET', headers: { authorization: `Bearer ${token}` } })),
    ).toMatchObject({ sub: TEST_USER.sub })
  })

  it('/auth/me works with the cookie', async () => {
    const at = await signAccessToken({ ...TEST_USER, sid: 'sess_x' })
    const res = await me(req('/api/v1/auth/me', { method: 'GET', cookies: { atlas_at: at } }))
    expect(res.status).toBe(200)
    expect((await res.json()).user.id).toBe(USER.id)
    expect((await me(req('/api/v1/auth/me', { method: 'GET' }))).status).toBe(401)
  })

  it('rejects tampered, expired and old-default-secret tokens', async () => {
    const good = await signAccessToken(TEST_USER)
    const [h, p, s] = good.split('.')
    const forgedPayload = Buffer.from(JSON.stringify({ sub: 'someone_else', email: 'x@y.z', iss: 'ai-fashion-stylist', exp: 9999999999 })).toString('base64url')
    const tampered = [`${h}.${forgedPayload}.${s}`, `${h}.${p}.${s.slice(0, -2)}xx`]
    const expired = await signedToken(SECRET, Math.floor(Date.now() / 1000) - 60)
    const oldDefault = await signedToken('dev-secret-change-in-production-please-use-env', '5m')
    for (const token of [...tampered, expired, oldDefault]) {
      expect(await requireAuth(req('/x', { method: 'GET', cookies: { atlas_at: token } }))).toBeNull()
      expect(await requireAuth(req('/x', { method: 'GET', headers: { authorization: `Bearer ${token}` } }))).toBeNull()
    }
  })

  it('an Authorization header is never combined with a cookie fallback', async () => {
    const token = await signAccessToken(TEST_USER)
    const r = req('/x', { method: 'GET', cookies: { atlas_at: token }, headers: { authorization: 'Bearer garbage' } })
    expect(await requireAuth(r)).toBeNull()
  })
})

describe('CSRF origin check (proxy)', () => {
  it('rejects a cross-origin cookie-authenticated POST with 403 FORBIDDEN', async () => {
    const token = await signAccessToken(TEST_USER)
    for (const origin of ['https://evil.example', 'null']) {
      const res = await proxy(req('/api/v1/outfits', { cookies: { atlas_at: token }, headers: { origin } }))
      expect(res.status).toBe(403)
      expect(await res.json()).toMatchObject({ code: 'FORBIDDEN' })
    }
    const del = await proxy(req('/api/v1/auth/logout', { cookies: { atlas_rt: 'x' }, headers: { origin: 'https://evil.example' } }))
    expect(del.status).toBe(403)
  })

  it('allows same-origin, Origin-less, GET and Bearer-authenticated requests', async () => {
    const token = await signAccessToken(TEST_USER)
    const passes = (r: NextRequest) => proxy(r).then((res) => res.headers.get('x-middleware-next'))
    expect(await passes(req('/api/v1/outfits', { cookies: { atlas_at: token }, headers: { origin: 'http://localhost' } }))).toBe('1')
    expect(await passes(req('/api/v1/outfits', { cookies: { atlas_at: token } }))).toBe('1')
    expect(await passes(req('/api/v1/outfits', { method: 'GET', cookies: { atlas_at: token }, headers: { origin: 'https://evil.example' } }))).toBe('1')
    expect(
      await passes(req('/api/v1/outfits', { headers: { origin: 'https://evil.example', authorization: `Bearer ${token}` } })),
    ).toBe('1')
    // No cookies at all (e.g. login form) — not cookie-authenticated.
    expect(await passes(req('/api/v1/auth/login', { headers: { origin: 'https://evil.example' } }))).toBe('1')
  })

  it('adds x-request-id to API requests', async () => {
    const res = await proxy(req('/api/v1/outfits', { method: 'GET' }))
    expect(res.headers.get('x-middleware-request-x-request-id')).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('proxy page gate', () => {
  const page = (path: string, cookies: Record<string, string | undefined> = {}) => req(path, { method: 'GET', cookies })

  it('redirects to /login?next=<path> without a session', async () => {
    const res = await proxy(page('/wardrobe?tab=all'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('http://localhost/login?next=%2Fwardrobe%3Ftab%3Dall')
  })

  it('continues with a valid access cookie', async () => {
    const at = await signAccessToken({ ...TEST_USER, sid: 'sess_x' })
    const res = await proxy(page('/wardrobe', { atlas_at: at }))
    expect(res.headers.get('x-middleware-next')).toBe('1')
    expect(setCookies(res)).toHaveLength(0)
  })

  it('does not rotate on a router prefetch (204, session store untouched)', async () => {
    const prefetch = req('/wardrobe', { method: 'GET', cookies: { atlas_rt: 'some-refresh-token' }, headers: { 'next-router-prefetch': '1', rsc: '1' } })
    const res = await proxy(prefetch) // the fake session store throws if it is touched
    expect(res.status).toBe(204)
    expect(setCookies(res)).toHaveLength(0)
  })

  it('/login and /register redirect a signed-in user to / (or a safe next)', async () => {
    const at = await signAccessToken({ ...TEST_USER, sid: 'sess_x' })
    expect((await proxy(page('/login', { atlas_at: at }))).headers.get('location')).toBe('http://localhost/')
    expect((await proxy(page('/register?next=%2Foutfits', { atlas_at: at }))).headers.get('location')).toBe('http://localhost/outfits')
    expect((await proxy(page('/login?next=%2F%2Fevil.example', { atlas_at: at }))).headers.get('location')).toBe('http://localhost/')
    expect((await proxy(page('/login'))).headers.get('x-middleware-next')).toBe('1')
  })

  it('safeNextPath only allows same-origin relative paths', () => {
    expect(safeNextPath('/a?b=1')).toBe('/a?b=1')
    for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', 'javascript:alert(1)', '/a\nb', '', null]) {
      expect(safeNextPath(bad)).toBe('/')
    }
  })
})

describe('getCurrentUser', () => {
  afterEach(() => {
    cookieStore.value = undefined
  })

  it('returns the user for a valid access cookie', async () => {
    cookieStore.value = await signAccessToken(TEST_USER)
    expect(await getCurrentUser()).toEqual({ id: USER.id, email: USER.email, name: USER.name })
  })

  it('returns null for a missing, expired or garbage cookie', async () => {
    expect(await getCurrentUser()).toBeNull()
    cookieStore.value = await signedToken('test-access-secret-0123456789abcdefghijklmnop', Math.floor(Date.now() / 1000) - 5)
    expect(await getCurrentUser()).toBeNull()
    cookieStore.value = 'garbage'
    expect(await getCurrentUser()).toBeNull()
  })

  it('returns null when the user no longer exists', async () => {
    cookieStore.value = await signAccessToken({ sub: 'deleted_user', email: 'gone@example.com' })
    expect(await getCurrentUser()).toBeNull()
  })
})
