import { describe, expect, it } from 'vitest'
import { DEFAULT_LLM_TIMEOUT_MS, parseAiConfig } from '@/lib/ai/config'
import { ConfigError } from '@/lib/config'

const KEY = 'test-key-not-real-0123456789'
const prod = (extra: Record<string, string>) => ({ NODE_ENV: 'production', ...extra })
const expectConfigError = (env: Record<string, string | undefined>, message: RegExp) => {
  expect(() => parseAiConfig(env)).toThrow(ConfigError)
  expect(() => parseAiConfig(env)).toThrow(message)
}

describe('AI config: development', () => {
  it('defaults to the mock provider with the default timeout and no price', () => {
    const c = parseAiConfig({ NODE_ENV: 'development' })
    expect(c.llm).toEqual({ provider: 'mock', model: 'mock', apiKey: null, timeoutMs: DEFAULT_LLM_TIMEOUT_MS, price: null })
    expect(c.vision.provider).toBe('mock')
    expect(c.mockInProduction).toBe(false)
  })

  it.each([
    ['gemini', 'GEMINI_API_KEY'],
    ['openai', 'OPENAI_API_KEY'],
  ])('%s needs its own key and an explicit model (no built-in model choice)', (provider, keyVar) => {
    expectConfigError({ AI_LLM_PROVIDER: provider, AI_LLM_MODEL: 'm-1' }, new RegExp(`${keyVar} must be set`))
    expectConfigError({ AI_LLM_PROVIDER: provider, [keyVar]: KEY }, /AI_LLM_MODEL must be set/)
    const c = parseAiConfig({ AI_LLM_PROVIDER: provider.toUpperCase(), [keyVar]: KEY, AI_LLM_MODEL: 'model-x.1' })
    expect(c.llm).toMatchObject({ provider, model: 'model-x.1', apiKey: KEY })
  })

  it('a key of the other provider does not satisfy the selected one', () => {
    expectConfigError({ AI_LLM_PROVIDER: 'gemini', OPENAI_API_KEY: KEY, AI_LLM_MODEL: 'm' }, /GEMINI_API_KEY must be set/)
  })

  it('rejects unknown providers, bad model ids and keys with whitespace', () => {
    expectConfigError({ AI_LLM_PROVIDER: 'zai' }, /mock, gemini or openai/)
    expectConfigError({ AI_LLM_PROVIDER: 'gemini', GEMINI_API_KEY: KEY, AI_LLM_MODEL: '../evil' }, /not a valid model id/)
    expectConfigError({ AI_LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'a b', AI_LLM_MODEL: 'm' }, /whitespace/)
  })

  it('the removed LLM_PROVIDER variable fails loudly instead of being ignored', () => {
    expectConfigError({ LLM_PROVIDER: 'zai' }, /LLM_PROVIDER was removed/)
    expect(parseAiConfig({ LLM_PROVIDER: '' }).llm.provider).toBe('mock') // empty (as in docker-compose) is fine
  })

  it('real vision is not available before Phase 4.1', () => {
    expectConfigError({ AI_VISION_PROVIDER: 'gemini' }, /Phase 4\.1/)
    expect(parseAiConfig({ AI_VISION_PROVIDER: 'MOCK' }).vision.provider).toBe('mock')
  })

  it('timeout bounds', () => {
    expect(parseAiConfig({ AI_LLM_TIMEOUT_MS: '1000' }).llm.timeoutMs).toBe(1000)
    expect(parseAiConfig({ AI_LLM_TIMEOUT_MS: '55000' }).llm.timeoutMs).toBe(55000)
    for (const bad of ['999', '55001', '2.5', '-1', 'abc']) expectConfigError({ AI_LLM_TIMEOUT_MS: bad }, /AI_LLM_TIMEOUT_MS/)
  })

  it('prices: both or neither, non-negative', () => {
    expect(parseAiConfig({ AI_LLM_PRICE_INPUT_USD_PER_MTOK: '0.25', AI_LLM_PRICE_OUTPUT_USD_PER_MTOK: '1.5' }).llm.price).toEqual({
      inputUsdPerMTok: 0.25,
      outputUsdPerMTok: 1.5,
    })
    expectConfigError({ AI_LLM_PRICE_INPUT_USD_PER_MTOK: '0.25' }, /both price variables/)
    expectConfigError({ AI_LLM_PRICE_INPUT_USD_PER_MTOK: '-1', AI_LLM_PRICE_OUTPUT_USD_PER_MTOK: '1' }, /non-negative/)
  })
})

describe('AI config: production fails closed', () => {
  it('requires an explicit provider', () => {
    expectConfigError(prod({}), /AI_LLM_PROVIDER must be set in production/)
  })

  it('refuses the mock provider', () => {
    expectConfigError(prod({ AI_LLM_PROVIDER: 'mock' }), /mock AI provider is selected in production/)
  })

  it('refuses a real provider without its key or model', () => {
    expectConfigError(prod({ AI_LLM_PROVIDER: 'openai', AI_LLM_MODEL: 'm' }), /OPENAI_API_KEY must be set/)
    expectConfigError(prod({ AI_LLM_PROVIDER: 'openai', OPENAI_API_KEY: KEY }), /AI_LLM_MODEL must be set/)
  })

  it('vision is still the mock until Phase 4.1, so a real LLM alone does not satisfy production', () => {
    expectConfigError(prod({ AI_LLM_PROVIDER: 'gemini', GEMINI_API_KEY: KEY, AI_LLM_MODEL: 'm' }), /mock AI provider is selected/)
  })

  it('AI_ALLOW_MOCK_IN_PRODUCTION=1 (exactly) acknowledges the mock', () => {
    const c = parseAiConfig(prod({ AI_LLM_PROVIDER: 'mock', AI_ALLOW_MOCK_IN_PRODUCTION: '1' }))
    expect(c.llm.provider).toBe('mock')
    expect(c.mockInProduction).toBe(true)
    for (const v of ['true', 'yes', '0', '']) {
      expectConfigError(prod({ AI_LLM_PROVIDER: 'mock', AI_ALLOW_MOCK_IN_PRODUCTION: v }), /mock AI provider/)
    }
    const real = parseAiConfig(prod({ AI_LLM_PROVIDER: 'gemini', GEMINI_API_KEY: KEY, AI_LLM_MODEL: 'm', AI_ALLOW_MOCK_IN_PRODUCTION: '1' }))
    expect(real.llm.provider).toBe('gemini')
  })

  it('error messages never contain the key', () => {
    try {
      parseAiConfig(prod({ AI_LLM_PROVIDER: 'gemini', GEMINI_API_KEY: KEY }))
    } catch (err) {
      expect((err as Error).message).not.toContain(KEY)
    }
  })
})
