/**
 * Multi-provider P1: per-feature text routes (AI_STYLIST_* / AI_OUTFIT_*), the
 * provider allowlist (AI_APPROVED_PROVIDERS), legacy compatibility, pricing
 * that is never misattributed, and no silent fallback between routes. The
 * global fetch is replaced by a recorder: nothing reaches the network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateText } from '@/lib/ai/client'
import { LEGACY_APPROVED_PROVIDERS, parseAiConfig, resetAiConfigForTesting, type AiConfig } from '@/lib/ai/config'
import { ConfigError } from '@/lib/config'
import { getLLMProvider, getTextProvider, setLLMProviderForTesting, setTextProviderForTesting } from '@/lib/ai/providers'
import { AiProviderError } from '@/lib/ai/providers/errors'
import type { LLMProvider, LLMRequest } from '@/lib/ai/providers/types'

const GKEY = 'gemini-test-key-SHOULD-NEVER-BE-LOGGED-01'
const OKEY = 'openai-test-key-SHOULD-NEVER-BE-LOGGED-02'
const keys = { GEMINI_API_KEY: GKEY, OPENAI_API_KEY: OKEY }
const prodLegacy = { NODE_ENV: 'production', AI_LLM_PROVIDER: 'gemini', AI_LLM_MODEL: 'g-text', AI_VISION_PROVIDER: 'openai', AI_VISION_MODEL: 'o-vis', ...keys }
const price = { AI_LLM_PRICE_INPUT_USD_PER_MTOK: '1', AI_LLM_PRICE_OUTPUT_USD_PER_MTOK: '2' }
const legacyPrice = { inputUsdPerMTok: 1, outputUsdPerMTok: 2 }
const err = (env: Record<string, string | undefined>) => {
  try {
    parseAiConfig(env)
  } catch (e) {
    return e as Error
  }
  throw new Error('expected a configuration error')
}
const routeOf = (c: AiConfig, f: 'stylist_chat' | 'outfit_explanation') => {
  const { apiKey, ...rest } = c.text[f]
  return { ...rest, hasKey: apiKey !== null }
}

// The global fetch records every request and never reaches the network.
let requests: string[] = []
let reply: (url: string) => Response = () => new Response('{}', { status: 503 })
beforeEach(() => {
  requests = []
  reply = () => new Response('{}', { status: 503 })
  vi.stubGlobal('fetch', async (url: string) => {
    requests.push(new URL(url).host)
    return reply(url)
  })
  resetAiConfigForTesting()
  setLLMProviderForTesting(null)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  setLLMProviderForTesting(null)
  resetAiConfigForTesting()
})

describe('legacy configuration (AI_LLM_* / AI_VISION_* only) behaves exactly as before', () => {
  const cases: Array<[string, Record<string, string | undefined>]> = [
    ['development, nothing set', { NODE_ENV: 'development' }],
    ['development, gemini text', { NODE_ENV: 'development', AI_LLM_PROVIDER: 'gemini', AI_LLM_MODEL: 'g', ...keys }],
    ['production, gemini text + openai vision, prices, timeout', { ...prodLegacy, ...price, AI_LLM_TIMEOUT_MS: '30000' }],
    ['production, acknowledged mock', { NODE_ENV: 'production', AI_LLM_PROVIDER: 'mock', AI_VISION_PROVIDER: 'mock', AI_ALLOW_MOCK_IN_PRODUCTION: '1' }],
  ]
  it.each(cases)('%s: both text routes are the AI_LLM route; vision, rollout and mock flags unchanged', (_, env) => {
    const c = parseAiConfig(env)
    for (const f of ['stylist_chat', 'outfit_explanation'] as const) {
      expect(c.text[f]).toEqual({ provider: c.llm.provider, model: c.llm.model, apiKey: c.llm.apiKey, timeoutMs: c.llm.timeoutMs, price: c.llm.price, source: 'AI_LLM' })
    }
    expect([...c.approvedProviders]).toEqual([...LEGACY_APPROVED_PROVIDERS])
    expect([...c.approvedProviders]).toEqual(['gemini', 'openai'])
  })

  it('legacy production requirements and messages are unchanged', () => {
    expect(err({ NODE_ENV: 'production', ...keys }).message).toBe('AI_LLM_PROVIDER must be set in production (gemini or openai)')
    expect(err({ ...prodLegacy, AI_VISION_PROVIDER: undefined }).message).toBe('AI_VISION_PROVIDER must be set in production (gemini or openai)')
    expect(err({ NODE_ENV: 'production', AI_LLM_PROVIDER: 'mock', AI_VISION_PROVIDER: 'mock' }).message).toMatch(/^a mock AI provider is selected in production/)
    // A single overridden route still needs the legacy provider for the other one.
    expect(err({ NODE_ENV: 'production', AI_STYLIST_PROVIDER: 'gemini', AI_STYLIST_MODEL: 'g', AI_VISION_PROVIDER: 'openai', AI_VISION_MODEL: 'o', ...keys }).message).toBe('AI_LLM_PROVIDER must be set in production (gemini or openai)')
  })

  it('without overrides, the stylist and outfit features get the same provider the legacy factory built', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('AI_LLM_PROVIDER', 'gemini')
    vi.stubEnv('AI_LLM_MODEL', 'g-text')
    vi.stubEnv('GEMINI_API_KEY', GKEY)
    const s = getTextProvider('stylist_chat'), o = getTextProvider('outfit_explanation')
    expect([s.name, s.model, o.name, o.model]).toEqual(['gemini', 'g-text', 'gemini', 'g-text'])
    expect(getLLMProvider()).toBe(s)
  })
})

describe('per-feature routes', () => {
  it('AI_STYLIST_* changes only the stylist route; outfit stays legacy; vision is untouched', () => {
    const base = parseAiConfig(prodLegacy)
    const c = parseAiConfig({ ...prodLegacy, AI_STYLIST_PROVIDER: 'openai', AI_STYLIST_MODEL: 'o-stylist' })
    expect(routeOf(c, 'stylist_chat')).toEqual({ provider: 'openai', model: 'o-stylist', hasKey: true, timeoutMs: 25_000, price: null, source: 'AI_STYLIST' })
    expect(c.text.stylist_chat.apiKey).toBe(OKEY)
    expect(c.text.outfit_explanation).toEqual(base.text.outfit_explanation)
    expect(c.vision).toEqual(base.vision)
    expect(c.llm).toEqual(base.llm)
  })

  it('AI_OUTFIT_* changes only the outfit route; provider names are normalized', () => {
    const c = parseAiConfig({ ...prodLegacy, AI_OUTFIT_PROVIDER: ' OpenAI ', AI_OUTFIT_MODEL: 'o-outfit' })
    expect(routeOf(c, 'outfit_explanation')).toMatchObject({ provider: 'openai', model: 'o-outfit', source: 'AI_OUTFIT' })
    expect(routeOf(c, 'stylist_chat')).toMatchObject({ provider: 'gemini', model: 'g-text', source: 'AI_LLM' })
  })

  it('both routes set: production no longer needs AI_LLM_PROVIDER for them; vision rules are unchanged', () => {
    const env = { NODE_ENV: 'production', AI_STYLIST_PROVIDER: 'gemini', AI_STYLIST_MODEL: 'g-s', AI_OUTFIT_PROVIDER: 'openai', AI_OUTFIT_MODEL: 'o-o', AI_VISION_PROVIDER: 'openai', AI_VISION_MODEL: 'o-v', ...keys }
    const c = parseAiConfig(env)
    expect([c.text.stylist_chat.provider, c.text.outfit_explanation.provider, c.mockInProduction]).toEqual(['gemini', 'openai', false])
    expect(err({ ...env, AI_VISION_PROVIDER: undefined }).message).toBe('AI_VISION_PROVIDER must be set in production (gemini or openai)')
    // A set AI_LLM_PROVIDER is still validated even when no route uses it.
    expect(err({ ...env, AI_LLM_PROVIDER: 'claude' }).message).toBe('AI_LLM_PROVIDER must be mock, gemini or openai')
  })

  it('partial pairs fail closed, for either prefix', () => {
    for (const prefix of ['AI_STYLIST', 'AI_OUTFIT']) {
      const msg = `${prefix}_PROVIDER and ${prefix}_MODEL must be set together (or both left unset to use AI_LLM_PROVIDER)`
      expect(err({ ...prodLegacy, [`${prefix}_PROVIDER`]: 'openai' })).toBeInstanceOf(ConfigError)
      expect(err({ ...prodLegacy, [`${prefix}_PROVIDER`]: 'openai' }).message).toBe(msg)
      expect(err({ ...prodLegacy, [`${prefix}_MODEL`]: 'm' }).message).toBe(msg)
      expect(err({ NODE_ENV: 'development', [`${prefix}_MODEL`]: 'm' }).message).toBe(msg)
    }
  })

  it('invalid routes fail closed: unknown provider, bad model id, missing or malformed key', () => {
    expect(err({ ...prodLegacy, AI_STYLIST_PROVIDER: 'claude', AI_STYLIST_MODEL: 'm' }).message).toBe('AI_STYLIST_PROVIDER must be mock, gemini or openai')
    expect(err({ ...prodLegacy, AI_OUTFIT_PROVIDER: 'gemini', AI_OUTFIT_MODEL: 'bad model' }).message).toBe('AI_OUTFIT_MODEL is not a valid model id')
    expect(err({ ...prodLegacy, OPENAI_API_KEY: undefined, AI_VISION_PROVIDER: 'gemini', AI_OUTFIT_PROVIDER: 'openai', AI_OUTFIT_MODEL: 'o' }).message).toBe('OPENAI_API_KEY must be set when AI_OUTFIT_PROVIDER=openai')
    expect(err({ ...prodLegacy, GEMINI_API_KEY: 'a b', AI_LLM_PROVIDER: 'openai', AI_VISION_PROVIDER: 'openai', AI_STYLIST_PROVIDER: 'gemini', AI_STYLIST_MODEL: 'g' }).message).toBe('GEMINI_API_KEY must not contain whitespace')
  })

  it('development mock behaviour is preserved; a mock route in production needs the explicit acknowledgement', () => {
    const dev = parseAiConfig({ NODE_ENV: 'development', AI_STYLIST_PROVIDER: 'mock', AI_STYLIST_MODEL: 'any' })
    expect([dev.text.stylist_chat.provider, dev.text.stylist_chat.model, dev.text.stylist_chat.apiKey]).toEqual(['mock', 'mock', null])
    expect(err({ ...prodLegacy, AI_STYLIST_PROVIDER: 'mock', AI_STYLIST_MODEL: 'm' }).message).toMatch(/^a mock AI provider is selected in production/)
    const ack = parseAiConfig({ ...prodLegacy, AI_STYLIST_PROVIDER: 'mock', AI_STYLIST_MODEL: 'm', AI_ALLOW_MOCK_IN_PRODUCTION: '1' })
    expect(ack.mockInProduction).toBe(true)
  })
})

describe('provider allowlist (AI_APPROVED_PROVIDERS)', () => {
  it('unset: the legacy set only; explicit entries are normalized', () => {
    expect([...parseAiConfig(prodLegacy).approvedProviders]).toEqual(['gemini', 'openai'])
    expect([...parseAiConfig({ ...prodLegacy, AI_APPROVED_PROVIDERS: ' GEMINI , openai ' }).approvedProviders]).toEqual(['gemini', 'openai'])
  })

  it('every real role is checked, in every environment', () => {
    expect(err({ ...prodLegacy, AI_APPROVED_PROVIDERS: 'gemini' }).message).toBe('AI_VISION_PROVIDER=openai is not an approved provider (AI_APPROVED_PROVIDERS)')
    expect(err({ ...prodLegacy, AI_APPROVED_PROVIDERS: 'openai' }).message).toBe('AI_LLM_PROVIDER=gemini is not an approved provider (AI_APPROVED_PROVIDERS)')
    expect(err({ ...prodLegacy, AI_APPROVED_PROVIDERS: 'gemini', AI_VISION_PROVIDER: 'gemini', AI_STYLIST_PROVIDER: 'openai', AI_STYLIST_MODEL: 'o' }).message).toBe('AI_STYLIST_PROVIDER=openai is not an approved provider (AI_APPROVED_PROVIDERS)')
    expect(err({ ...prodLegacy, AI_APPROVED_PROVIDERS: 'gemini', AI_VISION_PROVIDER: 'gemini', AI_OUTFIT_PROVIDER: 'openai', AI_OUTFIT_MODEL: 'o' }).message).toBe('AI_OUTFIT_PROVIDER=openai is not an approved provider (AI_APPROVED_PROVIDERS)')
    expect(err({ NODE_ENV: 'development', AI_APPROVED_PROVIDERS: 'openai', AI_LLM_PROVIDER: 'gemini', AI_LLM_MODEL: 'g', ...keys }).message).toBe('AI_LLM_PROVIDER=gemini is not an approved provider (AI_APPROVED_PROVIDERS)')
    // The mock is governed by its own rules, never by the allowlist.
    expect(parseAiConfig({ NODE_ENV: 'development', AI_APPROVED_PROVIDERS: 'gemini' }).text.stylist_chat.provider).toBe('mock')
  })

  it('unknown, empty and mock entries are refused without echoing the entry', () => {
    const unknown = err({ ...prodLegacy, AI_APPROVED_PROVIDERS: 'gemini,openai,anthropic-SECRET-LOOKING' })
    expect(unknown.message).toBe('AI_APPROVED_PROVIDERS contains an unknown provider (registered: gemini or openai)')
    expect(unknown.message).not.toContain('SECRET')
    expect(err({ ...prodLegacy, AI_APPROVED_PROVIDERS: ' , ,' }).message).toMatch(/^AI_APPROVED_PROVIDERS must list at least one provider/)
    expect(err({ ...prodLegacy, AI_APPROVED_PROVIDERS: 'gemini,openai,mock' }).message).toMatch(/^AI_APPROVED_PROVIDERS lists real providers only/)
  })
})

describe('pricing is never misattributed', () => {
  it('AI_LLM_PRICE_* applies to the legacy route and to an override only on the same provider and model', () => {
    const p = (extra: Record<string, string>) => parseAiConfig({ ...prodLegacy, ...price, ...extra })
    expect(p({}).text.stylist_chat.price).toEqual(legacyPrice)
    expect(p({ AI_STYLIST_PROVIDER: 'gemini', AI_STYLIST_MODEL: 'g-text' }).text.stylist_chat.price).toEqual(legacyPrice)
    expect(p({ AI_STYLIST_PROVIDER: 'openai', AI_STYLIST_MODEL: 'o' }).text.stylist_chat.price).toBeNull()
    expect(p({ AI_STYLIST_PROVIDER: 'gemini', AI_STYLIST_MODEL: 'g-other' }).text.stylist_chat.price).toBeNull()
    expect(p({ AI_OUTFIT_PROVIDER: 'openai', AI_OUTFIT_MODEL: 'o' }).text.outfit_explanation.price).toBeNull()
    expect(p({ AI_OUTFIT_PROVIDER: 'openai', AI_OUTFIT_MODEL: 'o' }).text.stylist_chat.price).toEqual(legacyPrice)
  })
})

describe('no silent fallback between routes', () => {
  const routed = {
    NODE_ENV: 'development',
    AI_LLM_PROVIDER: 'openai',
    AI_LLM_MODEL: 'o-legacy',
    AI_STYLIST_PROVIDER: 'gemini',
    AI_STYLIST_MODEL: 'g-stylist',
    ...keys,
  }
  const stub = (env: Record<string, string>) => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
    resetAiConfigForTesting()
    setLLMProviderForTesting(null)
  }
  const req = { messages: [{ role: 'user' as const, content: 'hi' }] }

  it('each feature builds only its own route provider', () => {
    stub(routed)
    const s = getTextProvider('stylist_chat'), o = getTextProvider('outfit_explanation')
    expect([s.name, s.model, o.name, o.model]).toEqual(['gemini', 'g-stylist', 'openai', 'o-legacy'])
  })

  it('a failing stylist route never reaches the legacy or outfit provider (real adapters, recorded transport)', async () => {
    stub(routed)
    const e = await generateText('stylist_chat', req, { sleep: async () => undefined }).then(() => null, (x) => x as AiProviderError)
    expect([e?.kind, e?.provider]).toEqual(['unavailable', 'gemini'])
    expect(requests).toEqual(['generativelanguage.googleapis.com', 'generativelanguage.googleapis.com']) // the one retry, same provider
    requests = []
    reply = (url) => (url.includes('openai') ? new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'ok' } }], usage: {} }), { status: 200 }) : new Response('{}', { status: 503 }))
    await generateText('outfit_explanation', req)
    expect(requests).toEqual(['api.openai.com'])
  })

  it('injected per-feature providers: a failure stays on its route', async () => {
    const calls = { stylist: 0, outfit: 0 }
    const failing: LLMProvider = { name: 'scripted-a', model: 'a', generate: async () => (calls.stylist++, Promise.reject(new AiProviderError('auth', 'scripted-a', { status: 401 }))) }
    const ok: LLMProvider = { name: 'scripted-b', model: 'b', generate: async (_: LLMRequest) => (calls.outfit++, { text: 'ok', metadata: { provider: 'scripted-b', model: 'b', usage: {} } }) }
    setTextProviderForTesting('stylist_chat', failing)
    setTextProviderForTesting('outfit_explanation', ok)
    await expect(generateText('stylist_chat', req)).rejects.toMatchObject({ kind: 'auth' })
    expect(calls).toEqual({ stylist: 1, outfit: 0 })
    await generateText('outfit_explanation', req)
    expect(calls).toEqual({ stylist: 1, outfit: 1 })
    setTextProviderForTesting('stylist_chat', null)
    setTextProviderForTesting('outfit_explanation', null)
  })
})

describe('telemetry stays content-free and names each route', () => {
  it('ai.call records the route provider and model, no cost for an unpriced override, never a key', async () => {
    const lines: string[] = []
    const push = (chunk: unknown) => (lines.push(String(chunk)), true)
    vi.spyOn(process.stdout, 'write').mockImplementation(push as never)
    vi.spyOn(process.stderr, 'write').mockImplementation(push as never)
    for (const [k, v] of Object.entries({ NODE_ENV: 'development', AI_LLM_PROVIDER: 'gemini', AI_LLM_MODEL: 'g-legacy', AI_OUTFIT_PROVIDER: 'openai', AI_OUTFIT_MODEL: 'o-outfit', ...keys, ...price })) vi.stubEnv(k, v)
    resetAiConfigForTesting()
    reply = (url) =>
      url.includes('openai')
        ? new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'ok' } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }), { status: 200 })
        : new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'ok' }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 } }), { status: 200 })
    await generateText('outfit_explanation', { messages: [{ role: 'user', content: 'USER-CONTENT' }] })
    await generateText('stylist_chat', { messages: [{ role: 'user', content: 'USER-CONTENT' }] })
    const calls = lines.filter((l) => l.includes('"msg":"ai.call"')).map((l) => JSON.parse(l))
    expect(calls.map((c) => [c.feature, c.provider, c.model, c.costUsd])).toEqual([
      ['outfit_explanation', 'openai', 'o-outfit', undefined],
      ['stylist_chat', 'gemini', 'g-legacy', (10 * 1 + 5 * 2) / 1e6],
    ])
    const all = lines.join('\n')
    for (const secret of [GKEY, OKEY, 'USER-CONTENT']) expect(all).not.toContain(secret)
  })
})
