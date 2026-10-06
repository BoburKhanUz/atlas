/**
 * Regression: POST /api/v1/stylist/chat fed the recommendation engine the
 * compact LLM wardrobe summary, so every engine item had `id: undefined` and
 * no pattern/fit/formality/sleeveLength/gender. It must pass full DB rows, and
 * only forward `weather` when it is complete.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  wardrobeItem: { findMany: vi.fn() },
  user: { findUnique: vi.fn() },
  userPreferences: { findUnique: vi.fn() },
  aiConversation: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  aiMessage: { create: vi.fn() },
  aiMemory: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
}))
vi.mock('@/lib/db', () => ({ db }))

vi.mock('@/lib/ai/recommendation', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/lib/ai/recommendation')>()
  return { ...m, generateOutfits: vi.fn(m.generateOutfits) }
})

import { POST } from '@/app/api/v1/stylist/chat/route'
import { generateOutfits } from '@/lib/ai/recommendation'
import { setLLMProviderForTesting } from '@/lib/ai/providers'
import { MockProvider } from '@/lib/ai/providers/mock'
import { authHeader, jsonRequest } from '../helpers'

const rows = [
  {
    id: 'item_shirt', category: 'shirt', subcategory: 'oxford', colors: JSON.stringify(['white']),
    pattern: 'solid', material: 'cotton', sleeveLength: 'long', fit: 'regular', style: 'smart_casual',
    season: JSON.stringify(['spring', 'autumn']), gender: 'male', formality: 3, images: [],
  },
  {
    id: 'item_pants', category: 'pants', subcategory: 'chino', colors: JSON.stringify(['navy']),
    pattern: 'solid', material: 'cotton', sleeveLength: null, fit: 'slim', style: 'smart_casual',
    season: JSON.stringify(['spring', 'summer']), gender: 'male', formality: 3, images: [],
  },
  {
    id: 'item_shoes', category: 'shoes', subcategory: 'sneakers', colors: JSON.stringify(['black']),
    pattern: 'solid', material: 'leather', sleeveLength: null, fit: 'regular', style: 'casual',
    season: JSON.stringify(['spring', 'autumn']), gender: 'male', formality: 2, images: [],
  },
]

const fullWeather = {
  temperature: 21, feelsLike: 20, condition: 'cloudy',
  precipitationProbability: 12, humidity: 60, windSpeed: 5, uvIndex: 0.4,
}

async function chat(body: Record<string, unknown>) {
  return POST(jsonRequest('/api/v1/stylist/chat', body, await authHeader()), undefined)
}

describe('POST /api/v1/stylist/chat engine input', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setLLMProviderForTesting(new MockProvider({ respond: () => 'Mana tavsiya.' }))
    db.wardrobeItem.findMany.mockResolvedValue(rows)
    db.user.findUnique.mockResolvedValue(null)
    db.userPreferences.findUnique.mockResolvedValue(null)
    db.aiConversation.findFirst.mockResolvedValue(null)
    db.aiConversation.create.mockResolvedValue({ id: 'conv_1', messages: [] })
    db.aiConversation.update.mockResolvedValue({})
    db.aiMessage.create.mockResolvedValue({})
    db.aiMemory.findMany.mockResolvedValue([])
    db.aiMemory.findFirst.mockResolvedValue(null)
    db.aiMemory.create.mockResolvedValue({})
  })

  it('passes full DB rows (id, pattern, fit, formality...) to the engine', async () => {
    const res = await chat({ message: 'Bugun nima kiyaman?' })
    expect(res.status).toBe(200)
    expect(generateOutfits).toHaveBeenCalledTimes(1)
    const { wardrobe } = vi.mocked(generateOutfits).mock.calls[0][0]
    expect(wardrobe).toHaveLength(rows.length)
    for (const row of rows) {
      const entry = wardrobe.find((w) => w.id === row.id)
      expect(entry).toBeDefined()
      expect(entry).toMatchObject({
        id: row.id,
        category: row.category,
        pattern: row.pattern,
        fit: row.fit,
        formality: row.formality,
        sleeveLength: row.sleeveLength,
        gender: row.gender,
        colors: JSON.parse(row.colors),
        season: JSON.parse(row.season),
      })
    }
  })

  it('drops partial weather but forwards complete weather', async () => {
    let res = await chat({ message: 'Bugun nima kiyaman?', weather: { temperature: 20 } })
    expect(res.status).toBe(200)
    expect(generateOutfits).toHaveBeenCalledTimes(1)
    expect(vi.mocked(generateOutfits).mock.calls[0][0].weather).toBeUndefined()

    vi.mocked(generateOutfits).mockClear()
    res = await chat({ message: 'Bugun nima kiyaman?', weather: fullWeather })
    expect(res.status).toBe(200)
    expect(generateOutfits).toHaveBeenCalledTimes(1)
    expect(vi.mocked(generateOutfits).mock.calls[0][0].weather).toEqual(fullWeather)
  })

  it('does not run the engine for a non-outfit message', async () => {
    const res = await chat({ message: 'Salom' })
    expect(res.status).toBe(200)
    expect(generateOutfits).not.toHaveBeenCalled()
  })
})
