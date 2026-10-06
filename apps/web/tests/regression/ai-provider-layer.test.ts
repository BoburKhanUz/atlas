/**
 * Phase 4.0: the wardrobe analysis goes through the provider-independent AI
 * layer; failures stay soft; no content reaches the logs. (The stylist changed
 * in Phase 4.2: tests/regression/stylist-chat.test.ts; the outfit explanation
 * in Phase 4.4: tests/regression/outfit-generate.test.ts.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'

const db = vi.hoisted(() => ({
  wardrobeItem: { findMany: vi.fn() },
  user: { findUnique: vi.fn() },
  userPreferences: { findUnique: vi.fn() },
  aiConversation: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  aiMessage: { create: vi.fn() },
  aiMemory: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  outfitFeedback: { findMany: vi.fn() },
  outfitItem: { findMany: vi.fn() },
}))
vi.mock('@/lib/db', () => ({ db }))

import { POST as generatePOST } from '@/app/api/v1/outfits/generate/route'
import { setLLMProviderForTesting } from '@/lib/ai/providers'
import { AiProviderError } from '@/lib/ai/providers/errors'
import { MockProvider } from '@/lib/ai/providers/mock'
import { analyzeClothing } from '@/lib/ai/mock-vision'
import { analyzeGarment } from '@/lib/ai/vision-service'
import { analyzeColorSelfie } from '@/lib/ai/color-service'
import { analyzeSelfie } from '@/lib/ai/color-analysis'
import { authHeader, jsonRequest } from '../helpers'
import { selfie } from '../unit/ai/selfie-fixtures'

const rows = [
  { id: 'item_shirt', category: 'shirt', subcategory: 'oxford_shirt', colors: JSON.stringify(['white']), pattern: 'solid', material: 'cotton', sleeveLength: 'long', fit: 'regular', style: 'smart_casual', season: JSON.stringify(['spring', 'autumn']), gender: 'male', formality: 'smart_casual', images: [] },
  { id: 'item_pants', category: 'pants', subcategory: 'chinos', colors: JSON.stringify(['navy']), pattern: 'solid', material: 'cotton', sleeveLength: null, fit: 'slim', style: 'smart_casual', season: JSON.stringify(['spring', 'summer']), gender: 'male', formality: 'smart_casual', images: [] },
  { id: 'item_shoes', category: 'shoes', subcategory: 'sneakers', colors: JSON.stringify(['black']), pattern: 'solid', material: 'leather', sleeveLength: null, fit: 'regular', style: 'casual', season: JSON.stringify(['spring', 'autumn']), gender: 'male', formality: 'casual', images: [] },
]

let lines: string[] = []
beforeEach(() => {
  vi.clearAllMocks()
  lines = []
  const push = (chunk: unknown) => {
    lines.push(String(chunk))
    return true
  }
  vi.spyOn(process.stdout, 'write').mockImplementation(push as never)
  vi.spyOn(process.stderr, 'write').mockImplementation(push as never)
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
  db.outfitFeedback.findMany.mockResolvedValue([])
  db.outfitItem.findMany.mockResolvedValue([])
})
afterEach(() => {
  vi.restoreAllMocks()
  setLLMProviderForTesting(null)
})

const aiLines = () => lines.filter((l) => l.includes('"msg":"ai.call"')).map((l) => JSON.parse(l))
const failing = (kind: 'unavailable' | 'auth') =>
  new MockProvider({
    respond: () => {
      throw new AiProviderError(kind, 'mock')
    },
  })

describe('VisionService and ColorService keep the deterministic results', () => {
  it('wardrobe analysis returns exactly the mock vision detection (mock: true) and is measured', async () => {
    const buffer = await sharp({ create: { width: 400, height: 500, channels: 3, background: '#f5f5f5' } }).jpeg().toBuffer()
    const input = { buffer, filename: 'oq-futbolka.jpg' }
    const at = new Date('2026-10-08T10:00:00Z')
    const analysis = await analyzeGarment({ ...input, userId: 'u1' }, () => at)
    expect(analysis.detection).toEqual(await analyzeClothing(input))
    expect(analysis.detection.mock).toBe(true)
    expect(analysis.metadata).toEqual({ provider: 'mock', model: 'mock-vision', version: 'mock', analyzedAt: at, rawConfidences: null })
    expect(aiLines()[0]).toMatchObject({ feature: 'clothing_analysis', provider: 'mock', model: 'mock-vision', outcome: 'ok' })
    expect(lines.join('\n')).not.toContain('futbolka')
  })

  it('colour analysis returns exactly the deterministic result and is measured', async () => {
    const buffer = await selfie()
    expect(await analyzeColorSelfie({ buffer })).toEqual(await analyzeSelfie({ buffer }))
    expect(aiLines()[0]).toMatchObject({ feature: 'color_analysis', provider: 'deterministic', model: 'color-analysis-v2', outcome: 'ok' })
  })

  it('a photo the colour analysis refuses (Phase 4.3: a flat image) is recorded as invalid_request, not as an error', async () => {
    const flat = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#E0AC69' } }).jpeg().toBuffer()
    await expect(analyzeColorSelfie({ buffer: flat })).rejects.toThrow('photo quality')
    expect(aiLines()[0]).toMatchObject({ feature: 'color_analysis', outcome: 'invalid_request' })
  })

  it('analysis failures are recorded and rethrown unchanged', async () => {
    await expect(analyzeGarment({ buffer: Buffer.from('not an image'), filename: 'x.jpg', userId: 'u1' })).rejects.toThrow()
    expect(aiLines()[0]).toMatchObject({ feature: 'clothing_analysis', outcome: 'error' })
  })
})
