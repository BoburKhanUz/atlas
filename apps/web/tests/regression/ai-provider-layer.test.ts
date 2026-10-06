/**
 * Phase 4.0: the stylist, the outfit explanation and the wardrobe analysis go
 * through the provider-independent AI layer. Their public behaviour (status,
 * response shape, fallback) is unchanged; failures stay soft; no content
 * reaches the logs.
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

import { POST as chatPOST } from '@/app/api/v1/stylist/chat/route'
import { POST as generatePOST } from '@/app/api/v1/outfits/generate/route'
import { setLLMProviderForTesting } from '@/lib/ai/providers'
import { AiProviderError } from '@/lib/ai/providers/errors'
import { MockProvider } from '@/lib/ai/providers/mock'
import { analyzeClothing } from '@/lib/ai/mock-vision'
import { analyzeGarment } from '@/lib/ai/vision-service'
import { analyzeColorSelfie } from '@/lib/ai/color-service'
import { analyzeSelfie } from '@/lib/ai/color-analysis'
import { authHeader, jsonRequest } from '../helpers'

const USER_TEXT = 'Ertaga to‘yga nima kiyay? PRIVATE-USER-TEXT'

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
const assistantRow = () => db.aiMessage.create.mock.calls.map((c) => c[0].data).find((d) => d.role === 'assistant')
const failing = (kind: 'unavailable' | 'auth') =>
  new MockProvider({
    respond: () => {
      throw new AiProviderError(kind, 'mock')
    },
  })

describe('stylist chat through the AI layer', () => {
  const chat = async (body: Record<string, unknown>) => chatPOST(jsonRequest('/api/v1/stylist/chat', body, await authHeader()), undefined)

  it('success: unchanged response shape; the stored message records the real provider', async () => {
    setLLMProviderForTesting(new MockProvider({ respond: () => 'Oq ko‘ylak va to‘q ko‘k shim.' }))
    const res = await chat({ message: USER_TEXT })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Object.keys(body).sort()).toEqual(['assistantMessage', 'contextSummary', 'conversationId'])
    expect(body.assistantMessage).toBe('Oq ko‘ylak va to‘q ko‘k shim.')
    const meta = JSON.parse(assistantRow().metadataJson)
    expect(meta.provider).toBe('mock')
    expect(meta).not.toHaveProperty('fallback')
    expect(aiLines()).toEqual([expect.objectContaining({ feature: 'stylist_chat', provider: 'mock', outcome: 'ok' })])
  })

  it('the provider receives the system prompt, history and the user message, with the stylist limits', async () => {
    const seen: unknown[] = []
    setLLMProviderForTesting(
      new MockProvider({
        respond: (r) => {
          seen.push(r)
          return 'ok'
        },
      }),
    )
    await chat({ message: USER_TEXT })
    expect(seen).toHaveLength(1)
    const r = seen[0] as { messages: Array<{ role: string; content: string }>; temperature: number; maxOutputTokens: number }
    expect(r.messages[0].role).toBe('system')
    expect(r.messages[0].content).toContain('Siz shaxsiy AI stilistsiz')
    expect(r.messages.at(-1)).toEqual({ role: 'user', content: USER_TEXT })
    expect(r.temperature).toBe(0.7)
    expect(r.maxOutputTokens).toBe(600)
  })

  it('provider failure: same soft fallback as before (HTTP 200, fixed text), now marked as a fallback in storage', async () => {
    setLLMProviderForTesting(failing('unavailable'))
    const res = await chat({ message: USER_TEXT })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.assistantMessage).toMatch(/^Kechirasiz, hozir AI stilist javob bera olmaydi/)
    const meta = JSON.parse(assistantRow().metadataJson)
    expect(meta).toMatchObject({ provider: 'none', fallback: true })
    expect(aiLines()[0]).toMatchObject({ feature: 'stylist_chat', outcome: 'unavailable', attempts: 2 })
  })

  it('logs never contain the user message or the prompt', async () => {
    setLLMProviderForTesting(failing('auth'))
    await chat({ message: USER_TEXT })
    const all = lines.join('\n')
    expect(all).not.toContain('PRIVATE-USER-TEXT')
    expect(all).not.toContain('Siz shaxsiy AI stilistsiz')
    expect(all).not.toContain('conv_1')
  })
})

describe('outfit explanation through the AI layer', () => {
  const generate = async () => generatePOST(jsonRequest('/api/v1/outfits/generate', { occasion: 'work', seed: 1 }, await authHeader()), undefined)

  it('the top outfit gets the provider’s explanation; the request uses the explanation limits', async () => {
    const seen: Array<{ temperature?: number; maxOutputTokens?: number; timeoutMs: number }> = []
    setLLMProviderForTesting(
      new MockProvider({
        respond: (r) => {
          seen.push(r)
          return 'Ishga mos, toza obraz.'
        },
      }),
    )
    const res = await generate()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.outfits[0].explanation).toBe('Ishga mos, toza obraz.')
    expect(body.outfits.slice(1).every((o: { explanation: unknown }) => o.explanation === null)).toBe(true)
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ temperature: 0.5, maxOutputTokens: 180, timeoutMs: 15000 })
    expect(aiLines()[0]).toMatchObject({ feature: 'outfit_explanation', outcome: 'ok' })
  })

  it('a failing provider leaves the explanation null and the request succeeds (was a 500 for a bad provider)', async () => {
    setLLMProviderForTesting(failing('auth'))
    const res = await generate()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.outfits.length).toBeGreaterThan(0)
    expect(body.outfits[0].explanation).toBeNull()
  })
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
    const buffer = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#E0AC69' } }).jpeg().toBuffer()
    expect(await analyzeColorSelfie({ buffer })).toEqual(await analyzeSelfie({ buffer }))
    expect(aiLines()[0]).toMatchObject({ feature: 'color_analysis', provider: 'deterministic', outcome: 'ok' })
  })

  it('analysis failures are recorded and rethrown unchanged', async () => {
    await expect(analyzeGarment({ buffer: Buffer.from('not an image'), filename: 'x.jpg', userId: 'u1' })).rejects.toThrow()
    expect(aiLines()[0]).toMatchObject({ feature: 'clothing_analysis', outcome: 'error' })
  })
})
