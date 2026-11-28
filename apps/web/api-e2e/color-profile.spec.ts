import { selfie } from '../tests/unit/ai/selfie-fixtures'
import { expect, test } from './fixtures'
import { signUpMobile } from './helpers'

/** The colour profile: a selfie analysed on the server, shown, removed. */
test.describe('colour profile', () => {
  test('a selfie becomes the profile; a flat picture is refused; the profile can be removed', async ({ api }) => {
    const s = await signUpMobile(api, 'color')
    expect((await api.get('/api/v1/color-profile', { bearer: s.accessToken })).body.status).toBe('not_analyzed')

    const buffer = await selfie({ skin: '#f1c9a5', hair: '#3b2416', eyes: '#5a3a22' })
    const analysed = await api.post('/api/v1/color-profile/analyze', { bearer: s.accessToken, multipart: { file: { name: 'selfie.jpg', mimeType: 'image/jpeg', buffer } } })
    expect(analysed.status).toBe(200)
    expect(typeof analysed.body.disclaimer).toBe('string')
    expect((await api.get('/api/v1/color-profile', { bearer: s.accessToken })).body.status).toBe('analyzed')

    const flat = await selfie({ skin: '#808080', hair: null, eyes: null, background: '#808080', noise: 0 })
    const refused = await api.post('/api/v1/color-profile/analyze', { bearer: s.accessToken, multipart: { file: { name: 'flat.jpg', mimeType: 'image/jpeg', buffer: flat } } })
    expect(refused.status).toBe(422)

    expect((await api.delete('/api/v1/color-profile', { bearer: s.accessToken })).status).toBe(200)
    expect((await api.get('/api/v1/color-profile', { bearer: s.accessToken })).body.status).toBe('not_analyzed')
  })
})
