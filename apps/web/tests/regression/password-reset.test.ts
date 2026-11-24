/**
 * Password reset routes: the forgot answer is the same for every address and
 * never waits for the e-mail; limits per address, per IP and overall; a bad
 * link is RESET_TOKEN_INVALID; mail switched off is PASSWORD_RESET_UNAVAILABLE.
 * The e-mail: the link and nothing personal. The database side (token rows,
 * expiry, session revocation) runs in tests/integration/password-reset.itest.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const reset = vi.hoisted(() => ({ schedulePasswordReset: vi.fn(), completePasswordReset: vi.fn() }))
vi.mock('@/server/password-reset', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/password-reset')>()),
  ...reset,
}))

import { POST as forgot } from '@/app/api/v1/auth/password/forgot/route'
import { POST as resetPassword } from '@/app/api/v1/auth/password/reset/route'
import { resetRateLimits } from '@/lib/rate-limit'
import { resetEmail, resetLink } from '@/server/password-reset'
import { jsonRequest } from '../helpers'

beforeEach(() => {
  vi.clearAllMocks()
  resetRateLimits()
  vi.stubEnv('MAIL_TRANSPORT', 'outbox')
  reset.completePasswordReset.mockResolvedValue(true)
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('POST /api/v1/auth/password/forgot', () => {
  it('answers the same for any address and only schedules the e-mail', async () => {
    const a = await forgot(jsonRequest('/api/v1/auth/password/forgot', { email: 'Known@Example.UZ' }))
    const b = await forgot(jsonRequest('/api/v1/auth/password/forgot', { email: 'nobody@example.uz' }))
    for (const res of [a, b]) {
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true })
    }
    expect(reset.schedulePasswordReset.mock.calls).toEqual([['known@example.uz'], ['nobody@example.uz']])
  })

  it('at most 3 requests per address and hour (counted for every address alike)', async () => {
    for (let i = 0; i < 3; i++) expect((await forgot(jsonRequest('/api/v1/auth/password/forgot', { email: 'a@example.uz' }))).status).toBe(200)
    const limited = await forgot(jsonRequest('/api/v1/auth/password/forgot', { email: 'A@example.uz' }))
    expect(limited.status).toBe(429)
    expect((await limited.json()).code).toBe('RATE_LIMITED')
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)
    expect((await forgot(jsonRequest('/api/v1/auth/password/forgot', { email: 'b@example.uz' }))).status).toBe(200)
    expect(reset.schedulePasswordReset).toHaveBeenCalledTimes(4)
  })

  it('at most 10 requests per client IP and hour behind a trusted proxy', async () => {
    vi.stubEnv('TRUST_PROXY', '1')
    const from = (ip: string, i: number) => jsonRequest('/api/v1/auth/password/forgot', { email: `u${i}@example.uz` }, { 'x-forwarded-for': ip })
    for (let i = 0; i < 10; i++) expect((await forgot(from('203.0.113.7', i))).status).toBe(200)
    expect((await forgot(from('203.0.113.7', 10))).status).toBe(429)
    expect((await forgot(from('203.0.113.8', 11))).status).toBe(200)
  })

  it('a bad address → VALIDATION_ERROR; mail switched off → PASSWORD_RESET_UNAVAILABLE; nothing scheduled', async () => {
    const bad = await forgot(jsonRequest('/api/v1/auth/password/forgot', { email: 'not-an-address' }))
    expect(bad.status).toBe(400)
    expect((await bad.json()).code).toBe('VALIDATION_ERROR')
    vi.stubEnv('MAIL_TRANSPORT', 'disabled')
    const off = await forgot(jsonRequest('/api/v1/auth/password/forgot', { email: 'a@example.uz' }))
    expect(off.status).toBe(503)
    expect(await off.json()).toMatchObject({ code: 'PASSWORD_RESET_UNAVAILABLE', error: expect.stringMatching(/Parolni tiklash/) })
    expect(reset.schedulePasswordReset).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/auth/password/reset', () => {
  it('a valid token sets the password: 200', async () => {
    const res = await resetPassword(jsonRequest('/api/v1/auth/password/reset', { token: 't'.repeat(43), password: 'new-password-1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(reset.completePasswordReset).toHaveBeenCalledWith('t'.repeat(43), 'new-password-1')
  })

  it('an unknown, used or expired token → 400 RESET_TOKEN_INVALID in Uzbek', async () => {
    reset.completePasswordReset.mockResolvedValue(false)
    const res = await resetPassword(jsonRequest('/api/v1/auth/password/reset', { token: 'x', password: 'new-password-1' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'RESET_TOKEN_INVALID', error: expect.stringMatching(/Havola yaroqsiz/) })
  })

  it('a short password → VALIDATION_ERROR before the token is looked at', async () => {
    const res = await resetPassword(jsonRequest('/api/v1/auth/password/reset', { token: 't'.repeat(43), password: 'short' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'VALIDATION_ERROR', details: [{ path: 'password' }] })
    expect(reset.completePasswordReset).not.toHaveBeenCalled()
  })
})

describe('the reset e-mail', () => {
  it('carries the link (PUBLIC_BASE_URL + token) and nothing personal', () => {
    vi.stubEnv('PUBLIC_BASE_URL', 'https://atlas.example.uz')
    const link = resetLink('abc_DEF-123')
    expect(link).toBe('https://atlas.example.uz/reset-password?token=abc_DEF-123')
    const mail = resetEmail('ali@example.uz', link)
    expect(mail.to).toBe('ali@example.uz')
    expect(mail.subject).toBe('Lookly: parolni tiklash')
    expect(mail.text.split(link)).toHaveLength(2)
    expect(mail.text).toMatch(/60 daqiqa/)
    expect(mail.html).toContain(`href="${link}"`)
    for (const body of [mail.text, mail.html]) expect(body).not.toContain('ali@example.uz')
  })

  it('escapes the link in HTML', () => {
    const mail = resetEmail('a@example.uz', 'https://x.uz/reset-password?token="><script>')
    expect(mail.html).not.toContain('<script>')
    expect(mail.html).toContain('&#34;&#62;&#60;script&#62;')
  })
})
