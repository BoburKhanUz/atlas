/**
 * Phase 5.0 rollout foundation: feature switches, percentage, allowlist,
 * deterministic buckets and the decision order. Pure; no provider, no network.
 */
import { describe, expect, it } from 'vitest'
import { parseAiConfig, type AiRolloutConfig } from '@/lib/ai/config'
import { allowlistDigest, decideAiEligibility, rolloutBucket } from '@/lib/ai/rollout'

const KEY = 'test-key-not-real-0123456789'
const realProd = (extra: Record<string, string> = {}) => ({
  NODE_ENV: 'production', AI_LLM_PROVIDER: 'gemini', AI_LLM_MODEL: 'g', GEMINI_API_KEY: KEY, AI_VISION_PROVIDER: 'openai', AI_VISION_MODEL: 'o', OPENAI_API_KEY: KEY, ...extra,
})
const cfg = (over: Partial<AiRolloutConfig> = {}): AiRolloutConfig => ({
  features: { stylist_chat: true, clothing_analysis: true, outfit_explanation: true },
  percent: 100,
  allowlist: new Set(),
  ...over,
})
const users = (n: number) => Array.from({ length: n }, (_, i) => `cm_synthetic_user_${i}`)

describe('feature switches (configuration)', () => {
  it('production: missing switches and percentage are OFF (fail closed)', () => {
    const r = parseAiConfig(realProd()).rollout
    expect(r.features).toEqual({ stylist_chat: false, clothing_analysis: false, outfit_explanation: false })
    expect(r.percent).toBe(0)
    expect(r.allowlist.size).toBe(0)
  })

  it('development and test: missing switches and percentage are ON (Phase 4 behaviour kept)', () => {
    for (const NODE_ENV of ['development', 'test', undefined]) {
      const r = parseAiConfig({ NODE_ENV }).rollout
      expect(r.features).toEqual({ stylist_chat: true, clothing_analysis: true, outfit_explanation: true })
      expect(r.percent).toBe(100)
    }
  })

  it('explicit values: true/false/1/0, case-insensitive, per feature and independent', () => {
    const r = parseAiConfig(realProd({ AI_STYLIST_ENABLED: 'TRUE', AI_VISION_ENABLED: '0', AI_OUTFIT_AI_ENABLED: '1', AI_ROLLOUT_PERCENT: '25' })).rollout
    expect(r.features).toEqual({ stylist_chat: true, clothing_analysis: false, outfit_explanation: true })
    expect(r.percent).toBe(25)
    expect(parseAiConfig({ NODE_ENV: 'development', AI_STYLIST_ENABLED: 'false' }).rollout.features.stylist_chat).toBe(false)
    expect(parseAiConfig({ NODE_ENV: 'development', AI_VISION_ENABLED: ' ' }).rollout.features.clothing_analysis).toBe(true) // blank = missing
  })

  it.each(['yes', 'on', 'enabled', '2', 'truee'])('a malformed switch (%s) refuses to start, in every environment', (v) => {
    expect(() => parseAiConfig(realProd({ AI_STYLIST_ENABLED: v }))).toThrow(/AI_STYLIST_ENABLED must be true, false, 1 or 0/)
    expect(() => parseAiConfig({ NODE_ENV: 'development', AI_OUTFIT_AI_ENABLED: v })).toThrow(/AI_OUTFIT_AI_ENABLED/)
  })

  it('switches never relax production fail-closed: a mock still needs the acknowledgement, a real provider its key', () => {
    const on = { AI_STYLIST_ENABLED: 'true', AI_VISION_ENABLED: 'true', AI_OUTFIT_AI_ENABLED: 'true', AI_ROLLOUT_PERCENT: '100' }
    expect(() => parseAiConfig({ NODE_ENV: 'production', AI_LLM_PROVIDER: 'mock', AI_VISION_PROVIDER: 'mock', ...on })).toThrow(/mock AI provider is selected in production/)
    expect(() => parseAiConfig(realProd({ ...on, GEMINI_API_KEY: '' }))).toThrow(/GEMINI_API_KEY must be set/)
    expect(() => parseAiConfig({ NODE_ENV: 'production', ...on })).toThrow(/AI_LLM_PROVIDER must be set in production/)
  })
})

describe('rollout percentage (configuration)', () => {
  it.each([['0', 0], ['1', 1], ['10', 10], ['50', 50], ['99', 99], ['100', 100], ['007', 7]])('%s → %i', (raw, n) => {
    expect(parseAiConfig(realProd({ AI_ROLLOUT_PERCENT: raw })).rollout.percent).toBe(n)
  })

  it.each(['-1', '101', '1000', '12.5', 'ten', '50%', '1e2'])('invalid %s refuses to start', (raw) => {
    expect(() => parseAiConfig(realProd({ AI_ROLLOUT_PERCENT: raw }))).toThrow(/AI_ROLLOUT_PERCENT must be a whole number between 0 and 100/)
  })
})

