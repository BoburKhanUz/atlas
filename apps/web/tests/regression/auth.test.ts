/**
 * Regression: auth.ts fell back to a hard-coded JWT secret, so anyone could
 * forge a valid token for any user id. Secrets are now required and the old
 * defaults are rejected.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { SignJWT } from 'jose'

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
}))
vi.mock('@/lib/db', () => ({ db }))

import { GET as me } from '@/app/api/v1/auth/me/route'
import { POST as login } from '@/app/api/v1/auth/login/route'
import { assertServerConfig, ConfigError } from '@/lib/config'
import { getUserFromAuthHeader } from '@/lib/auth'
import { resetRateLimits } from '@/lib/rate-limit'
import { authHeader, jsonRequest, TEST_USER } from '../helpers'

const OLD_DEFAULT_SECRET = 'dev-secret-change-in-production-please-use-env'

async function forgeToken(secret: string) {
  return new SignJWT({ sub: TEST_USER.sub, email: TEST_USER.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer('ai-fashion-stylist')
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(secret))
}

function meRequest(headers: Record<string, string>) {
  return new NextRequest('http://localhost/api/v1/auth/me', { headers })
}

describe('JWT secret handling', () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
  })

  it('rejects a token signed with the old hard-coded default secret', async () => {
    const token = await forgeToken(OLD_DEFAULT_SECRET)
    expect(await getUserFromAuthHeader(`Bearer ${token}`)).toBeNull()
    db.user.findUnique.mockResolvedValue({ id: TEST_USER.sub, email: TEST_USER.email })
    const res = await me(meRequest({ authorization: `Bearer ${token}` }))
    expect(res.status).toBe(401)
    expect(db.user.findUnique).not.toHaveBeenCalled()
  })

  it('accepts a token signed with the configured secret', async () => {
    db.user.findUnique.mockResolvedValue({ id: TEST_USER.sub, email: TEST_USER.email, name: null })
    const res = await me(meRequest(await authHeader()))
    expect(res.status).toBe(200)
  })

  it('refuses to run without JWT_SECRET instead of falling back', async () => {
    delete process.env.JWT_SECRET
    expect(() => assertServerConfig()).toThrow(ConfigError)
    const token = await forgeToken(OLD_DEFAULT_SECRET)
    await expect(getUserFromAuthHeader(`Bearer ${token}`)).rejects.toThrow(ConfigError)
  })

  it('refuses the old default value even when it is set explicitly', () => {
    process.env.JWT_SECRET = OLD_DEFAULT_SECRET
    expect(() => assertServerConfig()).toThrow(/insecure default/)
  })

  it('refuses short secrets', () => {
    process.env.JWT_SECRET = 'short'
    expect(() => assertServerConfig()).toThrow(/at least 32/)
  })

  it('no longer requires JWT_REFRESH_SECRET (refresh tokens are opaque, stored hashed)', () => {
    delete process.env.JWT_REFRESH_SECRET
    expect(() => assertServerConfig()).not.toThrow()
  })

  it('rejects tokens with alg "none"', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')
    const payload = Buffer.from(
      JSON.stringify({ sub: TEST_USER.sub, iss: 'ai-fashion-stylist', exp: 9999999999 }),
    ).toString('base64url')
    expect(await getUserFromAuthHeader(`Bearer ${header}.${payload}.`)).toBeNull()
  })
})

describe('login rate limiting', () => {
  beforeEach(() => {
    resetRateLimits()
    db.user.findUnique.mockResolvedValue(null) // unknown user → 401
  })

  it('returns 429 after 10 failed attempts for the same email', async () => {
    const attempt = () =>
      login(jsonRequest('/api/v1/auth/login', { email: 'victim@example.com', password: 'wrong' }))
    for (let i = 0; i < 10; i++) expect((await attempt()).status).toBe(401)
    const blocked = await attempt()
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('retry-after')).toBeTruthy()
  })
})
