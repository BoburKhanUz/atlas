import { expect, test } from './fixtures'

test.describe('crash monitoring (web)', () => {
  test('an uncaught browser error is reported to our server, scrubbed, once', async ({ page }) => {
    await page.goto('/login')
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
      route: '/login',
    })
    expect(String(reports[0].appVersion)).toMatch(/^\d+\.\d+\.\d+/)
    expect((await request.response())?.status()).toBe(200)
  })
})
