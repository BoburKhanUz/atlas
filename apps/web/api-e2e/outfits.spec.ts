import { expect, test } from './fixtures'
import { signUpMobile, upload } from './helpers'

const TASHKENT = 'lat=41.311482&lon=69.240562'

/** The weather and the outfits: generated from the wardrobe, saved, rated, renamed, removed. */
test.describe('outfits', () => {
  test('outfits are made of the wardrobe, then stored, marked saved, renamed, listed and removed', async ({ api }) => {
    const s = await signUpMobile(api, 'out')
    for (const kind of ['shirt', 'jeans', 'sneaker'] as const) await upload(api, s, kind)

    const weather = await api.get(`/api/v1/weather/current?${TASHKENT}`, { bearer: s.accessToken })
    expect(weather.status).toBe(200)
    expect(weather.body.weather).toMatchObject({ source: 'mock' })

    const generated = await api.post('/api/v1/outfits/generate', { bearer: s.accessToken, data: { occasion: 'casual', lat: 41.311482, lon: 69.240562 } })
    expect(generated.status).toBe(200)
    const g = generated.body as { outfits: Array<{ items: Array<{ id: string; role: string }>; score: number; reasons: string[]; explanation: string }>; weatherUsed: unknown; wardrobeItemCount: number }
    expect(g.wardrobeItemCount).toBe(3)
    expect(g.outfits.length).toBeGreaterThan(0)
    const made = g.outfits[0]

    const saved = await api.post('/api/v1/outfits', {
      bearer: s.accessToken,
      data: { items: made.items.map((i) => ({ itemId: i.id, role: i.role })), occasion: 'casual', weather: g.weatherUsed, score: made.score, reasons: made.reasons, explanation: made.explanation },
    })
    expect(saved.status).toBe(201)
    const id = (saved.body.outfit as { id: string }).id
    expect((await api.post(`/api/v1/outfits/${id}/feedback`, { bearer: s.accessToken, data: { feedback: 'saved' } })).status).toBe(201)
    expect((await api.patch(`/api/v1/outfits/${id}`, { bearer: s.accessToken, data: { name: 'Juma uchun' } })).status).toBe(200)

    const list = await api.get('/api/v1/outfits?saved=1', { bearer: s.accessToken })
    expect((list.body.outfits as Array<{ id: string; name: string }>).map((o) => [o.id, o.name])).toEqual([[id, 'Juma uchun']])
    const detail = await api.get(`/api/v1/outfits/${id}`, { bearer: s.accessToken })
    expect((detail.body.outfit as { items: unknown[] }).items).toHaveLength(made.items.length)
    expect((await api.delete(`/api/v1/outfits/${id}`, { bearer: s.accessToken })).status).toBe(200)
    expect((await api.get(`/api/v1/outfits/${id}`, { bearer: s.accessToken })).status).toBe(404)
  })

  test('an empty wardrobe gets a message instead of outfits; another user’s item cannot be saved', async ({ api }) => {
    const s = await signUpMobile(api, 'empty')
    const generated = await api.post('/api/v1/outfits/generate', { bearer: s.accessToken, data: { occasion: 'work' } })
    expect(generated.status).toBe(200)
    expect(generated.body.outfits).toEqual([])
    expect(typeof generated.body.message).toBe('string')

    const other = await signUpMobile(api, 'other')
    const { item } = (await upload(api, other, 'shirt')).body as { item: { id: string } }
    const foreign = await api.post('/api/v1/outfits', { bearer: s.accessToken, data: { items: [{ itemId: item.id, role: 'top' }], occasion: 'casual' } })
    expect([foreign.status, foreign.body.code]).toEqual([403, 'FORBIDDEN'])
  })
})
