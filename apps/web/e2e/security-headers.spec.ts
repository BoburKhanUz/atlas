import { expect, test } from './fixtures'

// Set in next.config.ts; HSTS is added by Caddy in front of the app (deploy/Caddyfile).
test.describe('security headers', () => {
  test('pages and API responses: nosniff, no framing, referrer policy, no x-powered-by', async ({ request }) => {
    for (const path of ['/', '/login', '/privacy', '/api/health', '/api/v1/legal']) {
      const res = await request.get(path, { maxRedirects: 0 })
      const headers = res.headers()
      expect(headers['x-content-type-options'], path).toBe('nosniff')
      expect(headers['x-frame-options'], path).toBe('DENY')
      expect(headers['content-security-policy'], path).toBe("frame-ancestors 'none'")
      expect(headers['referrer-policy'], path).toBe('strict-origin-when-cross-origin')
      expect(headers['x-powered-by'], path).toBeUndefined()
    }
  })

  test('the reset page sends no referrer at all', async ({ request }) => {
    const res = await request.get('/reset-password?token=e2e')
    expect(res.status()).toBe(200)
    expect(res.headers()['referrer-policy']).toBe('no-referrer')
  })

  test('media keeps its own content security policy', async ({ request }) => {
    const res = await request.get('/api/v1/media/users/x/none.webp?exp=1&sig=AAAA')
    expect(res.status()).toBe(404)
    expect(res.headers()['content-security-policy']).toBeUndefined()
    expect(res.headers()['x-content-type-options']).toBe('nosniff')
  })
})
