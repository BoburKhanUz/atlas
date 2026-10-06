/**
 * Phase 4.5: the provider failure matrix, end to end through the REAL Gemini
 * and OpenAI adapters (scripted HTTP, no network) into each feature's policy:
 *
 *   stylist  → typed AI_UNAVAILABLE (StylistError), quota refunded
 *   outfit   → deterministic fallback (never an error), quota refunded
 *   vision   → typed AI_UNAVAILABLE (GarmentAnalysisError), quota refunded
 *
 * Retries: at most one, only for timeout / network / 429 / transient 5xx
 * (client.ts). Invalid structured output: the stylist and vision never retry
 * a schema violation; the outfit AI makes one correction, then falls back.
 * Quota exhausted: no provider call. A missing production key fails closed
 * at configuration time (no silent mock).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'

const db = vi.hoisted(() => ({}))
vi.mock('@/lib/db', () => ({ db }))
const quota = vi.hoisted(() => ({ consumeAiQuota: vi.fn(), refundAiQuota: vi.fn() }))
vi.mock('@/lib/ai/quota', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/ai/quota')>()), ...quota }))

import { parseAiConfig, resetAiConfigForTesting } from '@/lib/ai/config'
import { generateOutfitResult } from '@/lib/ai/outfit-engine'
import { rerankAndExplain } from '@/lib/ai/outfit-intelligence'
import { setLLMProviderForTesting, setVisionProviderForTesting } from '@/lib/ai/providers'
import { GeminiProvider } from '@/lib/ai/providers/gemini'
import { OpenAIProvider } from '@/lib/ai/providers/openai'
import { buildStylistContext, type WardrobeRow } from '@/lib/ai/stylist-context'
import { runStylistTurn, StylistError } from '@/lib/ai/stylist-service'
import { analyzeGarment, GarmentAnalysisError } from '@/lib/ai/vision-service'
import { fakeFetch, type Reply } from '../unit/ai/fake-fetch'

const KEY = 'test-key-not-real-0123456789'
type Name = 'gemini' | 'openai'

/** A provider 2xx envelope around `text` (the model's output). */
const ok = (provider: Name, text: string): Reply =>
  provider === 'gemini'
    ? { status: 200, json: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } } }
    : { status: 200, json: { choices: [{ finish_reason: 'stop', message: { content: text } }], usage: { prompt_tokens: 10, completion_tokens: 5 } } }

/** Failure → the HTTP behaviour, and how many attempts one provider call makes. */
const FAILURES: Array<{ name: string; reply: (p: Name) => Reply; attempts: number }> = [
  { name: 'timeout', reply: () => ({ hang: true }), attempts: 2 },
  { name: 'network error', reply: () => ({ throw: new TypeError('fetch failed') }), attempts: 2 },
  { name: '429 (no Retry-After)', reply: () => ({ status: 429 }), attempts: 2 },
  { name: '429 (Retry-After 30 s)', reply: () => ({ status: 429, headers: { 'retry-after': '30' } }), attempts: 1 },
  { name: '503', reply: () => ({ status: 503 }), attempts: 2 },
  { name: '500', reply: () => ({ status: 500 }), attempts: 2 },
  { name: '401 (bad key)', reply: () => ({ status: 401 }), attempts: 1 },
  { name: '400 (invalid model / request)', reply: () => ({ status: 400 }), attempts: 1 },
  { name: 'malformed body (not JSON)', reply: () => ({ status: 200, text: '<html>oops' }), attempts: 1 },
  { name: 'empty output', reply: (p) => ok(p, ''), attempts: 1 },
]

const adapter = (p: Name, replies: Reply[]) => {
  const f = fakeFetch(replies)
  const provider = p === 'gemini' ? new GeminiProvider({ apiKey: KEY, model: 'm-test', fetch: f.fetch }) : new OpenAIProvider({ apiKey: KEY, model: 'm-test', fetch: f.fetch })
  return { provider, calls: f.calls }
}

const row = (id: string, category: string, subcategory: string, colors: string[]): WardrobeRow => ({
  id, category, subcategory, colors, pattern: 'solid', material: 'cotton', sleeveLength: category === 'shirt' ? 'long' : null,
  fit: 'regular', style: 'smart_casual', season: [], gender: 'male', formality: 'smart_casual', createdAt: new Date('2026-01-01'),
})
const wardrobe = [row('a1', 'shirt', 'oxford_shirt', ['white']), row('a2', 'shirt', 'polo', ['navy']), row('b1', 'pants', 'chinos', ['beige']), row('b2', 'pants', 'jeans', ['blue']), row('f1', 'shoes', 'loafers', ['brown']), row('f2', 'shoes', 'sneakers', ['white'])]
const candidates = () => generateOutfitResult({ wardrobe, occasion: 'casual', weather: { temperature: 16, feelsLike: 16, condition: 'cloudy', precipitationProbability: 0, humidity: 50, windSpeed: 5, uvIndex: 2 } }).outfits

