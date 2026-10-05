import { expect, test } from './fixtures'
import { cookieByName, registerViaApi, registerViaUi, uniqueUser } from './helpers'

/**
 * Runs against the "session" server (ACCESS_TOKEN_TTL_SECONDS=10, the app's minimum).
 */
test.describe('session lifecycle', () => {
  test('cookie attributes: atlas_at path=/ HttpOnly, atlas_rt path=/ HttpOnly', async ({ page }) => {
    await registerViaUi(page)
    const cookies = await page.context().cookies()
    const at = cookieByName(cookies, 'atlas_at')!
    const rt = cookieByName(cookies, 'atlas_rt')!
    expect(at.path).toBe('/')
    expect(at.httpOnly).toBe(true)
    expect(rt.path).toBe('/')
    expect(rt.httpOnly).toBe(true)
  })

  test('missing access cookie: in-app API call transparently refreshes (rotates atlas_rt) without leaving the page', async ({ page }) => {
    await registerViaUi(page)
    await page.goto('/outfits')
    await expect(page.getByRole('button', { name: /Boshlash/ })).toBeVisible()
    const oldRt = cookieByName(await page.context().cookies(), 'atlas_rt')!.value

    await page.context().clearCookies({ name: 'atlas_at' })
    const cookiesNow = await page.context().cookies()
    expect(cookieByName(cookiesNow, 'atlas_at')).toBeUndefined()
    expect(cookieByName(cookiesNow, 'atlas_rt')).toBeDefined()

    // The session may be renewed by either path, both valid: the API client's
    // 401 -> POST /auth/refresh -> retry, or the proxy rotating atlas_rt on a
    // background RSC request (e.g. Next's link prefetch) before the click.
    const refreshCalls: number[] = []
    page.on('response', (r) => {
      if (r.url().endsWith('/api/v1/auth/refresh')) refreshCalls.push(r.status())
    })
    const generated = page.waitForResponse((r) => r.url().endsWith('/api/v1/outfits/generate') && r.status() === 200)
    await page.getByRole('button', { name: /Boshlash/ }).click()
    await generated
    await expect(page).toHaveURL(/\/outfits$/)
    expect(refreshCalls.every((status) => status === 200)).toBe(true)

    const after = await page.context().cookies()
    expect(cookieByName(after, 'atlas_at')).toBeDefined()
    expect(cookieByName(after, 'atlas_rt')!.value).not.toBe(oldRt)
  })

  test('API client interceptor: 401 -> POST /auth/refresh -> retry succeeds (prefetch blocked)', async ({ page }) => {
    await registerViaUi(page)
    await page.goto('/outfits')
    await expect(page.getByRole('button', { name: /Boshlash/ })).toBeVisible()
    // Block Next's background RSC/prefetch requests so the proxy cannot renew
    // the session first; this isolates the client-side refresh path.
    await page.route('**/*', (route) => {
      const h = route.request().headers()
      if (h['rsc'] || h['next-router-prefetch']) return route.abort()
      return route.continue()
    })
    await page.context().clearCookies({ name: 'atlas_at' })

    const refreshed = page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/refresh'))
    const generated = page.waitForResponse((r) => r.url().endsWith('/api/v1/outfits/generate') && r.status() === 200)
    await page.getByRole('button', { name: /Boshlash/ }).click() // fetch -> 401 -> refresh -> retry
    expect((await refreshed).status()).toBe(200)
    await generated
    await expect(page).toHaveURL(/\/outfits$/)
    expect(cookieByName(await page.context().cookies(), 'atlas_at')).toBeDefined()
  })

  // Regression: atlas_rt used to be Path=/api/v1/auth, so it was never sent on page loads and a
  // reload after the access cookie expired signed the user out. It is now Path=/.
  test('expired access cookie + valid refresh cookie: page navigation keeps the user signed in', async ({ page }) => {
    await registerViaUi(page)
    await page.goto('/wardrobe')
    await expect(page.getByRole('heading', { name: 'Garderob', level: 1 })).toBeVisible()
    await page.context().clearCookies({ name: 'atlas_at' })
    await page.reload()
    await expect(page).toHaveURL(/\/wardrobe$/)
    await expect(page.getByRole('heading', { name: 'Garderob', level: 1 })).toBeVisible()
  })

  test('access token genuinely expires (TTL 10s): next in-app API call refreshes transparently', async ({ page }) => {
    test.setTimeout(60_000)
    await registerViaUi(page)
    await page.goto('/outfits')
    await expect(page.getByRole('button', { name: /Boshlash/ })).toBeVisible()
    const at1 = cookieByName(await page.context().cookies(), 'atlas_at')!
    await page.waitForTimeout(11_500) // browser drops the cookie at max-age
    expect(cookieByName(await page.context().cookies(), 'atlas_at')).toBeUndefined()

    const refreshed = page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/refresh'))
    const generated = page.waitForResponse((r) => r.url().endsWith('/api/v1/outfits/generate') && r.status() === 200)
    await page.getByRole('button', { name: /Boshlash/ }).click()
    expect((await refreshed).status()).toBe(200)
    await generated
    await expect(page).toHaveURL(/\/outfits$/)
    const at2 = cookieByName(await page.context().cookies(), 'atlas_at')
    expect(at2, 'fresh access cookie after refresh').toBeDefined()
    expect(at2!.value).not.toBe(at1.value)
    expect((await page.request.get('/api/v1/auth/me')).status()).toBe(200)
  })

  test('both cookies cleared -> protected page redirects to /login', async ({ page }) => {
    await registerViaUi(page)
    await page.context().clearCookies()
    await page.goto('/wardrobe')
    await expect(page).toHaveURL(/\/login\?next=%2Fwardrobe/)
  })

  test('both cookies cleared while in the app -> API 401 sends user to /login?expired=1 with notice', async ({ page }) => {
    await registerViaUi(page)
    await page.goto('/outfits')
    await expect(page.getByRole('button', { name: /Boshlash/ })).toBeVisible()
    await page.context().clearCookies()
    await page.getByRole('button', { name: /Boshlash/ }).click() // API 401 -> refresh 401 -> redirect
    await expect(page).toHaveURL(/\/login\?.*expired=1/, { timeout: 15_000 })
    await expect(page).toHaveURL(/next=%2Foutfits/)
    await expect(page.getByRole('status').filter({ hasText: 'Sessiya muddati tugadi' })).toBeVisible()
  })

  test('tampered refresh cookie -> login', async ({ page }) => {
    await registerViaUi(page)
    const cookies = await page.context().cookies()
    const rt = cookieByName(cookies, 'atlas_rt')!
    await page.context().clearCookies({ name: 'atlas_at' })
    await page.context().clearCookies({ name: 'atlas_rt' })
    await page.context().addCookies([
      { name: 'atlas_rt', value: rt.value.slice(0, -4) + 'AAAA', domain: rt.domain, path: '/', httpOnly: true, sameSite: 'Lax' },
    ])
    const res = await page.request.post('/api/v1/auth/refresh')
    expect(res.status()).toBe(401)
    await page.goto('/wardrobe')
    await expect(page).toHaveURL(/\/login/)
  })

  test('after logout the old refresh token replayed via API -> 401', async ({ page, playwright, baseURL }) => {
    await registerViaUi(page)
    const oldRt = cookieByName(await page.context().cookies(), 'atlas_rt')!.value
    expect((await page.request.post('/api/v1/auth/logout')).status()).toBeLessThan(300)

    const fresh = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Cookie: `atlas_rt=${oldRt}` } })
    const res = await fresh.post('/api/v1/auth/refresh')
    expect(res.status()).toBe(401)
    await fresh.dispose()
  })

  test('refresh rotation: replaying the pre-rotation token (after grace) is rejected, session revoked', async ({ page, playwright, baseURL }) => {
    test.setTimeout(120_000)
    const user = uniqueUser('rot')
    await registerViaApi(page.request, user)
    const rt1 = cookieByName(await page.context().cookies(), 'atlas_rt')!.value
    expect((await page.request.post('/api/v1/auth/refresh')).status()).toBe(200)
    const rt2 = cookieByName(await page.context().cookies(), 'atlas_rt')!.value
    expect(rt2).not.toBe(rt1)
    // within 60 s the old token would get the same new token back (grace replay)
    const replay = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Cookie: `atlas_rt=${rt1}` } })
    const replayed = await replay.post('/api/v1/auth/refresh')
    expect(replayed.status()).toBe(200)
    expect(replayed.headers()['set-cookie']).toContain(`atlas_rt=${rt2}`)
    await replay.dispose()
    await page.waitForTimeout(61_000) // grace window: 60 s

    const attacker = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Cookie: `atlas_rt=${rt1}` } })
    expect((await attacker.post('/api/v1/auth/refresh')).status()).toBe(401)
    await attacker.dispose()
    // Reuse detection revokes the family: the legitimate newest token is dead too.
    const legit = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Cookie: `atlas_rt=${rt2}` } })
    expect((await legit.post('/api/v1/auth/refresh')).status()).toBe(401)
    await legit.dispose()
  })
})
