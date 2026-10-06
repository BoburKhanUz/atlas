/**
 * Phase 4.4: POST /api/v1/outfits/generate — deterministic engine + optional
 * AI reranking/explanation through opaque references (O1…On), strict
 * validation with one correction, a dedicated daily quota and a deterministic
 * fallback that never fails the request. No ids or content reach the model
 * beyond item attributes, and no content reaches the logs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  wardrobeItem: { findMany: vi.fn() },
  user: { findUnique: vi.fn() },
  outfitFeedback: { findMany: vi.fn() },
  outfitItem: { findMany: vi.fn() },
}))
vi.mock('@/lib/db', () => ({ db }))
const quota = vi.hoisted(() => ({ consumeAiQuota: vi.fn(), refundAiQuota: vi.fn() }))
vi.mock('@/lib/ai/quota', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/ai/quota')>()), ...quota }))

import { POST } from '@/app/api/v1/outfits/generate/route'
import { setLLMProviderForTesting } from '@/lib/ai/providers'
import { AiProviderError } from '@/lib/ai/providers/errors'
import { MockProvider } from '@/lib/ai/providers/mock'
import type { LLMProvider, LLMRequest } from '@/lib/ai/providers/types'
import { AI_DAILY_LIMITS } from '@/lib/ai/quota'
import { interpretOutfitOutput, InvalidOutfitOutputError, outfitJsonSchema, OUTFIT_SYSTEM_PROMPT } from '@/lib/ai/outfit-intelligence'
import { OutfitGenerateResponse } from '@/server/schemas/responses'
import { authHeader, jsonRequest, TEST_USER } from '../helpers'

type Step = (req: LLMRequest) => string | Promise<string>
class ScriptedLLM implements LLMProvider {
  readonly name = 'gemini'
  readonly model = 'gemini-test'
  requests: LLMRequest[] = []
  constructor(private readonly steps: Step[]) {}
  async generate(req: LLMRequest) {
    const step = this.steps[Math.min(this.requests.length, this.steps.length - 1)]
    this.requests.push(req)
    return { text: await step(req), metadata: { provider: this.name, model: this.model, usage: { inputTokens: 10, outputTokens: 5 } } }
  }
}
const ranked = (ranking: string[], explanation = 'Bu obraz bugungi salqin havoga mos va ranglari uyg‘un.', selected = ranking[0]): Step => () =>
  JSON.stringify({ selectedCandidate: selected, ranking, explanation, needsMoreInfo: false })
const failWith = (kind: ConstructorParameters<typeof AiProviderError>[0]): Step => () => {
  throw new AiProviderError(kind, 'gemini')
}

const SECRET = 'PRIVATE-NOTE-5512'
const row = (id: string, category: string, subcategory: string, colors: string[], extra: Record<string, unknown> = {}) => ({
  id,
  category,
  subcategory,
  colors: JSON.stringify(colors),
  pattern: 'solid',
  material: 'cotton',
  sleeveLength: category === 'shirt' ? 'long' : null,
  fit: 'regular',
  style: 'smart_casual',
  season: '[]',
  gender: 'male',
  formality: 'smart_casual',
  notes: SECRET,
  brand: SECRET,
  images: [],
  ...extra,
})
const rows = [
  row('item_shirt_a', 'shirt', 'oxford_shirt', ['white']),
  row('item_shirt_b', 'shirt', 'tshirt', ['navy'], { style: 'casual', formality: 'casual', sleeveLength: 'short' }),
  row('item_pants_a', 'pants', 'chinos', ['beige']),
  row('item_pants_b', 'pants', 'jeans', ['blue'], { style: 'casual', formality: 'casual' }),
  row('item_shoes_a', 'shoes', 'loafers', ['brown']),
  row('item_shoes_b', 'shoes', 'sneakers', ['white'], { style: 'casual', formality: 'casual' }),
  row('item_coat', 'outerwear', 'coat', ['gray'], { material: 'wool' }),
]
const mild = { temperature: 15, feelsLike: 14, condition: 'cloudy', precipitationProbability: 10, humidity: 50, windSpeed: 6, uvIndex: 2 }

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
  db.outfitFeedback.findMany.mockResolvedValue([])
  db.outfitItem.findMany.mockResolvedValue([])
  quota.consumeAiQuota.mockResolvedValue({ allowed: true, used: 1, limit: 30 })
  quota.refundAiQuota.mockResolvedValue(undefined)
})
afterEach(() => {
  vi.restoreAllMocks()
  setLLMProviderForTesting(null)
})

const use = <T extends LLMProvider>(p: T) => {
  setLLMProviderForTesting(p)
  return p
}
async function generate(body: Record<string, unknown> = { occasion: 'casual', weather: mild }) {
  const res = await POST(jsonRequest('/api/v1/outfits/generate', body, await authHeader()), undefined)
  expect(res.status).toBe(200)
  const json = await res.json()
  expect(OutfitGenerateResponse.safeParse(json).success).toBe(true)
  return json
}
const contextOf = (req: LLMRequest) => JSON.parse(req.messages[1].content.slice(req.messages[1].content.indexOf('\n') + 1))
const keys = (body: { outfits: Array<{ tempId: string }> }) => body.outfits.map((o) => o.tempId)

describe('deterministic path (mock provider)', () => {
  it('returns engine outfits, readable labels, layering roles, explanations, fallback: true, no quota', async () => {
    use(new MockProvider())
    const body = await generate()
    expect(body.fallback).toBe(true)
    expect(body.outfits.length).toBeGreaterThan(0)
    for (const o of body.outfits) {
      expect(o.reasonLabels).toHaveLength(o.reasons.length)
      expect(o.explanation).toMatch(/\S/)
      expect(o.explanation).not.toMatch(/item_|O\d/)
      expect(o.items.map((i: { layeringRole: string }) => i.layeringRole)).toContain('footwear')
      expect(o.items.find((i: { layeringRole: string }) => i.layeringRole === 'footwear').role).toBe('shoes')
    }
    expect(quota.consumeAiQuota).not.toHaveBeenCalled()
  })

  it('same request → same response; a seed gives another deterministic option', async () => {
    use(new MockProvider())
    const a = await generate({ occasion: 'casual', weather: mild, topN: 1 })
    const b = await generate({ occasion: 'casual', weather: mild, topN: 1 })
    expect(b).toEqual(a)
    const seeded = await Promise.all([1, 2, 3, 4, 5, 6].map((seed) => generate({ occasion: 'casual', weather: mild, topN: 1, seed })))
    expect(new Set(seeded.map((s) => keys(s)[0])).size).toBeGreaterThan(1)
    expect(await generate({ occasion: 'casual', weather: mild, topN: 1, seed: 4 })).toEqual(seeded[3])
  })

  it('insufficient wardrobe → empty list with a reason, still 200 and fallback', async () => {
    use(new MockProvider())
    db.wardrobeItem.findMany.mockResolvedValue(rows.filter((r) => r.category !== 'shoes'))
    const body = await generate()
    expect(body.outfits).toEqual([])
    expect(body.fallback).toBe(true)
    expect(body.message).toMatch(/oyoq kiyim/)
    db.wardrobeItem.findMany.mockResolvedValue([])
    expect((await generate()).message).toMatch(/bo‘sh/)
  })

  it('the wardrobe is read in a fixed order (database order never matters)', async () => {
    use(new MockProvider())
    await generate()
    expect(db.wardrobeItem.findMany.mock.calls[0][0].orderBy).toEqual({ id: 'asc' })
    const a = await generate()
    db.wardrobeItem.findMany.mockResolvedValue([...rows].reverse())
    expect(await generate()).toEqual(a)
  })
})

describe('AI reranking', () => {
  it('valid output: AI order, AI explanation on the selected outfit, quota charged once, fallback: false', async () => {
    const p = use(new ScriptedLLM([ranked(['O3', 'O1', 'O2'])]))
    use(new MockProvider())
    const base = await generate()
    use(p)
    const body = await generate()
    expect(body.fallback).toBe(false)
    expect(keys(body)).toEqual([keys(base)[2], keys(base)[0], keys(base)[1]])
    expect(body.outfits[0].explanation).toBe('Bu obraz bugungi salqin havoga mos va ranglari uyg‘un.')
    expect(body.outfits[1].explanation).toBe(base.outfits[0].explanation) // others: deterministic
    expect(quota.consumeAiQuota).toHaveBeenCalledTimes(1)
    expect(quota.consumeAiQuota.mock.calls[0].slice(0, 2)).toEqual([TEST_USER.sub, 'outfit_explanation'])
    expect(quota.refundAiQuota).not.toHaveBeenCalled()
    expect(p.requests).toHaveLength(1)
    expect(p.requests[0].jsonSchema?.schema).toEqual(outfitJsonSchema(['O1', 'O2', 'O3']))
    expect(p.requests[0].messages[0].content).toBe(OUTFIT_SYSTEM_PROMPT)
  })

  it('the model sees attributes and opaque references only: no ids, notes, brands or images', async () => {
    const p = use(new ScriptedLLM([ranked(['O1', 'O2', 'O3'])]))
    await generate()
    const all = JSON.stringify(p.requests[0].messages)
    expect(all).not.toMatch(/item_|o_[0-9a-f]{6}|imageUrl|https?:/)
    expect(all).not.toContain(SECRET)
    expect(all).not.toContain(TEST_USER.sub)
    const ctx = contextOf(p.requests[0])
    expect(ctx.candidates.map((c: { ref: string }) => c.ref)).toEqual(['O1', 'O2', 'O3'])
    expect(Object.keys(ctx.candidates[0].items[0]).sort()).toEqual(['category', 'colors', 'formality', 'material', 'pattern', 'sleeveLength', 'slot', 'style', 'subcategory'])
    expect(ctx.weather).toMatchObject({ available: true, band: 'mild' })
  })

  it('invalid output then a valid correction: one retry, the corrected order is used', async () => {
    const p = use(new ScriptedLLM([ranked(['O9', 'O1', 'O2']), ranked(['O2', 'O1', 'O3'])]))
    const body = await generate()
    expect(p.requests).toHaveLength(2)
    expect(p.requests[1].messages.at(-1)!.content).toMatch(/unknown_selected/)
    expect(body.fallback).toBe(false)
    expect(quota.consumeAiQuota).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['malformed JSON', () => 'not json {'],
    ['unknown candidate', ranked(['O1', 'O2', 'O7'])],
    ['duplicate ranking', ranked(['O1', 'O1', 'O2'])],
    ['incomplete ranking', ranked(['O1', 'O2'])],
    ['selected is not first', ranked(['O1', 'O2', 'O3'], 'Yaxshi obraz.', 'O2')],
    ['reference in explanation', ranked(['O1', 'O2', 'O3'], 'O1 eng yaxshisi.')],
    ['extra field', () => JSON.stringify({ selectedCandidate: 'O1', ranking: ['O1', 'O2', 'O3'], explanation: 'x', needsMoreInfo: false, items: ['new'] })],
  ] as Array<[string, Step]>)('%s twice → deterministic fallback, quota refunded, still 200', async (_n, step) => {
    use(new MockProvider())
    const base = await generate()
    const p = use(new ScriptedLLM([step]))
    const body = await generate()
    expect(p.requests).toHaveLength(2)
    expect(body.fallback).toBe(true)
    expect(body).toEqual(base)
    expect(quota.refundAiQuota).toHaveBeenCalledWith(TEST_USER.sub, 'outfit_explanation', quota.consumeAiQuota.mock.calls[0][2])
  })

  it.each(['unavailable', 'timeout', 'rate_limited', 'auth'] as const)('provider failure (%s) → deterministic fallback, refunded, no correction call', async (kind) => {
    const p = use(new ScriptedLLM([failWith(kind)]))
    const body = await generate()
    expect(body.fallback).toBe(true)
    expect(body.outfits.length).toBeGreaterThan(0)
    expect(p.requests.length).toBeLessThanOrEqual(2) // the AI layer itself retries at most once
    expect(quota.refundAiQuota).toHaveBeenCalledTimes(1)
  })

  it('daily quota reached → no model call, deterministic fallback, never 429', async () => {
    quota.consumeAiQuota.mockResolvedValue({ allowed: false, used: 30, limit: 30 })
    const p = use(new ScriptedLLM([ranked(['O1', 'O2', 'O3'])]))
    const body = await generate()
    expect(body.fallback).toBe(true)
    expect(body.outfits.length).toBeGreaterThan(0)
    expect(p.requests).toHaveLength(0)
    expect(quota.refundAiQuota).not.toHaveBeenCalled()
  })

  it('quota store failure → deterministic fallback, no model call', async () => {
    quota.consumeAiQuota.mockRejectedValue(new Error('db down'))
    const p = use(new ScriptedLLM([ranked(['O1', 'O2', 'O3'])]))
    expect((await generate()).fallback).toBe(true)
    expect(p.requests).toHaveLength(0)
  })

  it('logs are content-free: no explanation, prompt, ids or wardrobe data', async () => {
    use(new ScriptedLLM([ranked(['O1', 'O2', 'O3'], 'MAXFIY-IZOH matni.')]))
    await generate()
    use(new ScriptedLLM([() => 'garbage MAXFIY-JAVOB']))
    await generate()
    const out = lines.join('\n')
    expect(out).toContain('ai.outfit.fallback')
    for (const s of ['MAXFIY', SECRET, 'item_', 'oxford', 'You are ATLAS', TEST_USER.sub]) expect(out).not.toContain(s)
  })

  it('the outfit_explanation limit is dedicated and conservative', () => {
    expect(AI_DAILY_LIMITS.outfit_explanation).toBe(30)
  })
})

describe('interpretOutfitOutput', () => {
  const refs = ['O1', 'O2']
  const ok = (o: Record<string, unknown>) => JSON.stringify({ selectedCandidate: 'O1', ranking: ['O1', 'O2'], explanation: 'Yaxshi.', needsMoreInfo: false, ...o })
  it('accepts a valid answer and trims the explanation', () => {
    expect(interpretOutfitOutput(ok({ explanation: '  Yaxshi.  ' }), refs)).toEqual({ ranking: ['O1', 'O2'], explanation: 'Yaxshi.' })
  })
  it.each([
    ['not_json', 'nope'],
    ['schema', ok({ explanation: '' })],
    ['schema', ok({ explanation: 'x'.repeat(601) })],
    ['schema', ok({ needsMoreInfo: 'no' })],
    ['unknown_selected', ok({ selectedCandidate: 'O3' })],
    ['unknown_ranked', ok({ ranking: ['O1', 'X'] })],
    ['duplicate_ranked', ok({ ranking: ['O1', 'O1'] })],
    ['incomplete_ranking', ok({ ranking: ['O1'] })],
    ['selected_not_first', ok({ ranking: ['O2', 'O1'] })],
    ['reference_in_explanation', ok({ explanation: 'W2 bilan kiying.' })],
    ['reference_in_explanation', ok({ explanation: 'o_0123abcdef ni oling.' })],
  ])('rejects %s', (reason, text) => {
    try {
      interpretOutfitOutput(text, refs)
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidOutfitOutputError)
      expect((err as InvalidOutfitOutputError).reason).toBe(reason)
    }
  })
})
