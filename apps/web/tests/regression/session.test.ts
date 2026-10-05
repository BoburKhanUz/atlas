/**
 * Regression: the MVP returned long-lived JWTs in the JSON body (stored in
 * localStorage) with no server-side sessions — no logout, no revocation, no
 * rotation, no CSRF story. Sessions now live in HttpOnly cookies backed by a
 * hashed, rotating refresh token in the Session table.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { SignJWT } from 'jose'
import bcrypt from 'bcryptjs'

// ─── In-memory fake for db.user / db.session ────────────────────────────────
const fake = vi.hoisted(() => {
  interface SessionRow {
    id: string
    userId: string
    tokenHash: string
    expiresAt: Date
    createdAt: Date
    lastUsedAt: Date | null
    revokedAt: Date | null
    replacedById: string | null
    userAgent: string | null
  }
  interface UserRow {
    id: string
    email: string
    name: string | null
    passwordHash: string
  }
  const state = { sessions: [] as SessionRow[], users: [] as UserRow[], seq: 0 }

  const matches = (row: SessionRow, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => (row as unknown as Record<string, unknown>)[k] === v)

  const pick = (row: SessionRow, select?: Record<string, boolean>) =>
    select ? Object.fromEntries(Object.keys(select).map((k) => [k, (row as any)[k]])) : { ...row }

  const db: any = {
    user: {
      findUnique: vi.fn(async ({ where, select }: any) => {
        const u = state.users.find((x) => (where.id ? x.id === where.id : x.email === where.email))
        if (!u) return null
        return select ? Object.fromEntries(Object.keys(select).map((k) => [k, (u as any)[k]])) : { ...u }
      }),
    },
    session: {
      create: vi.fn(async ({ data, select }: any) => {
        const row: SessionRow = {
          id: `sess_${++state.seq}`,
          createdAt: new Date(),
          lastUsedAt: null,
          revokedAt: null,
          replacedById: null,
          userAgent: null,
          ...data,
        }
        state.sessions.push(row)
        return pick(row, select)
      }),
      findUnique: vi.fn(async ({ where, include }: any) => {
        await Promise.resolve() // yield, so concurrent callers interleave
        const row = state.sessions.find((s) => matches(s, where))
        if (!row) return null
        const out: any = { ...row }
        if (include?.user) {
          const u = state.users.find((x) => x.id === row.userId)!
          out.user = { id: u.id, email: u.email, name: u.name }
        }
        return out
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const rows = state.sessions.filter((s) => matches(s, where))
        for (const r of rows) Object.assign(r, data)
        return { count: rows.length }
      }),
    },
    // Rollback = drop the rows this transaction created (enough for rotation,
    // whose only other write is the conditional updateMany that failed).
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const created: string[] = []
      const tx = {
        ...db,
        session: {
          ...db.session,
          create: async (args: any) => {
            const row = await db.session.create(args)
            created.push(state.sessions[state.sessions.length - 1].id)
            return row
          },
        },
      }
      try {
        return await fn(tx)
      } catch (err) {
        state.sessions = state.sessions.filter((s) => !created.includes(s.id))
        throw err
      }
    }),
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

import { POST as login } from '@/app/api/v1/auth/login/route'
import { POST as register } from '@/app/api/v1/auth/register/route'
import { POST as refresh } from '@/app/api/v1/auth/refresh/route'
import { POST as logout } from '@/app/api/v1/auth/logout/route'
import { GET as me } from '@/app/api/v1/auth/me/route'
import { requireAuth } from '@/lib/api-helpers'
import { signAccessToken, hashToken, verifyAccessTokenOrNull } from '@/lib/auth'
import { ACCESS_COOKIE, REFRESH_COOKIE, REUSE_GRACE_MS, getCurrentUser, rotateSession, safeNextPath } from '@/lib/session'
import { resetRateLimits } from '@/lib/rate-limit'
import { proxy } from '@/proxy'
import { jsonRequest, TEST_USER } from '../helpers'

const PASSWORD = 'correct horse battery'
const USER = { id: TEST_USER.sub, email: TEST_USER.email, name: 'Tester', passwordHash: bcrypt.hashSync(PASSWORD, 4) }

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

function cookieValue(res: Response, name: string): string | undefined {
  const line = setCookies(res).find((c) => c.startsWith(`${name}=`))
  return line?.slice(name.length + 1).split(';')[0]
}

function isCleared(res: Response, name: string) {
  const line = setCookies(res).find((c) => c.startsWith(`${name}=`))
  return !!line && /Max-Age=0/i.test(line) && line.startsWith(`${name}=;`)
}

async function loginOk() {
  const res = await login(jsonRequest('/api/v1/auth/login', { email: USER.email, password: PASSWORD }))
  expect(res.status).toBe(200)
  return { res, at: cookieValue(res, ACCESS_COOKIE)!, rt: cookieValue(res, REFRESH_COOKIE)! }
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
  fake.state.sessions = []
  fake.state.users = [{ ...USER }]
  cookieStore.value = undefined
  vi.clearAllMocks()
})

describe('login / register cookies', () => {
  it('login sets HttpOnly SameSite=Lax cookies with the right paths and no tokens in the body', async () => {
    const { res, at, rt } = await loginOk()
    const body = await res.json()
    expect(body).toEqual({ user: { id: USER.id, email: USER.email, name: USER.name } })
    expect(JSON.stringify(body)).not.toContain(at)
    expect(JSON.stringify(body)).not.toContain(rt)

    const lines = setCookies(res)
    const atLine = lines.find((c) => c.startsWith('atlas_at='))!
    const rtLine = lines.find((c) => c.startsWith('atlas_rt='))!
    expect(atLine).toMatch(/; Path=\/(;|$)/)
    expect(atLine).toMatch(/HttpOnly/i)
    expect(atLine).toMatch(/SameSite=Lax/i)
    expect(atLine).toMatch(/Max-Age=900/)
    expect(rtLine).toMatch(/; Path=\/(;|$)/) // must reach page loads (proxy rotation)
    expect(rtLine).toMatch(/HttpOnly/i)
    expect(rtLine).toMatch(/SameSite=Lax/i)
    expect(rtLine).toMatch(/Max-Age=2592000/)
    expect(atLine).not.toMatch(/Secure/i) // NODE_ENV=test

    // Only the hash is stored.
    expect(fake.state.sessions).toHaveLength(1)
    expect(fake.state.sessions[0].tokenHash).toBe(hashToken(rt))
    expect(fake.state.sessions[0].tokenHash).not.toBe(rt)
  })

  it('cookies are Secure in production unless COOKIE_SECURE=0', async () => {
    const env = process.env as Record<string, string | undefined>
    const saved = { NODE_ENV: env.NODE_ENV, COOKIE_SECURE: env.COOKIE_SECURE }
    try {
      env.NODE_ENV = 'production'
      delete env.COOKIE_SECURE
      expect(setCookies((await loginOk()).res).every((c) => /;\s*Secure/i.test(c))).toBe(true)
      env.COOKIE_SECURE = '0'
      expect(setCookies((await loginOk()).res).some((c) => /;\s*Secure/i.test(c))).toBe(false)
    } finally {
      env.NODE_ENV = saved.NODE_ENV
      if (saved.COOKIE_SECURE === undefined) delete env.COOKIE_SECURE
      else env.COOKIE_SECURE = saved.COOKIE_SECURE
    }
  })

  it('register returns 201 { user } and sets both cookies', async () => {
    fake.db.user.findUnique.mockResolvedValueOnce(null)
    fake.db.$transaction.mockImplementationOnce(async () => ({ id: 'user_new', email: 'new@example.com', name: null }))
    const res = await register(jsonRequest('/api/v1/auth/register', { email: 'New@Example.com', password: 'password123' }))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ user: { id: 'user_new', email: 'new@example.com', name: null } })
    expect(cookieValue(res, ACCESS_COOKIE)).toBeTruthy()
    expect(cookieValue(res, REFRESH_COOKIE)).toBeTruthy()
  })

  it('wrong password → 401 with the shared error contract and no cookies', async () => {
    const res = await login(jsonRequest('/api/v1/auth/login', { email: USER.email, password: 'nope' }))
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ code: 'UNAUTHORIZED' })
    expect(setCookies(res)).toHaveLength(0)
  })
})

describe('refresh rotation', () => {
  it('rotates the refresh token; the old one is then rejected', async () => {
    const { rt } = await loginOk()
    const res = await refresh(req('/api/v1/auth/refresh', { cookies: { atlas_rt: rt } }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ user: { id: USER.id, email: USER.email, name: USER.name } })
    const rt2 = cookieValue(res, REFRESH_COOKIE)!
    expect(rt2).toBeTruthy()
    expect(rt2).not.toBe(rt)
    expect(cookieValue(res, ACCESS_COOKIE)).toBeTruthy()

    const [old, current] = fake.state.sessions
    expect(old.revokedAt).not.toBeNull()
    expect(old.replacedById).toBe(current.id)
    expect(current.revokedAt).toBeNull()

    // Immediately replaying the old token (within the race grace window) never
    // yields a new refresh token — only an access token for the replacement.
    // After the window it is rejected (see the reuse test below).
    const again = await refresh(req('/api/v1/auth/refresh', { cookies: { atlas_rt: rt } }))
    expect(setCookies(again).some((c) => c.startsWith(`${REFRESH_COOKIE}=`))).toBe(false)
    expect(fake.state.sessions.filter((s) => s.revokedAt === null)).toHaveLength(1)
    expect((await refresh(req('/api/v1/auth/refresh', { cookies: { atlas_rt: rt2 } }))).status).toBe(200)
  })

  it('reuse of a rotated token after the grace window revokes ALL user sessions', async () => {
    const { rt } = await loginOk()
    const other = await loginOk() // second device
    await refresh(req('/api/v1/auth/refresh', { cookies: { atlas_rt: rt } }))
    fake.state.sessions[0].revokedAt = new Date(Date.now() - REUSE_GRACE_MS - 1000)

    const res = await refresh(req('/api/v1/auth/refresh', { cookies: { atlas_rt: rt } }))
    expect(res.status).toBe(401)
    expect(isCleared(res, ACCESS_COOKIE)).toBe(true)
    expect(isCleared(res, REFRESH_COOKIE)).toBe(true)
    expect(fake.state.sessions.every((s) => s.revokedAt !== null)).toBe(true)
    expect((await refresh(req('/api/v1/auth/refresh', { cookies: { atlas_rt: other.rt } }))).status).toBe(401)
  })

  it('reuse within the grace window (concurrent requests) gets an access token for the replacement session, refresh cookie untouched', async () => {
    const { rt } = await loginOk()
    const ok = await refresh(req('/api/v1/auth/refresh', { cookies: { atlas_rt: rt } }))
    const rt2 = cookieValue(ok, REFRESH_COOKIE)!
    const live = fake.state.sessions.filter((s) => s.revokedAt === null)
    expect(live).toHaveLength(1)

    const res = await refresh(req('/api/v1/auth/refresh', { cookies: { atlas_rt: rt } }))
    expect(res.status).toBe(200)
    expect(cookieValue(res, ACCESS_COOKIE)).toBeTruthy()
    expect(setCookies(res).some((c) => c.startsWith(`${REFRESH_COOKIE}=`))).toBe(false)
    const payload = await verifyAccessTokenOrNull(cookieValue(res, ACCESS_COOKIE)!)
    expect(payload?.sid).toBe(live[0].id)
    expect(fake.state.sessions.filter((s) => s.revokedAt === null)).toHaveLength(1)
    expect((await refresh(req('/api/v1/auth/refresh', { cookies: { atlas_rt: rt2 } }))).status).toBe(200)
  })

  it('grace access is refused when the replacement session is already revoked', async () => {
    const { rt } = await loginOk()
    await refresh(req('/api/v1/auth/refresh', { cookies: { atlas_rt: rt } }))
    for (const s of fake.state.sessions) s.revokedAt ??= new Date()
    const res = await refresh(req('/api/v1/auth/refresh', { cookies: { atlas_rt: rt } }))
    expect(res.status).toBe(401)
    expect(setCookies(res)).toHaveLength(0)
  })

  it('two simultaneous rotations of one token: one rotates, the other gets grace access; no session is lost', async () => {
    const { rt } = await loginOk()
    const results = await Promise.all([rotateSession(rt), rotateSession(rt)])
    expect(results.every((r) => r.ok)).toBe(true)
    const rotatedOnes = results.filter((r) => r.ok && !r.graced)
    const graced = results.filter((r) => r.ok && r.graced)
    expect(rotatedOnes).toHaveLength(1)
    expect(graced).toHaveLength(1)
    expect(graced[0].ok && graced[0].issued.refreshToken).toBeNull()
    expect(fake.state.sessions.filter((s) => s.revokedAt === null)).toHaveLength(1)
  })

  it('expired refresh token → 401 and both cookies cleared', async () => {
    const { rt } = await loginOk()
    fake.state.sessions[0].expiresAt = new Date(Date.now() - 1000)
    const res = await refresh(req('/api/v1/auth/refresh', { cookies: { atlas_rt: rt } }))
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ code: 'UNAUTHORIZED' })
    expect(isCleared(res, ACCESS_COOKIE)).toBe(true)
    expect(isCleared(res, REFRESH_COOKIE)).toBe(true)
  })

  it('unknown or missing refresh token → 401 and cookies cleared', async () => {
    expect((await refresh(req('/api/v1/auth/refresh'))).status).toBe(401)
    const res = await refresh(req('/api/v1/auth/refresh', { cookies: { atlas_rt: 'not-a-real-token' } }))
    expect(res.status).toBe(401)
    expect(isCleared(res, REFRESH_COOKIE)).toBe(true)
  })
})

describe('logout', () => {
  it('revokes the session, clears both cookies and is idempotent', async () => {
    const { at, rt } = await loginOk()
    const res = await logout(req('/api/v1/auth/logout', { cookies: { atlas_at: at, atlas_rt: rt } }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(isCleared(res, ACCESS_COOKIE)).toBe(true)
    expect(isCleared(res, REFRESH_COOKIE)).toBe(true)
    expect(fake.state.sessions[0].revokedAt).not.toBeNull()
    expect((await refresh(req('/api/v1/auth/refresh', { cookies: { atlas_rt: rt } }))).status).toBe(401)

    const again = await logout(req('/api/v1/auth/logout', { cookies: { atlas_at: at, atlas_rt: rt } }))
    expect(again.status).toBe(200)
    const anonymous = await logout(req('/api/v1/auth/logout'))
    expect(anonymous.status).toBe(200)
    expect(isCleared(anonymous, ACCESS_COOKIE)).toBe(true)
  })

  it('revokes via the access token sid when only atlas_at is sent', async () => {
    const { at } = await loginOk()
    await logout(req('/api/v1/auth/logout', { cookies: { atlas_at: at } }))
    expect(fake.state.sessions[0].revokedAt).not.toBeNull()
  })

  it('a token revoked by logout is not treated as theft (other sessions survive)', async () => {
    const a = await loginOk()
    const b = await loginOk()
    await logout(req('/api/v1/auth/logout', { cookies: { atlas_rt: a.rt } }))
    fake.state.sessions[0].revokedAt = new Date(Date.now() - 60_000)
    expect((await refresh(req('/api/v1/auth/refresh', { cookies: { atlas_rt: a.rt } }))).status).toBe(401)
    expect((await refresh(req('/api/v1/auth/refresh', { cookies: { atlas_rt: b.rt } }))).status).toBe(200)
  })
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
    const { at } = await loginOk()
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
    const { at } = await loginOk()
    const res = await proxy(page('/wardrobe', { atlas_at: at }))
    expect(res.headers.get('x-middleware-next')).toBe('1')
    expect(setCookies(res)).toHaveLength(0)
  })

  it('rotates server-side when only the refresh cookie is present', async () => {
    const { rt } = await loginOk()
    const res = await proxy(page('/wardrobe', { atlas_rt: rt, atlas_at: 'expired.or.garbage' }))
    expect(res.headers.get('x-middleware-next')).toBe('1')
    const newAt = cookieValue(res, ACCESS_COOKIE)!
    expect(newAt).toBeTruthy()
    expect(cookieValue(res, REFRESH_COOKIE)).not.toBe(rt)
    // The downstream render sees the new access token.
    expect(res.headers.get('x-middleware-request-cookie')).toContain(`atlas_at=${newAt}`)
    expect(fake.state.sessions[0].revokedAt).not.toBeNull()
  })

  it('does not rotate on a router prefetch (204, session untouched)', async () => {
    const { rt } = await loginOk()
    const prefetch = req('/wardrobe', { method: 'GET', cookies: { atlas_rt: rt }, headers: { 'next-router-prefetch': '1', rsc: '1' } })
    const res = await proxy(prefetch)
    expect(res.status).toBe(204)
    expect(setCookies(res)).toHaveLength(0)
    expect(fake.state.sessions[0].revokedAt).toBeNull()
  })

  it('a page load that loses the rotation race still renders signed in (grace access)', async () => {
    const { rt } = await loginOk()
    await proxy(page('/wardrobe', { atlas_rt: rt })) // winner rotates
    const res = await proxy(page('/outfits', { atlas_rt: rt })) // loser, within grace
    expect(res.headers.get('x-middleware-next')).toBe('1')
    expect(cookieValue(res, ACCESS_COOKIE)).toBeTruthy()
    expect(setCookies(res).some((c) => c.startsWith(`${REFRESH_COOKIE}=`))).toBe(false)
  })

  it('redirects to /login and clears cookies when the refresh token is dead', async () => {
    const { rt } = await loginOk()
    fake.state.sessions[0].expiresAt = new Date(Date.now() - 1)
    const res = await proxy(page('/', { atlas_rt: rt }))
    expect(res.headers.get('location')).toBe('http://localhost/login?next=%2F')
    expect(isCleared(res, REFRESH_COOKIE)).toBe(true)
  })

  it('/login and /register redirect a signed-in user to / (or a safe next)', async () => {
    const { at } = await loginOk()
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
