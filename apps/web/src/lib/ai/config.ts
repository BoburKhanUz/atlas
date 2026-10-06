/**
 * AI provider configuration, read from the environment and validated at
 * startup (assertServerConfig). Fails closed in production: no mock provider
 * and no missing key or model, unless the mock is explicitly acknowledged
 * with AI_ALLOW_MOCK_IN_PRODUCTION=1 (local Docker / e2e only).
 *
 * Variables:
 *   AI_LLM_PROVIDER        mock | gemini | openai (default: mock outside production)
 *   AI_LLM_MODEL           model id, required for gemini/openai (no built-in default)
 *   GEMINI_API_KEY         required when AI_LLM_PROVIDER=gemini
 *   OPENAI_API_KEY         required when AI_LLM_PROVIDER=openai
 *   AI_LLM_TIMEOUT_MS      per-attempt timeout, 1000..55000 (default 25000)
 *   AI_LLM_PRICE_INPUT_USD_PER_MTOK / AI_LLM_PRICE_OUTPUT_USD_PER_MTOK
 *                          optional, for cost estimates in telemetry
 *   AI_VISION_PROVIDER     mock (the only value until Phase 4.1)
 *   AI_ALLOW_MOCK_IN_PRODUCTION  1 to start a production build with mock AI
 */
import { ConfigError } from '@/lib/config'

export type LlmProviderName = 'mock' | 'gemini' | 'openai'
export type VisionProviderName = 'mock'

export interface AiPrice {
  inputUsdPerMTok: number
  outputUsdPerMTok: number
}

export interface AiConfig {
  llm: {
    provider: LlmProviderName
    model: string
    apiKey: string | null
    timeoutMs: number
    price: AiPrice | null
  }
  vision: { provider: VisionProviderName }
  /** True when a production build runs with an acknowledged mock provider. */
  mockInProduction: boolean
}

type Env = Record<string, string | undefined>

export const DEFAULT_LLM_TIMEOUT_MS = 25_000
const MIN_TIMEOUT_MS = 1_000
/** Below the routes' 60 s maxDuration, so two attempts and a short wait still fit in most cases. */
const MAX_TIMEOUT_MS = 55_000
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/
const LLM_PROVIDERS: readonly LlmProviderName[] = ['mock', 'gemini', 'openai']
const KEY_VAR: Record<Exclude<LlmProviderName, 'mock'>, string> = { gemini: 'GEMINI_API_KEY', openai: 'OPENAI_API_KEY' }

const value = (env: Env, name: string) => {
  const v = env[name]?.trim()
  return v ? v : undefined
}

function timeout(env: Env, name: string, fallback: number): number {
  const raw = value(env, name)
  if (raw === undefined) return fallback
  if (!/^\d+$/.test(raw)) throw new ConfigError(`${name} must be a whole number of milliseconds`)
  const ms = Number(raw)
  if (ms < MIN_TIMEOUT_MS || ms > MAX_TIMEOUT_MS) throw new ConfigError(`${name} must be between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}`)
  return ms
}

function price(env: Env): AiPrice | null {
  const i = value(env, 'AI_LLM_PRICE_INPUT_USD_PER_MTOK')
  const o = value(env, 'AI_LLM_PRICE_OUTPUT_USD_PER_MTOK')
  if (i === undefined && o === undefined) return null
  const parse = (name: string, raw: string | undefined) => {
    const n = Number(raw)
    if (raw === undefined || !Number.isFinite(n) || n < 0) {
      throw new ConfigError(`${name} must be a non-negative number (set both price variables or neither)`)
    }
    return n
  }
  return {
    inputUsdPerMTok: parse('AI_LLM_PRICE_INPUT_USD_PER_MTOK', i),
    outputUsdPerMTok: parse('AI_LLM_PRICE_OUTPUT_USD_PER_MTOK', o),
  }
}

export function parseAiConfig(env: Env = process.env): AiConfig {
  const production = env.NODE_ENV === 'production'
  if (value(env, 'LLM_PROVIDER')) {
    throw new ConfigError('LLM_PROVIDER was removed (the Z.ai provider is gone); use AI_LLM_PROVIDER=mock|gemini|openai')
  }

  const rawLlm = value(env, 'AI_LLM_PROVIDER')?.toLowerCase()
  if (rawLlm === undefined && production) {
    throw new ConfigError('AI_LLM_PROVIDER must be set in production (gemini or openai)')
  }
  const llmProvider = (rawLlm ?? 'mock') as LlmProviderName
  if (!LLM_PROVIDERS.includes(llmProvider)) throw new ConfigError('AI_LLM_PROVIDER must be mock, gemini or openai')

  const rawVision = value(env, 'AI_VISION_PROVIDER')?.toLowerCase() ?? 'mock'
  if (rawVision !== 'mock') {
    throw new ConfigError('AI_VISION_PROVIDER supports only "mock" until real vision is implemented (Phase 4.1)')
  }

  let model = 'mock'
  let apiKey: string | null = null
  if (llmProvider !== 'mock') {
    const keyVar = KEY_VAR[llmProvider]
    apiKey = value(env, keyVar) ?? null
    if (!apiKey) throw new ConfigError(`${keyVar} must be set when AI_LLM_PROVIDER=${llmProvider}`)
    if (/\s/.test(apiKey)) throw new ConfigError(`${keyVar} must not contain whitespace`)
    const m = value(env, 'AI_LLM_MODEL')
    if (!m) throw new ConfigError(`AI_LLM_MODEL must be set when AI_LLM_PROVIDER=${llmProvider}`)
    if (!MODEL_ID.test(m)) throw new ConfigError('AI_LLM_MODEL is not a valid model id')
    model = m
  }

  const usesMock = llmProvider === 'mock' || rawVision === 'mock'
  const allowMock = value(env, 'AI_ALLOW_MOCK_IN_PRODUCTION') === '1'
  if (production && usesMock && !allowMock) {
    throw new ConfigError(
      'a mock AI provider is selected in production; configure a real provider, or set AI_ALLOW_MOCK_IN_PRODUCTION=1 for local Docker / e2e only',
    )
  }

  return {
    llm: {
      provider: llmProvider,
      model,
      apiKey,
      timeoutMs: timeout(env, 'AI_LLM_TIMEOUT_MS', DEFAULT_LLM_TIMEOUT_MS),
      price: price(env),
    },
    vision: { provider: 'mock' },
    mockInProduction: production && usesMock,
  }
}

let cached: AiConfig | null = null

/** The validated AI configuration (parsed once). */
export function getAiConfig(): AiConfig {
  cached ??= parseAiConfig()
  return cached
}

/** Tests only: forget the parsed configuration. */
export function resetAiConfigForTesting(): void {
  cached = null
}
