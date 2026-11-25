import { expect, test } from '@playwright/test'
import { CONSENT, uniqueUser } from './helpers'

/**
 * Go mode only (E2E_GO=1, see playwright.config.ts): the front proxy sends
 * the auth operations to the Go server and everything else to Next.js. This
 * spec proves the routing, so the other specs really ran against Go, and
 * that a session started by one server is accepted by the other.
 */
test.describe('Go mode routing', () => {
  test.skip(process.env.E2E_GO !== '1', 'runs only in Go mode')

  test('the auth operations are served by Go, the rest by Next.js, on one session', async ({ request }) => {
    const user = uniqueUser('go')
    const register = await request.post('/api/v1/auth/register', { data: { ...user, ...CONSENT } })
    expect(register.status()).toBe(201)
    expect(register.headers()['x-e2e-backend']).toBe('go')

    // The cookies Go set authenticate a Next.js route …
    const profile = await request.get('/api/v1/profile')
    expect(profile.status()).toBe(200)
    expect(profile.headers()['x-e2e-backend']).toBe('next')
    // … and Go's own.
    const me = await request.get('/api/v1/auth/me')
    expect(me.status()).toBe(200)
    expect(me.headers()['x-e2e-backend']).toBe('go')
    expect((await me.json()).user.email).toBe(user.email)

    for (const path of ['/api/v1/auth/refresh', '/api/v1/auth/logout']) {
      const res = await request.post(path)
      expect(res.status(), path).toBe(200)
      expect(res.headers()['x-e2e-backend'], path).toBe('go')
    }
    // Signed out by Go: Go refuses the session at once.
    expect((await request.get('/api/v1/auth/me')).status()).toBe(401)

    const login = await request.post('/api/v1/auth/login', { data: { email: user.email, password: user.password } })
    expect(login.status()).toBe(200)
    expect(login.headers()['x-e2e-backend']).toBe('go')
    expect((await request.get('/api/health')).headers()['x-e2e-backend']).toBe('next')
  })
})
