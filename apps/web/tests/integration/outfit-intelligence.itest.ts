/**
 * OUT: outfit generation and saving end to end against real PostgreSQL and
 * the AiUsage quota, with a scripted provider (no network, no paid API):
 * deterministic results, the dedicated outfit_explanation quota (charged only
 * for a real provider, refunded on failure, fallback — never 429 — when
 * exhausted), composition validation and ownership when saving.
 */
import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it } from 'vitest'
import { POST as generate } from '@/app/api/v1/outfits/generate/route'
import { POST as save } from '@/app/api/v1/outfits/route'
import { signAccessToken } from '@/lib/auth'
import { db } from '@/lib/db'
import { setLLMProviderForTesting } from '@/lib/ai/providers'
import { AiProviderError } from '@/lib/ai/providers/errors'
import { MockProvider } from '@/lib/ai/providers/mock'
import type { LLMProvider, LLMRequest } from '@/lib/ai/providers/types'
import { AI_DAILY_LIMITS, consumeAiQuota, getAiUsage } from '@/lib/ai/quota'
import { APP_DB, enabled, sql } from './pg'

let seq = 0
async function newUser() {
  const id = `ou_${process.pid}_${++seq}`
  sql(APP_DB, `INSERT INTO "User" ("id","email","passwordHash","updatedAt") VALUES ('${id}','${id}@test.local','x', now())`)
  sql(APP_DB, `INSERT INTO "WardrobeItem" ("id","userId","category","subcategory","colors","season","style","formality","sleeveLength","updatedAt") VALUES
    ('${id}_t1','${id}','shirt','oxford_shirt','["white"]','[]','smart_casual','smart_casual','long', now()),
    ('${id}_t2','${id}','shirt','tshirt','["navy"]','["summer"]','casual','casual','short', now()),
    ('${id}_b1','${id}','pants','chinos','["beige"]','[]','smart_casual','smart_casual',NULL, now()),
    ('${id}_b2','${id}','pants','jeans','["blue"]','[]','casual','casual',NULL, now()),
    ('${id}_f1','${id}','shoes','loafers','["brown"]','[]','smart_casual','smart_casual',NULL, now()),
    ('${id}_f2','${id}','shoes','sneakers','["white"]','[]','casual','casual',NULL, now()),
    ('${id}_d1','${id}','dress','midi_dress','["burgundy"]','[]','smart_casual','smart_casual',NULL, now()),
    ('${id}_o1','${id}','outerwear','coat','["gray"]','["winter"]','smart_casual','smart_casual',NULL, now())`)
  return { id, auth: { authorization: `Bearer ${await signAccessToken({ sub: id, email: `${id}@test.local` })}` } }
}

function post(handler: typeof generate, url: string, body: unknown, headers: Record<string, string>) {
  const raw = JSON.stringify(body)
  return handler(
    new NextRequest(`http://localhost${url}`, {
      method: 'POST',
      headers: { host: 'localhost', 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(raw)), ...headers },
      body: raw,
    }),
    undefined,
  )
}

class Scripted implements LLMProvider {
  readonly name = 'openai'
  readonly model = 'openai-test-llm'
  calls = 0
  constructor(private readonly step: (req: LLMRequest) => string | Promise<string>) {}
  async generate(req: LLMRequest) {
    this.calls++
    return { text: await this.step(req), metadata: { provider: this.name, model: this.model, usage: {} } }
  }
}
const reversed = (req: LLMRequest) => {
  const refs = (req.jsonSchema!.schema as { properties: { ranking: { items: { enum: string[] } } } }).properties.ranking.items.enum
  const ranking = [...refs].reverse()
  return JSON.stringify({ selectedCandidate: ranking[0], ranking, explanation: 'Bu obraz bugungi havoga mos.', needsMoreInfo: false })
}
const cold = { temperature: 2, feelsLike: 0, condition: 'cloudy', precipitationProbability: 10, humidity: 60, windSpeed: 8, uvIndex: 1 }
const usage = (userId: string) => getAiUsage(userId, 'outfit_explanation')
const gen = async (u: { auth: Record<string, string> }, body: Record<string, unknown> = { occasion: 'casual', weather: cold }) => {
  const res = await post(generate, '/api/v1/outfits/generate', body, u.auth)
  expect(res.status).toBe(200)
  return res.json()
}

