/**
 * Phase 5.0 rollout through the real routes and services (counting providers,
 * no network): a disabled feature or a user outside the rollout never reaches
 * a provider, is never charged, stores nothing fake, and gets the feature's
 * non-AI path; the allowlist skips only the percentage; nothing identifying
 * reaches telemetry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'

const db = vi.hoisted(() => ({
  wardrobeItem: { findMany: vi.fn() },
  user: { findUnique: vi.fn() },
  aiConversation: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  aiMessage: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
  outfitFeedback: { findMany: vi.fn() },
  outfitItem: { findMany: vi.fn() },
  $transaction: vi.fn(),
}))
vi.mock('@/lib/db', () => ({ db }))
const quota = vi.hoisted(() => ({ consumeAiQuota: vi.fn(), refundAiQuota: vi.fn() }))
vi.mock('@/lib/ai/quota', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/ai/quota')>()), ...quota }))

import { POST as stylistPOST } from '@/app/api/v1/stylist/chat/route'
import { POST as generatePOST } from '@/app/api/v1/outfits/generate/route'
import { resetAiConfigForTesting } from '@/lib/ai/config'
import { setAiMonitoringSinks, logSink, type AiMonitoringEvent } from '@/lib/ai/monitoring'
import { setLLMProviderForTesting, setVisionProviderForTesting } from '@/lib/ai/providers'
import { MockProvider } from '@/lib/ai/providers/mock'
import type { LLMProvider, LLMRequest, VisionProvider, VisionRequest } from '@/lib/ai/providers/types'
import { allowlistDigest, rolloutBucket } from '@/lib/ai/rollout'
import { analyzeGarment } from '@/lib/ai/vision-service'
import { authHeader, jsonRequest, TEST_USER } from '../helpers'

class CountingLLM implements LLMProvider {
  readonly name = 'gemini'
  readonly model = 'gemini-test'
  calls = 0
  async generate(req: LLMRequest) {
    this.calls++
    const refs = (req.jsonSchema!.schema as { properties: Record<string, { items: { enum?: string[] } }> }).properties
    const text = refs.ranking
      ? JSON.stringify({ selectedCandidate: refs.ranking.items.enum![0], ranking: refs.ranking.items.enum, explanation: 'Bu obraz mos.', needsMoreInfo: false })
      : JSON.stringify({ answer: 'Oq ko‘ylak kiying.', referencedItems: [], needsMoreInfo: false })
    return { text, metadata: { provider: this.name, model: this.model, usage: {} } }
  }
}
class CountingVision implements VisionProvider {
  readonly name = 'openai'
  readonly model = 'openai-test-vision'
  calls = 0
  async analyzeImage(_req: VisionRequest) {
    this.calls++
    return { output: {}, metadata: { provider: this.name, model: this.model, usage: {} } }
  }
}

const ROLLOUT_ENV = ['AI_STYLIST_ENABLED', 'AI_VISION_ENABLED', 'AI_OUTFIT_AI_ENABLED', 'AI_ROLLOUT_PERCENT', 'AI_ROLLOUT_ALLOWLIST']
const rollout = (env: Record<string, string>) => {
  for (const k of ROLLOUT_ENV) delete process.env[k]
  Object.assign(process.env, env)
  resetAiConfigForTesting()
}
const ALLOW_TEST_USER = allowlistDigest(TEST_USER.sub)

const row = (id: string, category: string, subcategory: string, colors: string[]) => ({
  id, category, subcategory, colors: JSON.stringify(colors), pattern: 'solid', material: 'cotton', sleeveLength: category === 'shirt' ? 'long' : null,
  fit: 'regular', style: 'smart_casual', season: '[]', gender: 'male', formality: 'smart_casual', createdAt: new Date('2026-01-01'), images: [],
})
const rows = [row('item_a1', 'shirt', 'oxford_shirt', ['white']), row('item_a2', 'shirt', 'polo', ['navy']), row('item_b1', 'pants', 'chinos', ['beige']), row('item_f1', 'shoes', 'loafers', ['brown'])]

let events: AiMonitoringEvent[] = []
let lines: string[] = []
let llm: CountingLLM
let vision: CountingVision
beforeEach(() => {
  vi.clearAllMocks()
  events = []
  lines = []
  setAiMonitoringSinks([{ emit: (e) => events.push(e) }, logSink])
  const push = (chunk: unknown) => {
    lines.push(String(chunk))
    return true
  }
  vi.spyOn(process.stdout, 'write').mockImplementation(push as never)
  vi.spyOn(process.stderr, 'write').mockImplementation(push as never)
  db.wardrobeItem.findMany.mockResolvedValue(rows)
  db.user.findUnique.mockResolvedValue(null)
  db.aiConversation.findFirst.mockResolvedValue(null)
  db.aiConversation.create.mockResolvedValue({ id: 'conv_1' })
  db.aiConversation.update.mockResolvedValue({})
  db.aiMessage.findMany.mockResolvedValue([])
  db.aiMessage.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'msg_1', ...data }))
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db))
  db.outfitFeedback.findMany.mockResolvedValue([])
  db.outfitItem.findMany.mockResolvedValue([])
  quota.consumeAiQuota.mockResolvedValue({ allowed: true, used: 1, limit: 50 })
  quota.refundAiQuota.mockResolvedValue(undefined)
  llm = new CountingLLM()
  vision = new CountingVision()
  setLLMProviderForTesting(llm)
  setVisionProviderForTesting(vision)
})
afterEach(() => {
  vi.restoreAllMocks()
  rollout({})
  setAiMonitoringSinks(null)
  setLLMProviderForTesting(null)
  setVisionProviderForTesting(null)
})

const chat = async () => stylistPOST(jsonRequest('/api/v1/stylist/chat', { message: 'Bugun nima kiyay?' }, await authHeader()), undefined)
const generate = async () => (await generatePOST(jsonRequest('/api/v1/outfits/generate', { occasion: 'casual' }, await authHeader()), undefined)).json()
const image = () => sharp({ create: { width: 400, height: 500, channels: 3, background: '#2F5DA8' } }).jpeg().toBuffer()
const disabled = (feature: string, reason: string) => expect(events.filter((e) => e.event === 'ai.request')).toEqual([expect.objectContaining({ feature, outcome: 'disabled', reason, billable: false })])

describe('stylist', () => {
  it.each([
    ['feature switch off', { AI_STYLIST_ENABLED: 'false' }, 'feature_disabled'],
    ['user outside the rollout (0 %)', { AI_ROLLOUT_PERCENT: '0' }, 'rollout_not_selected'],
  ])('%s → 503 AI_UNAVAILABLE, no provider call, no charge, nothing stored', async (_n, env, reason) => {
    rollout(env)
    const res = await chat()
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('AI_UNAVAILABLE')
    expect(llm.calls).toBe(0)
    expect(quota.consumeAiQuota).not.toHaveBeenCalled()
    expect(db.aiMessage.create).not.toHaveBeenCalled()
    expect(db.aiConversation.create).not.toHaveBeenCalled()
    disabled('stylist_chat', reason)
  })

  it('a disabled feature does not fall back to the mock either (no hidden substitute)', async () => {
    setLLMProviderForTesting(new MockProvider())
    rollout({ AI_STYLIST_ENABLED: 'false' })
    expect((await chat()).status).toBe(503)
    expect(db.aiMessage.create).not.toHaveBeenCalled()
  })

  it('allowlisted at 0 %: answered through the normal path (provider once, charged once)', async () => {
    rollout({ AI_ROLLOUT_PERCENT: '0', AI_ROLLOUT_ALLOWLIST: ALLOW_TEST_USER })
    expect((await chat()).status).toBe(200)
    expect(llm.calls).toBe(1)
    expect(quota.consumeAiQuota).toHaveBeenCalledTimes(1)
  })

  it('allowlisted but the feature is off → still disabled', async () => {
    rollout({ AI_STYLIST_ENABLED: 'false', AI_ROLLOUT_ALLOWLIST: ALLOW_TEST_USER })
    expect((await chat()).status).toBe(503)
    expect(llm.calls).toBe(0)
  })

  it('allowlisted with the quota exhausted → 429 AI_QUOTA_EXCEEDED (the allowlist never bypasses quotas)', async () => {
    rollout({ AI_ROLLOUT_PERCENT: '0', AI_ROLLOUT_ALLOWLIST: ALLOW_TEST_USER })
    quota.consumeAiQuota.mockResolvedValue({ allowed: false, used: 50, limit: 50 })
    const res = await chat()
    expect(res.status).toBe(429)
    expect((await res.json()).code).toBe('AI_QUOTA_EXCEEDED')
    expect(llm.calls).toBe(0)
  })

  it('a user selected by the percentage gets the normal path; the decision is stable', async () => {
    const pct = String(rolloutBucket(TEST_USER.sub) + 1) // just above the test user's bucket
    rollout({ AI_ROLLOUT_PERCENT: pct })
    expect((await chat()).status).toBe(200)
    rollout({ AI_ROLLOUT_PERCENT: String(rolloutBucket(TEST_USER.sub)) }) // the bucket itself is not below the percentage
    expect((await chat()).status).toBe(503)
  })
})

describe('vision', () => {
  it.each([
    ['feature switch off', { AI_VISION_ENABLED: 'false' }, 'feature_disabled'],
    ['user outside the rollout', { AI_ROLLOUT_PERCENT: '0' }, 'rollout_not_selected'],
  ])('%s → the existing deterministic analysis (mock=true), no provider call, no charge', async (_n, env, reason) => {
    rollout(env)
    const r = await analyzeGarment({ buffer: await image(), filename: 'blue-jeans.jpg', userId: TEST_USER.sub })
    expect(r.detection.mock).toBe(true)
    expect(r.metadata.provider).toBe('mock')
    expect(r.detection.category).toBe('pants') // the deterministic analysis, as before Phase 4.1
    expect(vision.calls).toBe(0)
    expect(quota.consumeAiQuota).not.toHaveBeenCalled()
    disabled('clothing_analysis', reason)
  })

  it('allowlisted with the quota exhausted → quota error, no provider call', async () => {
    rollout({ AI_ROLLOUT_PERCENT: '0', AI_ROLLOUT_ALLOWLIST: ALLOW_TEST_USER })
    quota.consumeAiQuota.mockResolvedValue({ allowed: false, used: 50, limit: 50 })
    const err = await analyzeGarment({ buffer: await image(), filename: 'x.jpg', userId: TEST_USER.sub }).then(() => null, (e) => e)
    expect(err.failure.kind).toBe('quota_exceeded')
    expect(vision.calls).toBe(0)
  })
})

describe('outfit AI', () => {
  it.each([
    ['feature switch off', { AI_OUTFIT_AI_ENABLED: 'false' }, 'feature_disabled'],
    ['user outside the rollout', { AI_ROLLOUT_PERCENT: '0' }, 'rollout_not_selected'],
  ])('%s → the deterministic engine result, identical order and scores; no provider call, no charge', async (_n, env, reason) => {
    // Reference: the same request answered by the mock (the deterministic path).
    setLLMProviderForTesting(new MockProvider())
    const reference = await generate()
    setLLMProviderForTesting(llm)
    events = []
    rollout(env)
    const body = await generate()
    expect(body.fallback).toBe(true)
    expect(body.outfits.map((o: { tempId: string; score: number; explanation: string }) => [o.tempId, o.score, o.explanation])).toEqual(
      reference.outfits.map((o: { tempId: string; score: number; explanation: string }) => [o.tempId, o.score, o.explanation]),
    )
    expect(llm.calls).toBe(0)
    expect(quota.consumeAiQuota).not.toHaveBeenCalled()
    disabled('outfit_explanation', reason)
  })

  it('enabled and selected: the AI step runs as before', async () => {
    rollout({ AI_ROLLOUT_PERCENT: '100' })
    expect((await generate()).fallback).toBe(false)
    expect(llm.calls).toBe(1)
  })
})

describe('privacy', () => {
  it('no user id, digest or bucket reaches telemetry or logs', async () => {
    rollout({ AI_ROLLOUT_PERCENT: '0', AI_ROLLOUT_ALLOWLIST: allowlistDigest('cm_other_internal_user') })
    await chat()
    await generate()
    await analyzeGarment({ buffer: await image(), filename: 'x.jpg', userId: TEST_USER.sub })
    rollout({ AI_ROLLOUT_PERCENT: '0', AI_ROLLOUT_ALLOWLIST: ALLOW_TEST_USER })
    await chat()
    const all = lines.join('\n') + JSON.stringify(events)
    expect(events.length).toBeGreaterThan(3)
    for (const s of [TEST_USER.sub, ALLOW_TEST_USER, allowlistDigest('cm_other_internal_user'), 'AI_ROLLOUT_ALLOWLIST']) expect(all).not.toContain(s)
  })
})
