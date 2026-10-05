import { execFileSync } from 'child_process'
import { createHash } from 'crypto'
import type { Page, Route } from '@playwright/test'
import { cookieByName, registerViaUi } from './helpers'
import { expect, test } from './fixtures'

/**
 * CLI-W7 / CLI-W8: client recovery against the real build. Refresh responses
 * are injected with network interception (SESSION_RACE, SESSION_BUSY, timeout,
 * terminal), the API client must stay within 3 refresh calls, keep the
 * session unless the server said it is over, and never call logout.
 */

/** Signed in on /outfits with the access cookie gone and background RSC/prefetch requests blocked. */
async function signedInWithoutAccessCookie(page: Page) {
  await registerViaUi(page)
  await page.goto('/outfits')
  await expect(page.getByRole('button', { name: /Boshlash/ })).toBeVisible()
  // keep the proxy from renewing the session first: isolate the client-side path
  await page.route('**/*', (route) => {
    const h = route.request().headers()
    if (h['rsc'] || h['next-router-prefetch']) return route.abort()
    return route.continue()
  })
  await page.context().clearCookies({ name: 'atlas_at' })
}

function trackRequests(page: Page) {
  const calls: string[] = []
  page.on('request', (r) => {
    const p = new URL(r.url()).pathname
    if (p.startsWith('/api/v1/auth/')) calls.push(p)
  })
  return { refreshes: () => calls.filter((p) => p.endsWith('/refresh')).length, logouts: () => calls.filter((p) => p.endsWith('/logout')).length }
}

const json = (route: Route, status: number, body: unknown, headers: Record<string, string> = {}) =>
  route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) })

