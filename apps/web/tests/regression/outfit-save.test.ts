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
  ],
}

describe('POST /api/v1/outfits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.wardrobeItem.findMany.mockResolvedValue([{ id: 'item_top' }, { id: 'item_bottom' }])
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
    db.wardrobeItem.findMany.mockResolvedValue([{ id: 'item_top' }])
    const res = await POST(jsonRequest('/api/v1/outfits', body, await authHeader()), undefined)
    expect(res.status).toBe(403)
    expect(db.outfit.create).not.toHaveBeenCalled()
  })

  it('requires authentication', async () => {
    const res = await POST(jsonRequest('/api/v1/outfits', body), undefined)
    expect(res.status).toBe(401)
  })
})
