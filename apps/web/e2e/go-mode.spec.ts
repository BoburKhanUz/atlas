import { expect, request as playwrightRequest, test } from '@playwright/test'
import sharp from 'sharp'
import { CONSENT, uniqueUser } from './helpers'

/**
 * Go mode only (E2E_GO=1; playwright.config.ts leaves this file out of the
 * default run): the front proxy sends the operations the Go server serves
 * (auth, legal texts and consent, profile, password reset, account deletion,
 * the wardrobe and its images) to Go and everything else to Next.js. This spec proves the routing, so the
 * other specs really ran against Go, and that the two servers work on each
 * other's sessions in both directions.
 */
test.describe('Go mode routing', () => {
  test('the operations Go serves are served by Go, the rest by Next.js, on one session', async ({ request }) => {
    const user = uniqueUser('go')
    const register = await request.post('/api/v1/auth/register', { data: { ...user, ...CONSENT } })
    expect(register.status()).toBe(201)
    expect(register.headers()['x-e2e-backend']).toBe('go')

    // The cookies Go set authenticate a Next.js route …
    const outfits = await request.get('/api/v1/outfits')
    expect(outfits.status()).toBe(200)
    expect(outfits.headers()['x-e2e-backend']).toBe('next')
    // … and Go's own.
    const me = await request.get('/api/v1/auth/me')
    expect(me.status()).toBe(200)
    expect(me.headers()['x-e2e-backend']).toBe('go')
    expect((await me.json()).user.email).toBe(user.email)

    // The account operations of stage B3.
    const legal = await request.get('/api/v1/legal')
    expect(legal.status()).toBe(200)
    expect(legal.headers()['x-e2e-backend']).toBe('go')
    const consent = await request.post('/api/v1/legal/consent', { data: CONSENT })
    expect(consent.status()).toBe(200)
    expect(consent.headers()['x-e2e-backend']).toBe('go')
    const changed = await request.patch('/api/v1/profile', { data: { name: 'Go Mode', preferences: { preferredStyles: ['casual'] } } })
    expect(changed.status()).toBe(200)
    expect(changed.headers()['x-e2e-backend']).toBe('go')
    const profile = await request.get('/api/v1/profile')
    expect(profile.status()).toBe(200)
    expect(profile.headers()['x-e2e-backend']).toBe('go')
    expect((await profile.json()).preferences.preferredStyles).toEqual(['casual'])
    const forgot = await request.post('/api/v1/auth/password/forgot', { data: { email: user.email } })
    expect(forgot.status()).toBe(200)
    expect(forgot.headers()['x-e2e-backend']).toBe('go')
    const reset = await request.post('/api/v1/auth/password/reset', { data: { token: 'not-a-token', password: user.password } })
    expect(reset.status()).toBe(400)
    expect(reset.headers()['x-e2e-backend']).toBe('go')

    // The wardrobe of stage B4: upload, list, read, correct, the images, delete.
    const picture = await sharp({ create: { width: 320, height: 320, channels: 3, background: { r: 245, g: 245, b: 245 } } }).png().toBuffer()
    const upload = await request.post('/api/v1/wardrobe/items', {
      headers: { 'Idempotency-Key': `go-mode-${Date.now()}` },
      multipart: { file: { name: 'white-shirt.png', mimeType: 'image/png', buffer: picture } },
    })
    expect(upload.status()).toBe(201)
    expect(upload.headers()['x-e2e-backend']).toBe('go')
    const { item, detection } = await upload.json()
    expect(detection).toMatchObject({ category: 'shirt', mock: true })
    const list = await request.get('/api/v1/wardrobe/items?category=shirt&limit=10')
    expect(list.status()).toBe(200)
    expect(list.headers()['x-e2e-backend']).toBe('go')
    expect((await list.json()).items.map((i: { id: string }) => i.id)).toEqual([item.id])
    const read = await request.get(`/api/v1/wardrobe/items/${item.id}`)
    expect(read.status()).toBe(200)
    expect(read.headers()['x-e2e-backend']).toBe('go')
    const corrected = await request.patch(`/api/v1/wardrobe/items/${item.id}`, { data: { fit: 'slim' } })
    expect(corrected.status()).toBe(200)
    expect(corrected.headers()['x-e2e-backend']).toBe('go')
    expect((await corrected.json()).corrections).toHaveLength(1)
    // A link Go signed opens on Go, and no longer with another signature.
    // (That both servers sign and verify alike is proved by the golden
    // vectors of apps/api/testdata/golden/media.json, not here.)
    const image = await request.get(item.primaryImage.url)
    expect(image.status()).toBe(200)
    expect(image.headers()['x-e2e-backend']).toBe('go')
    expect(image.headers()['content-type']).toBe('image/webp')
    expect((await request.get(item.primaryImage.url.replace(/sig=.{4}/, 'sig=AAAA'))).status()).toBe(404)
    const removed = await request.delete(`/api/v1/wardrobe/items/${item.id}`)
    expect(removed.status()).toBe(200)
    expect(removed.headers()['x-e2e-backend']).toBe('go')
    expect((await request.get(item.primaryImage.url)).status()).toBe(404)

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

    // Go deletes the account: its session is refused at once.
    const deleted = await request.delete('/api/v1/account')
    expect(deleted.status()).toBe(200)
    expect(deleted.headers()['x-e2e-backend']).toBe('go')
    expect((await request.get('/api/v1/auth/me')).status()).toBe(401)
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
    const outfits = await page.request.get('/api/v1/outfits')
    expect(outfits.status()).toBe(200)
    expect(outfits.headers()['x-e2e-backend']).toBe('next')
  })
})