const stylist = () =>
  runStylistTurn({ userId: 'u1', message: 'Bugun nima kiyay?', occasionText: null, context: buildStylistContext({ items: wardrobe, candidates: candidates() }), history: [] })
const outfit = () => rerankAndExplain({ userId: 'u1', candidates: candidates(), weather: null, colorProfile: null, occasion: 'casual' })
let image: Buffer
const vision = () => analyzeGarment({ buffer: image, filename: 'x.jpg', userId: 'u1' })

beforeAll(async () => {
  // Short timeouts so the timeout rows run quickly (validated bounds: ≥ 1000 ms).
  process.env.AI_LLM_TIMEOUT_MS = '1000'
  process.env.AI_VISION_TIMEOUT_MS = '1000'
  resetAiConfigForTesting()
  image = await sharp({ create: { width: 400, height: 500, channels: 3, background: '#2F5DA8' } }).jpeg().toBuffer()
})
afterAll(() => {
  delete process.env.AI_LLM_TIMEOUT_MS
  delete process.env.AI_VISION_TIMEOUT_MS
  resetAiConfigForTesting()
})
beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as never)
  vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as never)
  quota.consumeAiQuota.mockResolvedValue({ allowed: true, used: 1, limit: 30 })
  quota.refundAiQuota.mockResolvedValue(undefined)
})
afterEach(() => {
  vi.restoreAllMocks()
  setLLMProviderForTesting(null)
  setVisionProviderForTesting(null)
})

describe.each(['gemini', 'openai'] as const)('%s adapter', (p) => {
  describe.each(FAILURES)('$name', ({ reply, attempts }) => {
    it('stylist → AI_UNAVAILABLE after the expected attempts, refunded', async () => {
      const { provider, calls } = adapter(p, [reply(p)])
      setLLMProviderForTesting(provider)
      const err = await stylist().then(() => null, (e) => e)
      expect(err).toBeInstanceOf(StylistError)
      expect(err.failure).toEqual({ kind: 'ai_unavailable' })
      expect(calls).toHaveLength(attempts)
      expect(quota.refundAiQuota).toHaveBeenCalledTimes(1)
    })

    it('outfit AI → deterministic fallback (never an error), refunded', async () => {
      const { provider, calls } = adapter(p, [reply(p)])
      setLLMProviderForTesting(provider)
      const r = await outfit()
      expect(r.fallback).toBe(true)
      expect(r.outfits.map((o) => o.candidate.tempId)).toEqual(candidates().map((c) => c.tempId))
      expect(calls).toHaveLength(attempts)
      expect(quota.refundAiQuota).toHaveBeenCalledTimes(1)
    })

    it('vision → AI_UNAVAILABLE after the expected attempts, refunded', async () => {
      const { provider, calls } = adapter(p, [reply(p)])
      setVisionProviderForTesting(provider)
      const err = await vision().then(() => null, (e) => e)
      expect(err).toBeInstanceOf(GarmentAnalysisError)
      expect(err.failure).toEqual({ kind: 'ai_unavailable' })
      expect(calls).toHaveLength(attempts)
      expect(quota.refundAiQuota).toHaveBeenCalledTimes(1)
    })
  })

  it('a transient failure then success: one retry, the feature succeeds, no refund', async () => {
    const answer = JSON.stringify({ answer: 'Oq ko‘ylak kiying.', referencedItems: [], needsMoreInfo: false })
    const { provider, calls } = adapter(p, [{ status: 503 }, ok(p, answer)])
    setLLMProviderForTesting(provider)
    expect((await stylist()).text).toBe('Oq ko‘ylak kiying.')
    expect(calls).toHaveLength(2)
    expect(quota.refundAiQuota).not.toHaveBeenCalled()
  })

  it('invalid structured output: stylist and vision refuse without retry; outfit corrects once, then falls back', async () => {
    const bad = ok(p, JSON.stringify({ unexpected: true }))
    let a = adapter(p, [bad])
    setLLMProviderForTesting(a.provider)
    expect((await stylist().then(() => null, (e) => e)).failure).toEqual({ kind: 'ai_unavailable' })
    expect(a.calls).toHaveLength(1)

    a = adapter(p, [bad])
    setLLMProviderForTesting(a.provider)
    expect((await outfit()).fallback).toBe(true)
    expect(a.calls).toHaveLength(2) // the one correction

    a = adapter(p, [bad])
    setVisionProviderForTesting(a.provider)
    expect((await vision().then(() => null, (e) => e)).failure).toEqual({ kind: 'ai_unavailable' })
    expect(a.calls).toHaveLength(1)
    expect(quota.refundAiQuota).toHaveBeenCalledTimes(3)
  })

  it('correction failure: still ungrounded after the one correction → stylist AI_UNAVAILABLE, outfit fallback; exactly 2 calls each, refunded', async () => {
    const ungrounded = ok(p, JSON.stringify({ answer: '[W99] kiying.', referencedItems: ['W99'], needsMoreInfo: false }))
    let a = adapter(p, [ungrounded])
    setLLMProviderForTesting(a.provider)
    expect((await stylist().then(() => null, (e) => e)).failure).toEqual({ kind: 'ai_unavailable' })
    expect(a.calls).toHaveLength(2)
    expect(a.calls[1].body).not.toEqual(a.calls[0].body) // the second call carries the correction

    const invented = ok(p, JSON.stringify({ selectedCandidate: 'O9', ranking: ['O9', 'O1', 'O2'], explanation: 'Yaxshi.', needsMoreInfo: false }))
    a = adapter(p, [invented])
    setLLMProviderForTesting(a.provider)
    expect((await outfit()).fallback).toBe(true)
    expect(a.calls).toHaveLength(2)
    expect(quota.refundAiQuota).toHaveBeenCalledTimes(2)
  })

  it('quota exhausted: no provider call (stylist and vision: typed quota error; outfit: fallback)', async () => {
    quota.consumeAiQuota.mockResolvedValue({ allowed: false, used: 50, limit: 50 })
    const a = adapter(p, [ok(p, '{}')])
    setLLMProviderForTesting(a.provider)
    setVisionProviderForTesting(a.provider)
    expect((await stylist().then(() => null, (e) => e)).failure.kind).toBe('quota_exceeded')
    expect((await outfit()).fallback).toBe(true)
    expect((await vision().then(() => null, (e) => e)).failure.kind).toBe('quota_exceeded')
    expect(a.calls).toHaveLength(0)
    expect(quota.refundAiQuota).not.toHaveBeenCalled()
  })
})

