import { describe, expect, it } from 'vitest'
import { DEFAULT_LLM_TIMEOUT_MS, DEFAULT_VISION_MAX_SIDE, DEFAULT_VISION_TIMEOUT_MS, parseAiConfig } from '@/lib/ai/config'
import { ConfigError } from '@/lib/config'

const KEY = 'test-key-not-real-0123456789'
const prod = (extra: Record<string, string>) => ({ NODE_ENV: 'production', ...extra })
/** A production environment with both providers real (no mock acknowledgement needed). */
const realProd = (extra: Record<string, string> = {}) =>
  prod({ AI_LLM_PROVIDER: 'gemini', AI_LLM_MODEL: 'g-text', GEMINI_API_KEY: KEY, AI_VISION_PROVIDER: 'openai', AI_VISION_MODEL: 'o-vision', OPENAI_API_KEY: KEY, ...extra })
const expectConfigError = (env: Record<string, string | undefined>, message: RegExp) => {
  expect(() => parseAiConfig(env)).toThrow(ConfigError)
  expect(() => parseAiConfig(env)).toThrow(message)
}

describe('AI config: development', () => {
  it('defaults to the mock provider with the default timeout and no price', () => {
    const c = parseAiConfig({ NODE_ENV: 'development' })
    expect(c.llm).toEqual({ provider: 'mock', model: 'mock', apiKey: null, timeoutMs: DEFAULT_LLM_TIMEOUT_MS, price: null })
    expect(c.vision).toEqual({
      provider: 'mock',
      model: 'mock',
      apiKey: null,
      timeoutMs: DEFAULT_VISION_TIMEOUT_MS,
      maxSide: DEFAULT_VISION_MAX_SIDE,
      geminiMediaResolution: 'high',
      geminiThinkingLevel: 'low',
      openaiDetail: 'high',
      price: null,
    })
    expect(DEFAULT_VISION_TIMEOUT_MS).toBe(15000)
    expect(DEFAULT_VISION_MAX_SIDE).toBe(1024)
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

  it.each([
    ['gemini', 'GEMINI_API_KEY'],
    ['openai', 'OPENAI_API_KEY'],
  ])('real vision (%s) needs its key and its own explicit model', (provider, keyVar) => {
    expectConfigError({ AI_VISION_PROVIDER: provider, AI_VISION_MODEL: 'm' }, new RegExp(`${keyVar} must be set when AI_VISION_PROVIDER`))
    expectConfigError({ AI_VISION_PROVIDER: provider, [keyVar]: KEY }, /AI_VISION_MODEL must be set/)
    expectConfigError({ AI_VISION_PROVIDER: provider, [keyVar]: KEY, AI_LLM_MODEL: 'm' }, /AI_VISION_MODEL must be set/) // the LLM model is not reused
    const c = parseAiConfig({ AI_VISION_PROVIDER: provider, [keyVar]: KEY, AI_VISION_MODEL: 'vision-1' })
    expect(c.vision).toMatchObject({ provider, model: 'vision-1', apiKey: KEY })
    expect(c.llm.provider).toBe('mock') // independent of the LLM provider
    expect(parseAiConfig({ AI_VISION_PROVIDER: 'MOCK' }).vision.provider).toBe('mock')
    expectConfigError({ AI_VISION_PROVIDER: 'zai' }, /AI_VISION_PROVIDER must be mock, gemini or openai/)
  })

  it('vision tuning: max side, resolution, thinking level, detail, timeout, prices', () => {
    const c = parseAiConfig({
      AI_VISION_MAX_SIDE: '768',
      AI_VISION_RESOLUTION: 'MEDIUM',
      AI_VISION_GEMINI_THINKING_LEVEL: 'none',
      AI_VISION_DETAIL: 'low',
      AI_VISION_TIMEOUT_MS: '9000',
      AI_VISION_PRICE_INPUT_USD_PER_MTOK: '0.3',
      AI_VISION_PRICE_OUTPUT_USD_PER_MTOK: '2.5',
    }).vision
    expect(c).toMatchObject({ maxSide: 768, geminiMediaResolution: 'medium', geminiThinkingLevel: 'none', openaiDetail: 'low', timeoutMs: 9000, price: { inputUsdPerMTok: 0.3, outputUsdPerMTok: 2.5 } })
    for (const bad of ['255', '2049', '1024px', '1e3']) expectConfigError({ AI_VISION_MAX_SIDE: bad }, /AI_VISION_MAX_SIDE/)
    expectConfigError({ AI_VISION_RESOLUTION: 'max' }, /AI_VISION_RESOLUTION must be one of/)
    expectConfigError({ AI_VISION_GEMINI_THINKING_LEVEL: 'off' }, /AI_VISION_GEMINI_THINKING_LEVEL must be one of/)
    expectConfigError({ AI_VISION_DETAIL: 'original' }, /AI_VISION_DETAIL must be one of/)
    expectConfigError({ AI_VISION_TIMEOUT_MS: '60000' }, /AI_VISION_TIMEOUT_MS/)
    expectConfigError({ AI_VISION_PRICE_INPUT_USD_PER_MTOK: '1' }, /both price variables/)
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
  it('requires explicit LLM and vision providers', () => {
    expectConfigError(prod({}), /AI_LLM_PROVIDER must be set in production/)
    expectConfigError(prod({ AI_LLM_PROVIDER: 'gemini', AI_LLM_MODEL: 'm', GEMINI_API_KEY: KEY }), /AI_VISION_PROVIDER must be set in production/)
  })

  it('both providers real: starts without any mock acknowledgement', () => {
    const c = parseAiConfig(realProd())
    expect(c.llm.provider).toBe('gemini')
    expect(c.vision).toMatchObject({ provider: 'openai', model: 'o-vision' })
    expect(c.mockInProduction).toBe(false)
  })

  it('refuses a mock for either role', () => {
    expectConfigError(realProd({ AI_LLM_PROVIDER: 'mock' }), /mock AI provider is selected in production/)
    expectConfigError(realProd({ AI_VISION_PROVIDER: 'mock' }), /mock AI provider is selected in production/)
  })

  it('refuses a real provider without its key or model', () => {
    const missing = (key: string) => {
      const env: Record<string, string | undefined> = realProd()
      delete env[key]
      return env
    }
    expectConfigError(missing('OPENAI_API_KEY'), /OPENAI_API_KEY must be set when AI_VISION_PROVIDER=openai/)
    expectConfigError(missing('AI_VISION_MODEL'), /AI_VISION_MODEL must be set/)
    expectConfigError(missing('GEMINI_API_KEY'), /GEMINI_API_KEY must be set when AI_LLM_PROVIDER=gemini/)
    expectConfigError(missing('AI_LLM_MODEL'), /AI_LLM_MODEL must be set/)
  })

  it('AI_ALLOW_MOCK_IN_PRODUCTION=1 (exactly) acknowledges a mock, for staging/e2e/local only', () => {
    const c = parseAiConfig(prod({ AI_LLM_PROVIDER: 'mock', AI_VISION_PROVIDER: 'mock', AI_ALLOW_MOCK_IN_PRODUCTION: '1' }))
    expect(c.llm.provider).toBe('mock')
    expect(c.mockInProduction).toBe(true)
    for (const v of ['true', 'yes', '0', '']) {
      expectConfigError(prod({ AI_LLM_PROVIDER: 'mock', AI_VISION_PROVIDER: 'mock', AI_ALLOW_MOCK_IN_PRODUCTION: v }), /mock AI provider/)
    }
    const mixed = parseAiConfig(realProd({ AI_VISION_PROVIDER: 'mock', AI_ALLOW_MOCK_IN_PRODUCTION: '1' }))
    expect(mixed).toMatchObject({ mockInProduction: true, vision: { provider: 'mock' }, llm: { provider: 'gemini' } })
  })

  it('error messages never contain the key', () => {
    for (const env of [prod({ AI_LLM_PROVIDER: 'gemini', GEMINI_API_KEY: KEY }), realProd({ AI_VISION_MODEL: '' }), realProd({ AI_VISION_PROVIDER: 'mock' })]) {
      try {
        parseAiConfig(env)
      } catch (err) {
        expect((err as Error).message).not.toContain(KEY)
      }
    }
  })
})
