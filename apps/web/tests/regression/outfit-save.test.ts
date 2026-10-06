/**
 * Regression: POST /api/v1/outfits returned HTTP 500 whenever a weather
 * object was included, because `z.record(z.unknown())` is invalid in Zod 4.
 * Saving, liking and disliking outfits all go through this endpoint.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  wardrobeItem: { findMany: vi.fn() },
  outfit: { create: vi.fn() },
}))
vi.mock('@/lib/db', () => ({ db }))

import { POST } from '@/app/api/v1/outfits/route'
import { authHeader, jsonRequest, TEST_USER } from '../helpers'

const weather = {
  temperature: 21,
  feelsLike: 20,
  condition: 'cloudy',
  precipitationProbability: 12,
  humidity: 60,
  windSpeed: 5,
  uvIndex: 0.4,
}

const body = {
  occasion: 'work',
  weather,
  score: 79,
  reasons: ['color_harmony'],
  explanation: 'test',
  isSaved: true,
  items: [
    { itemId: 'item_top', role: 'top' },
    { itemId: 'item_bottom', role: 'bottom' },
    { itemId: 'item_shoes', role: 'shoes' }, // Phase 4.4: footwear is required
  ],
}

describe('POST /api/v1/outfits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.wardrobeItem.findMany.mockResolvedValue([
      { id: 'item_top', category: 'shirt' },
      { id: 'item_bottom', category: 'pants' },
      { id: 'item_shoes', category: 'shoes' },
    ])
    db.outfit.create.mockImplementation(async ({ data }) => ({ id: 'outfit_1', ...data, items: [] }))
  })

  it('saves an outfit that includes a weather snapshot (was HTTP 500)', async () => {
    const res = await POST(jsonRequest('/api/v1/outfits', body, await authHeader()), undefined)
    expect(res.status).toBe(201)
    const createArgs = db.outfit.create.mock.calls[0][0]
    expect(createArgs.data.userId).toBe(TEST_USER.sub)
    expect(JSON.parse(createArgs.data.weatherSnapshot)).toEqual(weather)
  })

  it('still saves when weather is null', async () => {
    const res = await POST(jsonRequest('/api/v1/outfits', { ...body, weather: null }, await authHeader()), undefined)
    expect(res.status).toBe(201)
  })

  it('rejects items the user does not own', async () => {
    db.wardrobeItem.findMany.mockResolvedValue([{ id: 'item_top', category: 'shirt' }])
    const res = await POST(jsonRequest('/api/v1/outfits', body, await authHeader()), undefined)
    expect(res.status).toBe(403)
    expect(db.outfit.create).not.toHaveBeenCalled()
  })

  describe('Phase 4.4 composition validation (score and reasons stored as supplied)', () => {
    // Like the database: only the requested ids that exist are returned.
    const owned = (...rows: Array<[string, string]>) =>
      db.wardrobeItem.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
        rows.filter(([id]) => where.id.in.includes(id)).map(([id, category]) => ({ id, category })),
      )
    const save = async (items: Array<{ itemId: string; role: string }>, extra: Record<string, unknown> = {}) =>
      POST(jsonRequest('/api/v1/outfits', { ...body, ...extra, items }, await authHeader()), undefined)
    const expectInvalid = async (res: Response, path?: string) => {
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.code).toBe('VALIDATION_ERROR')
      if (path) expect(json.details[0].path).toBe(path)
      expect(db.outfit.create).not.toHaveBeenCalled()
    }

    it('stores the supplied score, readable reasons and roles unchanged', async () => {
      const res = await save(body.items, { score: 83.6, reasons: ['Ob-havoga mos', 'Ranglar uyg‘un'] })
      expect(res.status).toBe(201)
      const data = db.outfit.create.mock.calls[0][0].data
      expect(data.score).toBe(84)
      expect(JSON.parse(data.reasonsJson)).toEqual(['Ob-havoga mos', 'Ranglar uyg‘un'])
      expect(data.items.create.map((i: { role: string }) => i.role)).toEqual(['top', 'bottom', 'shoes'])
    })

    it('accepts dress, layered and accessory outfits with legacy or slot roles', async () => {
      owned(['d', 'dress'], ['o', 'outerwear'], ['f', 'shoes'], ['a', 'accessory'], ['g', 'bag'])
      expect((await save([{ itemId: 'd', role: 'top' }, { itemId: 'o', role: 'outerwear' }, { itemId: 'f', role: 'shoes' }, { itemId: 'a', role: 'accessory' }, { itemId: 'g', role: 'accessory' }])).status).toBe(201)
      expect((await save([{ itemId: 'd', role: 'dress' }, { itemId: 'f', role: 'footwear' }])).status).toBe(201)
    })

    it('rejects an unknown role before touching the database', async () => {
      await expectInvalid(await save([{ itemId: 'item_top', role: 'hat' }, ...body.items.slice(1)]), 'items.0.role')
      expect(db.wardrobeItem.findMany).not.toHaveBeenCalled()
    })

    it('rejects a role that does not match the item (shoes saved as top)', async () => {
      await expectInvalid(await save([{ itemId: 'item_top', role: 'top' }, { itemId: 'item_bottom', role: 'bottom' }, { itemId: 'item_shoes', role: 'top' }]), 'items.2.role')
    })

    it('rejects duplicate items', async () => {
      await expectInvalid(await save([...body.items, { itemId: 'item_top', role: 'top' }]))
      expect(db.wardrobeItem.findMany).not.toHaveBeenCalled()
    })

    it.each([
      ['missing footwear', [['t', 'shirt'], ['b', 'pants']]],
      ['two shoes', [['t', 'shirt'], ['b', 'pants'], ['f', 'shoes'], ['g', 'shoes']]],
      ['dress with a bottom', [['d', 'dress'], ['b', 'pants'], ['f', 'shoes']]],
      ['two tops', [['t', 'shirt'], ['u', 'shirt'], ['b', 'pants'], ['f', 'shoes']]],
      ['no main pieces', [['o', 'outerwear'], ['f', 'shoes']]],
    ] as Array<[string, Array<[string, string]>]>)('rejects %s', async (_n, rows) => {
      owned(...rows)
      const role = (c: string) => ({ shirt: 'top', pants: 'bottom', shoes: 'shoes', dress: 'dress', outerwear: 'outerwear' })[c]!
      await expectInvalid(await save(rows.map(([itemId, c]) => ({ itemId, role: role(c) }))))
    })
  })

  it('requires authentication', async () => {
    const res = await POST(jsonRequest('/api/v1/outfits', body), undefined)
    expect(res.status).toBe(401)
  })
})