describe('configuration (production fails closed, never a silent mock)', () => {
  const prod = (env: Record<string, string>) => () => parseAiConfig({ NODE_ENV: 'production', ...env })
  const real = { AI_LLM_PROVIDER: 'gemini', AI_LLM_MODEL: 'm', GEMINI_API_KEY: KEY, AI_VISION_PROVIDER: 'openai', AI_VISION_MODEL: 'm', OPENAI_API_KEY: KEY }

  it.each([
    ['missing key', { ...real, GEMINI_API_KEY: '' }, /GEMINI_API_KEY must be set/],
    ['missing model', { ...real, AI_VISION_MODEL: '' }, /AI_VISION_MODEL must be set/],
    ['provider not set', { ...real, AI_LLM_PROVIDER: '' }, /AI_LLM_PROVIDER must be set in production/],
    ['unknown provider', { ...real, AI_LLM_PROVIDER: 'other' }, /must be mock, gemini or openai/],
    ['mock selected without acknowledgement', { ...real, AI_VISION_PROVIDER: 'mock' }, /mock AI provider is selected in production/],
    ['malformed model id', { ...real, AI_LLM_MODEL: 'bad model' }, /not a valid model id/],
    ['timeout out of range', { ...real, AI_LLM_TIMEOUT_MS: '90000' }, /between 1000 and 55000/],
  ])('%s → refuses to start', (_n, env, message) => {
    expect(prod(env)).toThrow(message)
    expect(() => prod(env)()).not.toThrow(new RegExp(KEY))
  })

  it('the server refuses to boot: assertServerConfig runs the same AI validation', async () => {
    const { assertServerConfig } = await import('@/lib/config')
    const saved = { ...process.env }
    try {
      Object.assign(process.env, { NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://atlas.example', AI_LLM_PROVIDER: 'mock', AI_VISION_PROVIDER: 'mock' })
      delete process.env.AI_ALLOW_MOCK_IN_PRODUCTION
      expect(() => assertServerConfig()).toThrow(/mock AI provider is selected in production/)
      Object.assign(process.env, { AI_LLM_PROVIDER: 'gemini', AI_LLM_MODEL: 'm' })
      expect(() => assertServerConfig()).toThrow(/GEMINI_API_KEY must be set/)
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]
      Object.assign(process.env, saved)
    }
  })

  it('production + mock is possible only with the explicit acknowledgement, and is then reported (never silent)', () => {
    const c = prod({ ...real, AI_LLM_PROVIDER: 'mock', AI_VISION_PROVIDER: 'mock', AI_ALLOW_MOCK_IN_PRODUCTION: '1' })()
    expect([c.llm.provider, c.vision.provider, c.mockInProduction]).toEqual(['mock', 'mock', true])
    expect(prod({ ...real, AI_VISION_PROVIDER: 'mock', AI_ALLOW_MOCK_IN_PRODUCTION: 'true' })).toThrow(/mock AI provider/) // only "1"
  })

  it('development and test: the mock is the default, with no key needed', () => {
    for (const NODE_ENV of ['development', 'test']) {
      const c = parseAiConfig({ NODE_ENV })
      expect([c.llm.provider, c.vision.provider, c.llm.apiKey, c.mockInProduction]).toEqual(['mock', 'mock', null, false])
    }
    expect(() => parseAiConfig({ NODE_ENV: 'development', AI_LLM_PROVIDER: 'claude' })).toThrow(/must be mock, gemini or openai/)
  })

  it('a complete real configuration starts without any mock', () => {
    const c = prod(real)()
    expect([c.llm.provider, c.vision.provider, c.mockInProduction]).toEqual(['gemini', 'openai', false])
  })
})