test.describe('client session recovery', () => {
  test('SESSION_RACE: the client retries without refreshing, then refreshes once more and succeeds (≤ 3 refreshes)', async ({ page }) => {
    await signedInWithoutAccessCookie(page)
    const t = trackRequests(page)
    let injected = false
    await page.route('**/api/v1/auth/refresh', (route) => {
      if (injected) return route.continue()
      injected = true
      return json(route, 401, { error: 'race', code: 'SESSION_RACE' })
    })
    const generated = page.waitForResponse((r) => r.url().endsWith('/api/v1/outfits/generate') && r.status() === 200)
    await page.getByRole('button', { name: /Boshlash/ }).click()
    await generated
    await expect(page).toHaveURL(/\/outfits$/)
    expect(t.refreshes()).toBe(2)
    expect(t.logouts()).toBe(0)
    expect(cookieByName(await page.context().cookies(), 'atlas_at')).toBeDefined()
  })

  test('SESSION_BUSY ×3: inline busy message, still signed in, session kept, exactly 3 refreshes', async ({ page }) => {
    await signedInWithoutAccessCookie(page)
    const rtBefore = cookieByName(await page.context().cookies(), 'atlas_rt')!.value
    const t = trackRequests(page)
    await page.route('**/api/v1/auth/refresh', (route) => json(route, 503, { error: 'busy', code: 'SESSION_BUSY' }, { 'Retry-After': '1' }))
    await page.getByRole('button', { name: /Boshlash/ }).click()
    await expect(page.getByText('Server hozir band', { exact: false }).first()).toBeVisible({ timeout: 15_000 })
    await expect(page).toHaveURL(/\/outfits$/)
    expect(t.refreshes()).toBe(3)
    expect(t.logouts()).toBe(0)
    expect(cookieByName(await page.context().cookies(), 'atlas_rt')!.value).toBe(rtBefore)

    // 30 s cool-down: another action does not refresh again
    await page.getByRole('button', { name: /Boshlash/ }).click()
    await expect(page.getByText('Server hozir band', { exact: false }).first()).toBeVisible()
    expect(t.refreshes()).toBe(3)
  })

  test('refresh timeouts: retried after 1 s and 2 s, then an offline message; cookies kept', async ({ page }) => {
    await signedInWithoutAccessCookie(page)
    const rtBefore = cookieByName(await page.context().cookies(), 'atlas_rt')!.value
    const t = trackRequests(page)
    await page.route('**/api/v1/auth/refresh', (route) => route.abort('timedout'))
    await page.getByRole('button', { name: /Boshlash/ }).click()
    await expect(page.getByText('Tarmoq xatosi', { exact: false }).first()).toBeVisible({ timeout: 15_000 })
    expect(t.refreshes()).toBe(3)
    expect(t.logouts()).toBe(0)
    await expect(page).toHaveURL(/\/outfits$/)
    expect(cookieByName(await page.context().cookies(), 'atlas_rt')!.value).toBe(rtBefore)
  })

  test('terminal (real SESSION_REVOKED — logged out in another tab): straight to /login?expired=1, one refresh, no logout call', async ({ page, playwright, baseURL }) => {
    await signedInWithoutAccessCookie(page)
    // An injected terminal code would not do: the login page would renew the
    // still-valid session. End it for real from "another tab" instead.
    const rt = cookieByName(await page.context().cookies(), 'atlas_rt')!.value
    const otherTab = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Cookie: `atlas_rt=${rt}` } })
    expect((await otherTab.post('/api/v1/auth/logout')).status()).toBe(200)
    await otherTab.dispose()
    const t = trackRequests(page)
    // pass the real response through, keeping a copy (the page navigates away before its body can be read)
    const seen: Array<[number, string]> = []
    await page.route('**/api/v1/auth/refresh', async (route) => {
      const real = await route.fetch()
      seen.push([real.status(), (await real.json()).code])
      await route.fulfill({ response: real })
    })
    await page.getByRole('button', { name: /Boshlash/ }).click()
    await expect(page).toHaveURL(/\/login\?.*expired=1/, { timeout: 15_000 })
    expect(seen).toEqual([[401, 'SESSION_REVOKED']])
    expect(t.refreshes()).toBe(1)
    expect(t.logouts()).toBe(0)
  })

  test('CLI-W8: page load that keeps losing the rotation race → one automatic retry, then /login (no redirect loop)', async ({ page, playwright, baseURL }) => {
    const databaseUrl = process.env.E2E_DATABASE_URL
    test.skip(!databaseUrl, 'needs E2E_DATABASE_URL')
    await registerViaUi(page)
    const rt1 = cookieByName(await page.context().cookies(), 'atlas_rt')!
    // rotate rt1 elsewhere (another tab), and remove the stored successor so a
    // replay of rt1 inside the 60 s window cannot be served → SESSION_RACE
    const other = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Cookie: `atlas_rt=${rt1.value}` } })
    expect((await other.post('/api/v1/auth/refresh')).status()).toBe(200)
    await other.dispose()
    const hash = createHash('sha256').update(rt1.value).digest('hex')
    execFileSync('psql', [databaseUrl!.replace(/\?.*$/, ''), '-v', 'ON_ERROR_STOP=1', '-c', `UPDATE "Session" SET "successorTokenEnc" = NULL WHERE "tokenHash" = '${hash}'`], {
      env: { ...process.env, PGHOST: new URL(databaseUrl!).searchParams.get('host') ?? undefined },
    })

    await page.context().clearCookies({ name: 'atlas_at' })
    const documents: string[] = []
    page.on('response', (r) => {
      if (r.request().resourceType() === 'document') documents.push(`${r.status()} ${new URL(r.url()).pathname}`)
    })
    await page.goto('/wardrobe')
    await expect(page).toHaveURL(/\/login\?next=%2Fwardrobe/)
    expect(documents.filter((d) => d.startsWith('307 /wardrobe'))).toHaveLength(2) // first try + the one retry
    expect(documents.length).toBeLessThanOrEqual(3)
    const cookies = await page.context().cookies()
    expect(cookieByName(cookies, 'atlas_retry')).toBeUndefined()
    expect(cookieByName(cookies, 'atlas_rt')?.value).toBe(rt1.value) // the session cookie was not cleared
  })
})
