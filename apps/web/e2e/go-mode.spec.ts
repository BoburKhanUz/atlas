import { expect, request as playwrightRequest, test } from '@playwright/test'
import { CONSENT, uniqueUser } from './helpers'

/**
 * Go mode only (E2E_GO=1; playwright.config.ts leaves this file out of the
 * default run): the front proxy sends the auth operations to the Go server
 * and everything else to Next.js. This spec proves the routing, so the other
 * specs really ran against Go, and that the two servers work on each
 * other's sessions in both directions.
 */
test.describe('Go mode routing', () => {
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

  test('Go rotates and replays a session that Next.js rotated', async ({ page, baseURL }) => {
    const user = uniqueUser('gox')
    expect((await page.request.post('/api/v1/auth/register', { data: { ...user, ...CONSENT } })).status()).toBe(201)
    const cookie = async (name: string) => (await page.context().cookies()).find((c) => c.name === name)?.value
    const rt0 = (await cookie('atlas_rt'))! // written by Go

    // A page load with only the refresh cookie: the Next.js page proxy
    // rotates the session (it writes the new row and the old row's ciphertext).
    await page.context().clearCookies({ name: 'atlas_at' })
    await page.goto('/wardrobe')
    await expect(page).toHaveURL(/\/wardrobe$/)
    const rt1 = (await cookie('atlas_rt'))! // written by Next.js
    expect(rt1).not.toBe(rt0)

    // The old token again, to Go, moments later: a grace replay, served from
    // the ciphertext Next.js stored. Go answers with the token Next.js issued.
    const stale = await playwrightRequest.newContext({ baseURL, extraHTTPHeaders: { cookie: `atlas_rt=${rt0}` } })
    const replay = await stale.post('/api/v1/auth/refresh')
    expect(replay.status()).toBe(200)
    expect(replay.headers()['x-e2e-backend']).toBe('go')
    const replayed = replay.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie' && h.value.startsWith('atlas_rt='))
    expect(replayed.map((h) => h.value.split(';')[0])).toEqual([`atlas_rt=${rt1}`])
    await stale.dispose()

    // Go rotates the session row Next.js wrote …
    const rotated = await page.request.post('/api/v1/auth/refresh')
    expect(rotated.status()).toBe(200)
    expect(rotated.headers()['x-e2e-backend']).toBe('go')
    const rt2 = (await cookie('atlas_rt'))!
    expect(rt2).not.toBe(rt1)
    // … and Next.js goes on with the one Go wrote.
    await page.context().clearCookies({ name: 'atlas_at' })
    await page.goto('/wardrobe')
    await expect(page).toHaveURL(/\/wardrobe$/)
    expect(await cookie('atlas_rt')).not.toBe(rt2)
    const profile = await page.request.get('/api/v1/profile')
    expect(profile.status()).toBe(200)
    expect(profile.headers()['x-e2e-backend']).toBe('next')
  })
})
