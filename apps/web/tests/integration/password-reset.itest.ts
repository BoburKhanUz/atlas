/**
 * PWR: password reset against real PostgreSQL. The link is e-mailed and only
 * its hash is stored; it works once and expires by the database clock; a new
 * request replaces the old link; a reset signs out every session of the
 * account and nothing of other accounts.
 */
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { POST as register } from '@/app/api/v1/auth/register/route'
import { POST as login } from '@/app/api/v1/auth/login/route'
import { POST as refresh } from '@/app/api/v1/auth/refresh/route'
import { POST as forgot } from '@/app/api/v1/auth/password/forgot/route'
import { POST as resetPassword } from '@/app/api/v1/auth/password/reset/route'
import { DELETE as deleteAccount } from '@/app/api/v1/account/route'
import { hashToken } from '@/lib/auth'
import { LEGAL_VERSION } from '@/lib/legal/version'
import { resetRateLimits } from '@/lib/rate-limit'
import { setMailTransportForTesting, type MailMessage } from '@/server/mail'
import { settlePasswordResets } from '@/server/password-reset'
import { APP_DB, enabled, rows, setClock, sql } from './pg'

const DB = APP_DB
const PASSWORD = 'old-password-1'
const NEW_PASSWORD = 'new-password-2'
const MOBILE = { 'x-atlas-client': 'mobile' }
const outbox: MailMessage[] = []
let seq = 0

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { host: 'localhost', 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

/** An account signed in twice: in the browser (cookies) and on a phone (tokens). */
async function account() {
  const email = `pwr_${process.pid}_${++seq}@test.local`
  const web = await register(post('/api/v1/auth/register', { email, password: PASSWORD, acceptedLegalVersion: LEGAL_VERSION, ageConfirmed: true }))
  expect(web.status).toBe(201)
  const webRt = web.headers.getSetCookie().find((c) => c.startsWith('atlas_rt='))!.split(';')[0].slice('atlas_rt='.length)
  const phone = await login(post('/api/v1/auth/login', { email, password: PASSWORD, deviceName: 'IT phone' }, MOBILE))
  expect(phone.status).toBe(200)
  const userId = sql(DB, `SELECT "id" FROM "User" WHERE "email" = '${email}'`)
  return { email, userId, webRt, mobileRt: (await phone.json()).refreshToken as string }
}

/** Requests a link and returns the token from the e-mail. */
async function requestLink(email: string): Promise<string> {
  const res = await forgot(post('/api/v1/auth/password/forgot', { email }))
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true })
  await settlePasswordResets()
  const mail = outbox.filter((m) => m.to === email).at(-1)
  expect(mail, `an e-mail to ${email}`).toBeDefined()
  return new URL(mail!.text.match(/https?:\/\/\S+/)![0]).searchParams.get('token')!
}

const reset = (token: string, password = NEW_PASSWORD) => resetPassword(post('/api/v1/auth/password/reset', { token, password }))
const loginStatus = async (email: string, password: string) => (await login(post('/api/v1/auth/login', { email, password }))).status
const refreshMobile = async (rt: string) => {
  const res = await refresh(post('/api/v1/auth/refresh', { refreshToken: rt }, MOBILE))
  return res.status === 200 ? 'ok' : (await res.json()).code
}
const refreshWeb = async (rt: string) => {
  const res = await refresh(new NextRequest('http://localhost/api/v1/auth/refresh', { method: 'POST', headers: { host: 'localhost', cookie: `atlas_rt=${rt}` } }))
  return res.status === 200 ? 'ok' : (await res.json()).code
}
const links = (userId: string) => rows<{ tokenHash: string; minutes: number }>(
  DB,
  `SELECT "tokenHash", round(extract(epoch FROM ("expiresAt" - "createdAt")) / 60)::int AS minutes FROM "PasswordResetToken" WHERE "userId" = '${userId}'`,
)