describe.skipIf(!enabled)('OUT: outfit intelligence (real PostgreSQL + quota)', () => {
  afterEach(() => setLLMProviderForTesting(null))

  it('OUT-01: mock provider → deterministic, weather-aware outfits; same request, same result; no quota used', async () => {
    const u = await newUser()
    setLLMProviderForTesting(new MockProvider())
    const a = await gen(u)
    expect(a.fallback).toBe(true)
    expect(a.outfits.length).toBeGreaterThan(0)
    for (const o of a.outfits) {
      const roles = o.items.map((i: { layeringRole: string }) => i.layeringRole)
      expect(roles).toContain('footwear')
      if (roles.includes('dress') || o.items.some((i: { subcategory: string }) => i.subcategory === 'tshirt')) expect(roles).toContain('outerwear')
    }
    expect(await gen(u)).toEqual(a)
    expect(await usage(u.id)).toBe(0)
  })

  it('OUT-02: a real provider reorders, explains and is charged once', async () => {
    const u = await newUser()
    setLLMProviderForTesting(new MockProvider())
    const base = await gen(u)
    const p = new Scripted(reversed)
    setLLMProviderForTesting(p)
    const body = await gen(u)
    expect(body.fallback).toBe(false)
    expect(body.outfits.map((o: { tempId: string }) => o.tempId)).toEqual(base.outfits.map((o: { tempId: string }) => o.tempId).reverse())
    expect(body.outfits[0].explanation).toBe('Bu obraz bugungi havoga mos.')
    expect(p.calls).toBe(1)
    expect(await usage(u.id)).toBe(1)
  })

  it('OUT-03: provider failure → deterministic fallback and the charge is refunded', async () => {
    const u = await newUser()
    setLLMProviderForTesting(
      new Scripted(() => {
        throw new AiProviderError('unavailable', 'openai')
      }),
    )
    const body = await gen(u)
    expect(body.fallback).toBe(true)
    expect(body.outfits.length).toBeGreaterThan(0)
    expect(await usage(u.id)).toBe(0)
  })

  it('OUT-04: the daily limit reached → fallback (never 429), no model call, usage stays at the limit', async () => {
    const u = await newUser()
    const limit = AI_DAILY_LIMITS.outfit_explanation
    for (let i = 0; i < limit; i++) await consumeAiQuota(u.id, 'outfit_explanation')
    const p = new Scripted(reversed)
    setLLMProviderForTesting(p)
    const body = await gen(u)
    expect(body.fallback).toBe(true)
    expect(p.calls).toBe(0)
    expect(await usage(u.id)).toBe(limit)
  })

  it('OUT-05: a generated outfit saves as returned (score and labels unchanged); invalid compositions and foreign items are refused', async () => {
    const u = await newUser()
    const other = await newUser()
    setLLMProviderForTesting(new MockProvider())
    const [o] = (await gen(u)).outfits
    const items = o.items.map((i: { id: string; role: string }) => ({ itemId: i.id, role: i.role }))
    const res = await post(save, '/api/v1/outfits', { occasion: 'casual', score: o.score, reasons: o.reasonLabels, explanation: o.explanation, isSaved: true, items }, u.auth)
    expect(res.status).toBe(201)
    const id = (await res.json()).outfit.id
    const stored = await db.outfit.findUniqueOrThrow({ where: { id }, include: { items: true } })
    expect(stored.score).toBe(o.score)
    expect(JSON.parse(stored.reasonsJson)).toEqual(o.reasonLabels)
    expect(stored.items.map((i) => i.wardrobeItemId).sort()).toEqual(items.map((i: { itemId: string }) => i.itemId).sort())

    const bad = async (its: Array<{ itemId: string; role: string }>, who = u) => (await post(save, '/api/v1/outfits', { items: its }, who.auth)).status
    expect(await bad([{ itemId: `${u.id}_t1`, role: 'top' }, { itemId: `${u.id}_b1`, role: 'bottom' }])).toBe(400) // no footwear
    expect(await bad([{ itemId: `${u.id}_d1`, role: 'dress' }, { itemId: `${u.id}_b1`, role: 'bottom' }, { itemId: `${u.id}_f1`, role: 'shoes' }])).toBe(400)
    expect(await bad([{ itemId: `${u.id}_t1`, role: 'top' }, { itemId: `${u.id}_b1`, role: 'bottom' }, { itemId: `${u.id}_f1`, role: 'top' }])).toBe(400)
    expect(await bad(items, other)).toBe(403)
    expect(await db.outfit.count({ where: { userId: { in: [u.id, other.id] } } })).toBe(1)
  })

  it('OUT-06: a rejected outfit is not offered first again', async () => {
    const u = await newUser()
    setLLMProviderForTesting(new MockProvider())
    const [first] = (await gen(u)).outfits
    const res = await post(save, '/api/v1/outfits', { items: first.items.map((i: { id: string; role: string }) => ({ itemId: i.id, role: i.role })) }, u.auth)
    const outfitId = (await res.json()).outfit.id
    await db.outfitFeedback.create({ data: { userId: u.id, outfitId, feedback: 'rejected' } })
    const [next] = (await gen(u)).outfits
    expect(next.tempId).not.toBe(first.tempId)
  })
})
