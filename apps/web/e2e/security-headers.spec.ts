import { expect, test } from './fixtures'

// The pages' headers are set in next.config.ts; HSTS and the API's are added
// by Caddy and the Go server (deploy/Caddyfile, apps/api).
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
    expect((await request.get('/')).headers()['referrer-policy']).toBe('strict-origin-when-cross-origin')
  })

  test('the reset page sends no referrer at all', async ({ request }) => {
    const res = await request.get('/reset-password?token=e2e')
    expect(res.status()).toBe(200)
    expect(res.headers()['referrer-policy']).toBe('no-referrer')
  })
})
