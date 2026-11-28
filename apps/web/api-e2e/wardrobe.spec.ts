import { expect, test } from './fixtures'
import { garment, signUpMobile, storedFilesOf, upload } from './helpers'

/** The wardrobe: upload with the mock analysis, the list, a correction, the pictures, removal. */
test.describe('wardrobe', () => {
  test('an upload is analysed, listed, corrected, shown and removed', async ({ api }) => {
    const s = await signUpMobile(api, 'wr')
    const created = await upload(api, s, 'shirt', `api-e2e-${Date.now()}`)
    const { item, detection } = created.body as { item: { id: string; primaryImage: { url: string } }; detection: { category: string; mock: boolean } }
    expect(detection).toMatchObject({ category: 'shirt', mock: true })

    const list = await api.get('/api/v1/wardrobe/items?category=shirt&limit=10', { bearer: s.accessToken })
    expect(list.status).toBe(200)
    expect((list.body.items as Array<{ id: string }>).map((i) => i.id)).toEqual([item.id])

    const corrected = await api.patch(`/api/v1/wardrobe/items/${item.id}`, { bearer: s.accessToken, data: { fit: 'slim' } })
    expect(corrected.status).toBe(200)
    expect(corrected.body.corrections).toHaveLength(1)

    // A signed link opens without a session; a changed signature does not.
    const image = await api.get(item.primaryImage.url)
    expect(image.status).toBe(200)
    expect(image.headers['content-type']).toBe('image/webp')
    expect(image.headers['x-content-type-options']).toBe('nosniff')
    expect((await api.get(item.primaryImage.url.replace(/sig=.{4}/, 'sig=AAAA'))).status).toBe(404)

    expect((await api.delete(`/api/v1/wardrobe/items/${item.id}`, { bearer: s.accessToken })).status).toBe(200)
    expect((await api.get(`/api/v1/wardrobe/items/${item.id}`, { bearer: s.accessToken })).status).toBe(404)
    expect((await api.get(item.primaryImage.url)).status).toBe(404)
    expect(storedFilesOf(s.userId)).toEqual([])
  })

  test('the same Idempotency-Key gives the first answer again; another body under it is refused', async ({ api }) => {
    const s = await signUpMobile(api, 'idem')
    const key = `api-e2e-idem-${Date.now()}`
    const first = await upload(api, s, 'jeans', key)
    const replay = await upload(api, s, 'jeans', key)
    expect(replay.headers['idempotent-replayed']).toBe('true')
    expect((replay.body.item as { id: string }).id).toBe((first.body.item as { id: string }).id)
    const other = await api.post('/api/v1/wardrobe/items', {
      bearer: s.accessToken, headers: { 'Idempotency-Key': key }, multipart: { file: await garment('black-coat.png', [20, 20, 20]) },
    })
    expect(other.status).toBe(409)
    expect(other.body.code).toBe('IDEMPOTENCY_KEY_MISMATCH')
  })

  test('another user’s item is not found, and a file that is no picture is refused', async ({ api }) => {
    const owner = await signUpMobile(api, 'own')
    const stranger = await signUpMobile(api, 'str')
    const { item } = (await upload(api, owner, 'sneaker')).body as { item: { id: string } }
    for (const call of [
      api.get(`/api/v1/wardrobe/items/${item.id}`, { bearer: stranger.accessToken }),
      api.patch(`/api/v1/wardrobe/items/${item.id}`, { bearer: stranger.accessToken, data: { fit: 'slim' } }),
      api.delete(`/api/v1/wardrobe/items/${item.id}`, { bearer: stranger.accessToken }),
    ]) {
      const res = await call
      expect(res.status).toBe(404)
      expect(res.body.code).toBe('NOT_FOUND')
    }
    const notPicture = await api.post('/api/v1/wardrobe/items', {
      bearer: owner.accessToken, multipart: { file: { name: 'shirt.png', mimeType: 'image/png', buffer: Buffer.from('not a picture at all') } },
    })
    expect([notPicture.status, notPicture.body.code]).toEqual([422, 'INVALID_IMAGE'])
  })
})
