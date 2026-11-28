import { expect, test } from './fixtures'

/**
 * What every page of the website shares: the viewport, the 404 page, and the crash
 * reports that go to the Go server (POST /api/v1/client-errors through the front
 * proxy, as through Caddy).
 */
test.describe('the website', () => {
  test('the viewport meta does not disable zoom', async ({ page }) => {
    await page.goto('/')
    const content = await page.locator('meta[name=viewport]').getAttribute('content')
    expect(content).toBeTruthy()
    expect(content).not.toMatch(/user-scalable\s*=\s*(no|0)/i)
    expect(content).not.toMatch(/maximum-scale\s*=\s*1(\.0)?\b/i)
    expect(content).toMatch(/width=device-width/)
  })

  test('an unknown address shows the not-found page with a way home (404)', async ({ page }) => {
    const res = await page.goto('/this-route-does-not-exist')
    expect(res?.status()).toBe(404)
    await expect(page.getByText('Sahifa topilmadi')).toBeVisible()
    await page.getByRole('link', { name: 'Bosh sahifaga qaytish' }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Shaxsiy AI stilistingiz')
  })

  test('an uncaught browser error is reported to the Go server, scrubbed, once', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    const reported = page.waitForRequest((r) => r.url().endsWith('/api/v1/client-errors') && r.method() === 'POST')
    await page.evaluate(() => {
      for (let i = 0; i < 3; i++) {
        setTimeout(() => {
          throw new Error('e2e boom for ali@example.uz')
        }, 0)
      }
    })
    const request = await reported
    const { reports } = request.postDataJSON() as { reports: Array<Record<string, unknown>> }
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({
      platform: 'web',
      kind: 'web_error',
      fatal: true,
      errorType: 'Error',
      message: 'e2e boom for [REDACTED_EMAIL]',
      route: '/',
    })
    expect(String(reports[0].appVersion)).toMatch(/^\d+\.\d+\.\d+/)
    expect((await request.response())?.status()).toBe(200)
  })
})
