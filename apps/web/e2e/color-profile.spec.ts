import sharp from 'sharp'
import { expect, test } from './fixtures'
import { registerViaApi } from './helpers'
import { selfie } from '../tests/unit/ai/selfie-fixtures'

// Colour analysis is deterministic and in-process (no AI provider, no mock):
// a synthetic selfie gives the same result on every run.
test.describe('colour profile', () => {
  test('analyse → current → delete; a poor photo is refused and stores nothing', async ({ page }) => {
    await registerViaApi(page.request)
    const upload = (buffer: Buffer) =>
      page.request.post('/api/v1/color-profile/analyze', { multipart: { file: { name: 'selfie.jpg', mimeType: 'image/jpeg', buffer } } })

    const flat = await sharp({ create: { width: 400, height: 500, channels: 3, background: '#E0AC69' } }).jpeg().toBuffer()
    const refused = await upload(flat)
    expect(refused.status()).toBe(422)
    expect((await refused.json()).code).toBe('PHOTO_QUALITY_TOO_LOW')
    expect((await (await page.request.get('/api/v1/color-profile')).json()).status).toBe('not_analyzed')

    const ok = await upload(await selfie({ skin: '#f1c9a5', hair: '#3b2416', eyes: '#5a3a22' }))
    expect(ok.status()).toBe(200)
    const { colorProfile } = await ok.json()
    expect(colorProfile).toMatchObject({ season: 'spring', undertone: 'warm' })
    expect(colorProfile.confidence).toBeLessThanOrEqual(0.8)
    expect((await (await page.request.get('/api/v1/color-profile')).json()).colorProfile.season).toBe('spring')

    expect((await page.request.delete('/api/v1/color-profile')).status()).toBe(200)
    expect((await (await page.request.get('/api/v1/color-profile')).json()).status).toBe('not_analyzed')
  })
})