describe.skipIf(!enabled)('PWR: password reset (real PostgreSQL)', () => {
  beforeAll(() => {
    setClock(DB, null)
    setMailTransportForTesting({ send: async (m) => void outbox.push(m) })
  })
  afterAll(() => {
    setMailTransportForTesting(null)
    setClock(DB, null)
  })
  beforeEach(() => resetRateLimits())

  it('PWR-01: the link is e-mailed, only its hash is stored, it lasts 60 minutes; an unknown address gets the same answer and no e-mail', async () => {
    const a = await account()
    const token = await requestLink(a.email)
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(links(a.userId)).toEqual([{ tokenHash: hashToken(token), minutes: 60 }])
    expect(sql(DB, `SELECT count(*) FROM "PasswordResetToken" WHERE "tokenHash" = '${token}'`)).toBe('0')

    const sent = outbox.length
    const res = await forgot(post('/api/v1/auth/password/forgot', { email: `nobody_${process.pid}@test.local` }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    await settlePasswordResets()
    expect(outbox.length).toBe(sent)
  })

  it('PWR-02: a reset sets the password, signs out every session of the account, and the link works once', async () => {
    const a = await account()
    const other = await account()
    const token = await requestLink(a.email)

    const res = await reset(token)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    expect(await refreshWeb(a.webRt)).toBe('SESSION_REVOKED')
    expect(await refreshMobile(a.mobileRt)).toBe('SESSION_REVOKED')
    expect(rows<{ revokeReason: string }>(DB, `SELECT "revokeReason" FROM "SessionFamily" WHERE "userId" = '${a.userId}'`)).toEqual([
      { revokeReason: 'password_reset' },
      { revokeReason: 'password_reset' },
    ])
    expect(links(a.userId)).toEqual([])
    expect(await loginStatus(a.email, PASSWORD)).toBe(401)
    expect(await loginStatus(a.email, NEW_PASSWORD)).toBe(200)

    const again = await reset(token, 'third-password-3')
    expect(again.status).toBe(400)
    expect((await again.json()).code).toBe('RESET_TOKEN_INVALID')
    expect(await loginStatus(a.email, NEW_PASSWORD)).toBe(200)

    // nothing changed for another account
    expect(await refreshMobile(other.mobileRt)).toBe('ok')
    expect(await loginStatus(other.email, PASSWORD)).toBe(200)
  })

  it('PWR-03: a new request replaces the earlier link', async () => {
    const a = await account()
    const first = await requestLink(a.email)
    const second = await requestLink(a.email)
    expect(second).not.toBe(first)
    expect(links(a.userId).map((l) => l.tokenHash)).toEqual([hashToken(second)])
    expect((await reset(first)).status).toBe(400)
    expect((await reset(second)).status).toBe(200)
  })

  it('PWR-04: an expired link (database clock) changes nothing', async () => {
    const a = await account()
    const token = await requestLink(a.email)
    setClock(DB, new Date(Date.now() + 61 * 60_000))
    try {
      const res = await reset(token)
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe('RESET_TOKEN_INVALID')
    } finally {
      setClock(DB, null)
    }
    expect(await loginStatus(a.email, PASSWORD)).toBe(200)
    expect(await refreshMobile(a.mobileRt)).toBe('ok')
  })

  it('PWR-05: a rejected new password keeps the link; deleting the account deletes its links', async () => {
    const a = await account()
    const token = await requestLink(a.email)
    const short = await reset(token, 'short')
    expect(short.status).toBe(400)
    expect((await short.json()).code).toBe('VALIDATION_ERROR')
    expect(links(a.userId)).toHaveLength(1)

    const phone = await login(post('/api/v1/auth/login', { email: a.email, password: PASSWORD }, MOBILE))
    const { accessToken } = await phone.json()
    const del = await deleteAccount(new NextRequest('http://localhost/api/v1/account', { method: 'DELETE', headers: { host: 'localhost', authorization: `Bearer ${accessToken}` } }), undefined)
    expect(del.status).toBe(200)
    expect(links(a.userId)).toEqual([])
    expect((await reset(token)).status).toBe(400)
  })
})
