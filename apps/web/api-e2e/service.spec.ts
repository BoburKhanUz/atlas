import { expect, test } from './fixtures'

/** What needs no session: the health check, the contract's document, the apps' error reports. */
test.describe('service', () => {
  test('health, the contract document and a client error report', async ({ api }) => {
    expect((await api.get('/api/health')).status).toBe(200)
    const doc = await api.get('/api/v1/openapi.json')
    expect(doc.status).toBe(200)
    expect(doc.body.openapi).toMatch(/^3\.1/)
    const report = await api.post('/api/v1/client-errors', {
      data: { reports: [{ platform: 'android', appVersion: '0.1.0+1', kind: 'flutter', errorType: 'StateError', message: 'Bad state: no element' }] },
    })
    expect(report.status).toBe(200)
    const bad = await api.post('/api/v1/client-errors', { data: { reports: [] } })
    expect([bad.status, bad.body.code]).toEqual([400, 'VALIDATION_ERROR'])
  })

  test('without a session every user operation is refused', async ({ api }) => {
    for (const [method, path] of [['GET', '/api/v1/auth/me'], ['GET', '/api/v1/wardrobe/items'], ['POST', '/api/v1/outfits/generate'], ['GET', '/api/v1/stylist/conversations'], ['GET', '/api/v1/color-profile'], ['DELETE', '/api/v1/account']]) {
      const res = await api.call(method, path, { mobile: true, data: method === 'POST' ? {} : undefined })
      expect([res.status, res.body.code], `${method} ${path}`).toEqual([401, 'UNAUTHORIZED'])
    }
  })
})
