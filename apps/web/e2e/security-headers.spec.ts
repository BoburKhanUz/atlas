import { expect, test } from './fixtures'

// The pages' headers are set in next.config.ts; HSTS is Caddy's (B7.7) and the
// API's are the Go server's (apps/api).
test.describe('security headers of the pages', () => {
  test('nosniff, no framing, referrer policy, no x-powered-by', async ({ request }) => {
    for (const path of ['/', '/privacy', '/terms', '/reset-password']) {
      const res = await request.get(path, { maxRedirects: 0 })
      expect(res.status(), path).toBe(200)
      const headers = res.headers()
      expect(headers['x-content-type-options'], path).toBe('nosniff')
      expect(headers['x-frame-options'], path).toBe('DENY')
      expect(headers['content-security-policy'], path).toBe("frame-ancestors 'none'")
      expect(headers['x-powered-by'], path).toBeUndefined()
    }
    for (const path of ['/', '/privacy', '/terms']) {
      expect((await request.get(path)).headers()['referrer-policy'], path).toBe('strict-origin-when-cross-origin')
    }
  })

  test('the reset page sends no referrer at all', async ({ request }) => {
    const res = await request.get('/reset-password?token=e2e')
    expect(res.status()).toBe(200)
    expect(res.headers()['referrer-policy']).toBe('no-referrer')
  })
})