describe('allowlist (configuration)', () => {
  it('accepts digests (any case, spaces, empty entries) and refuses raw ids without echoing them', () => {
    const d = allowlistDigest('cm_internal_tester_1')
    const r = parseAiConfig(realProd({ AI_ROLLOUT_ALLOWLIST: ` ${d.toUpperCase()} ,, ${allowlistDigest('cm_internal_tester_2')} ` })).rollout
    expect([...r.allowlist]).toEqual([d, allowlistDigest('cm_internal_tester_2')])
    let message = ''
    try {
      parseAiConfig(realProd({ AI_ROLLOUT_ALLOWLIST: 'cm_raw_user_id_123' }))
    } catch (err) {
      message = (err as Error).message
    }
    expect(message).toMatch(/must be allowlist digests/)
    expect(message).not.toContain('cm_raw_user_id_123')
  })

  it('a digest must be exactly 64 hex characters; at most 1000 entries', () => {
    const d = allowlistDigest('cm_x')
    for (const bad of [d + 'a', 'x' + d, d.slice(1), `${d.slice(0, 63)}g`]) {
      expect(() => parseAiConfig(realProd({ AI_ROLLOUT_ALLOWLIST: bad }))).toThrow(/must be allowlist digests/)
    }
    const many = (n: number) => Array.from({ length: n }, (_, i) => allowlistDigest(`cm_${i}`)).join(',')
    expect(parseAiConfig(realProd({ AI_ROLLOUT_ALLOWLIST: many(1000) })).rollout.allowlist.size).toBe(1000)
    expect(() => parseAiConfig(realProd({ AI_ROLLOUT_ALLOWLIST: many(1001) }))).toThrow(/at most 1000 entries/)
  })

  it('the digest is a namespaced SHA-256, distinct from the bucket hash, never the raw id', () => {
    const d = allowlistDigest('cm_x')
    expect(d).toMatch(/^[0-9a-f]{64}$/)
    expect(d).not.toContain('cm_x')
    expect(allowlistDigest('cm_y')).not.toBe(d)
  })
})

describe('deterministic buckets', () => {
  it('the same user always gets the same bucket and decision (100 evaluations)', () => {
    for (const id of users(20)) {
      const b = rolloutBucket(id)
      const d = decideAiEligibility('stylist_chat', id, cfg({ percent: 37 }))
      for (let i = 0; i < 100; i++) {
        expect(rolloutBucket(id)).toBe(b)
        expect(decideAiEligibility('stylist_chat', id, cfg({ percent: 37 }))).toEqual(d)
      }
    }
    expect(rolloutBucket('cm_fixed_reference_user')).toBe(rolloutBucket('cm_fixed_reference_user'))
  })

  it('buckets are 0..99; the distribution matches the percentage within a loose bound (20 000 synthetic users)', () => {
    const all = users(20_000).map(rolloutBucket)
    expect(Math.min(...all)).toBe(0)
    expect(Math.max(...all)).toBe(99)
    for (const p of [1, 10, 50, 99]) {
      const share = all.filter((b) => b < p).length / all.length
      expect(Math.abs(share - p / 100)).toBeLessThan(0.02)
    }
  })

  it('raising the percentage only adds users (nobody selected at 10 % is dropped at 25 %)', () => {
    for (const id of users(2000)) {
      if (decideAiEligibility('outfit_explanation', id, cfg({ percent: 10 })).eligible) {
        expect(decideAiEligibility('outfit_explanation', id, cfg({ percent: 25 })).eligible).toBe(true)
      }
    }
  })

  it('0 % → nobody; 100 % → everybody (with the feature on)', () => {
    for (const id of users(500)) {
      expect(decideAiEligibility('stylist_chat', id, cfg({ percent: 0 }))).toEqual({ eligible: false, reason: 'rollout_not_selected' })
      expect(decideAiEligibility('stylist_chat', id, cfg({ percent: 100 }))).toEqual({ eligible: true, reason: 'rollout_selected' })
    }
  })
})

describe('decision order', () => {
  const tester = 'cm_internal_tester_1'
  const allow = new Set([allowlistDigest(tester)])

  it('1. a disabled feature is never eligible — not even for an allowlisted user or at 100 %', () => {
    const c = cfg({ features: { stylist_chat: false, clothing_analysis: true, outfit_explanation: true }, percent: 100, allowlist: allow })
    expect(decideAiEligibility('stylist_chat', tester, c)).toEqual({ eligible: false, reason: 'feature_disabled' })
    expect(decideAiEligibility('clothing_analysis', tester, c)).toEqual({ eligible: true, reason: 'allowlisted' }) // switches are independent
  })

  it('2. an allowlisted user skips the percentage (0 %); others do not', () => {
    const c = cfg({ percent: 0, allowlist: allow })
    expect(decideAiEligibility('outfit_explanation', tester, c)).toEqual({ eligible: true, reason: 'allowlisted' })
    expect(decideAiEligibility('outfit_explanation', 'cm_someone_else', c)).toEqual({ eligible: false, reason: 'rollout_not_selected' })
  })

  it('3. otherwise the stable bucket decides', () => {
    const id = users(200).find((u) => rolloutBucket(u) === 42)!
    expect(decideAiEligibility('stylist_chat', id, cfg({ percent: 42 })).eligible).toBe(false) // bucket must be < percent
    expect(decideAiEligibility('stylist_chat', id, cfg({ percent: 43 }))).toEqual({ eligible: true, reason: 'rollout_selected' })
  })

  it('the decision carries only a fixed reason code: never the id, the bucket or the digest', () => {
    const d = decideAiEligibility('stylist_chat', tester, cfg({ allowlist: allow }))
    expect(Object.keys(d).sort()).toEqual(['eligible', 'reason'])
    expect(JSON.stringify(d)).not.toContain(tester)
  })
})
