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
 *   AI_VISION_PROVIDER     mock | gemini | openai (default: mock outside production)
 *   AI_VISION_MODEL        model id, required for gemini/openai (no built-in default)
 *   AI_VISION_TIMEOUT_MS   per-attempt timeout, 1000..55000 (default 15000)
 *   AI_VISION_MAX_SIDE     longest side sent to the provider, 256..2048 (default 1024)
 *   AI_VISION_RESOLUTION   Gemini media resolution: low | medium | high | ultra_high (default high)
 *   AI_VISION_DETAIL       OpenAI image detail: low | high | auto (default high)
 *   AI_VISION_GEMINI_THINKING_LEVEL  none | minimal | low | medium | high (default low;
 *                          none sends nothing, for models without thinking levels)
 *   AI_VISION_PRICE_INPUT_USD_PER_MTOK / AI_VISION_PRICE_OUTPUT_USD_PER_MTOK
 *                          optional, for cost estimates in telemetry
 *   AI_ALLOW_MOCK_IN_PRODUCTION  1 to start a production build with a mock provider
 *
 * Per-feature text routes (multi-provider P1; optional, see docs/ai/provider-architecture.md):
 *   AI_STYLIST_PROVIDER + AI_STYLIST_MODEL   stylist chat; both or neither
 *   AI_OUTFIT_PROVIDER + AI_OUTFIT_MODEL     outfit explanation; both or neither
 *                          Unset: the feature uses AI_LLM_PROVIDER / AI_LLM_MODEL.
 *                          Timeouts stay AI_LLM_TIMEOUT_MS. AI_LLM_PRICE_* applies
 *                          to a route only on the legacy provider and model;
 *                          otherwise its cost is unavailable (never guessed).
 *   AI_APPROVED_PROVIDERS  comma-separated real providers allowed for any role, in
 *                          every environment. Unset: gemini, openai (the legacy
 *                          set); a newly registered provider is never approved
 *                          automatically. The mock stays governed by the rules above.
 *
 * Rollout (Phase 5.0; see docs/ai/rollout.md). Eligibility only: they never
 * select a provider and never relax the checks above.
 *   AI_STYLIST_ENABLED / AI_VISION_ENABLED / AI_OUTFIT_AI_ENABLED
 *                          true|false|1|0. Missing: false in production (fail
 *                          closed), true elsewhere (Phase 4 behaviour)
 *   AI_ROLLOUT_PERCENT     0..100, whole number. Missing: 0 in production, 100 elsewhere
 *   AI_ROLLOUT_ALLOWLIST   comma-separated allowlist digests (64 hex characters,
 *                          `bun scripts/ai-rollout-digest.ts <userId>`), never raw ids
 */
import { ConfigError } from '@/lib/config'
import { describeIds, getProviderDescriptor, normalizeProviderId, PROVIDER_IDS, supportsCapability, type ProviderId } from './providers/registry'

/** Provider ids come from the registry (providers/registry.ts). */
export type LlmProviderName = ProviderId
export type VisionProviderName = ProviderId
export type GeminiMediaResolution = 'low' | 'medium' | 'high' | 'ultra_high'
export type GeminiThinkingLevel = 'none' | 'minimal' | 'low' | 'medium' | 'high'
export type OpenAIImageDetail = 'low' | 'high' | 'auto'

export interface AiPrice {
  inputUsdPerMTok: number
  outputUsdPerMTok: number
}

/** The text features, each with its own provider route. */
export type AiTextFeature = 'stylist_chat' | 'outfit_explanation'

/** Where a text route's provider and model come from. */
export type TextRouteSource = 'AI_LLM' | 'AI_STYLIST' | 'AI_OUTFIT'

export interface TextRouteConfig {
  provider: LlmProviderName
  model: string
  apiKey: string | null
  timeoutMs: number
  /** AI_LLM_PRICE_* only on the legacy provider and model; null otherwise (cost unavailable). */
  price: AiPrice | null
  source: TextRouteSource
}

/** Real providers approved when AI_APPROVED_PROVIDERS is unset. New providers are never added here implicitly. */
export const LEGACY_APPROVED_PROVIDERS: readonly ProviderId[] = ['gemini', 'openai']

export interface AiConfig {
  /** The legacy text configuration (AI_LLM_*). Features read their route in `text`. */
  llm: {
    provider: LlmProviderName
    model: string
    apiKey: string | null
    timeoutMs: number
    price: AiPrice | null
  }
  vision: {
    provider: VisionProviderName
    model: string
    apiKey: string | null
    timeoutMs: number
    maxSide: number
    geminiMediaResolution: GeminiMediaResolution
    geminiThinkingLevel: GeminiThinkingLevel
    openaiDetail: OpenAIImageDetail
    price: AiPrice | null
  }
  /** Provider route per text feature: an override (AI_STYLIST_* / AI_OUTFIT_*) or the legacy AI_LLM_* one. */
  text: Record<AiTextFeature, TextRouteConfig>
  /** Real providers allowed for any role (AI_APPROVED_PROVIDERS). */
  approvedProviders: ReadonlySet<string>
  /** True when a production build runs with an acknowledged mock provider. */
  mockInProduction: boolean
  rollout: AiRolloutConfig
}

/** The AI features that can be switched and rolled out. */
export type AiRolloutFeature = 'stylist_chat' | 'clothing_analysis' | 'outfit_explanation'

export interface AiRolloutConfig {
  /** Per-feature switches. A disabled feature never calls an AI provider. */
  features: Record<AiRolloutFeature, boolean>
  /** Share of users (by stable bucket) who get the enabled AI features, 0..100. */
  percent: number
  /** Allowlist digests (see rollout.ts); never raw user ids. */
  allowlist: ReadonlySet<string>
}

/** Feature switch variable per feature. */
export const FEATURE_SWITCH_VAR: Record<AiRolloutFeature, string> = {
  stylist_chat: 'AI_STYLIST_ENABLED',
  clothing_analysis: 'AI_VISION_ENABLED',
  outfit_explanation: 'AI_OUTFIT_AI_ENABLED',
}
const MAX_ALLOWLIST = 1000
const DIGEST = /^[0-9a-f]{64}$/

type Env = Record<string, string | undefined>

export const DEFAULT_LLM_TIMEOUT_MS = 25_000
/** Two attempts plus the retry wait stay well inside the 60 s route limit and the app's 70 s upload timeout. */
export const DEFAULT_VISION_TIMEOUT_MS = 15_000
export const DEFAULT_VISION_MAX_SIDE = 1024
const MIN_VISION_SIDE = 256
const MAX_VISION_SIDE = 2048
const MIN_TIMEOUT_MS = 1_000
/** Below the routes' 60 s maxDuration, so two attempts and a short wait still fit in most cases. */
const MAX_TIMEOUT_MS = 55_000
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/
const PROVIDERS = describeIds(PROVIDER_IDS)
const REAL_PROVIDERS = describeIds(PROVIDER_IDS.filter((id) => getProviderDescriptor(id).keyEnv !== null))

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

function price(env: Env, prefix: 'AI_LLM' | 'AI_VISION'): AiPrice | null {
  const inName = `${prefix}_PRICE_INPUT_USD_PER_MTOK`
  const outName = `${prefix}_PRICE_OUTPUT_USD_PER_MTOK`
  const i = value(env, inName)
  const o = value(env, outName)
  if (i === undefined && o === undefined) return null
  const parse = (name: string, raw: string | undefined) => {
    const n = Number(raw)
    if (raw === undefined || !Number.isFinite(n) || n < 0) {
      throw new ConfigError(`${name} must be a non-negative number (set both price variables or neither)`)
    }
    return n
  }
  return { inputUsdPerMTok: parse(inName, i), outputUsdPerMTok: parse(outName, o) }
}

function oneOf<T extends string>(env: Env, name: string, allowed: readonly T[], fallback: T): T {
  const raw = value(env, name)?.toLowerCase()
  if (raw === undefined) return fallback
  if (!(allowed as readonly string[]).includes(raw)) throw new ConfigError(`${name} must be one of: ${allowed.join(', ')}`)
  return raw as T
}

function maxSide(env: Env): number {
  const raw = value(env, 'AI_VISION_MAX_SIDE')
  if (raw === undefined) return DEFAULT_VISION_MAX_SIDE
  const n = Number(raw)
  if (!/^\d+$/.test(raw) || n < MIN_VISION_SIDE || n > MAX_VISION_SIDE) {
    throw new ConfigError(`AI_VISION_MAX_SIDE must be a whole number of pixels between ${MIN_VISION_SIDE} and ${MAX_VISION_SIDE}`)
  }
  return n
}

/** A boolean switch: true|false|1|0 (case-insensitive); missing → `fallback`; anything else is an error. */
function flag(env: Env, name: string, fallback: boolean): boolean {
  const raw = value(env, name)?.toLowerCase()
  if (raw === undefined) return fallback
  if (raw === 'true' || raw === '1') return true
  if (raw === 'false' || raw === '0') return false
  throw new ConfigError(`${name} must be true, false, 1 or 0`)
}

function rollout(env: Env, production: boolean): AiRolloutConfig {
  // Fail closed in production: a missing switch or percentage enables nothing.
  const features = Object.fromEntries(
    (Object.keys(FEATURE_SWITCH_VAR) as AiRolloutFeature[]).map((f) => [f, flag(env, FEATURE_SWITCH_VAR[f], !production)]),
  ) as Record<AiRolloutFeature, boolean>
  const rawPercent = value(env, 'AI_ROLLOUT_PERCENT')
  let percent = production ? 0 : 100
  if (rawPercent !== undefined) {
    if (!/^\d{1,3}$/.test(rawPercent) || Number(rawPercent) > 100) throw new ConfigError('AI_ROLLOUT_PERCENT must be a whole number between 0 and 100')
    percent = Number(rawPercent)
  }
  const entries = (value(env, 'AI_ROLLOUT_ALLOWLIST') ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
  // The message never echoes an entry.
  if (entries.some((e) => !DIGEST.test(e))) throw new ConfigError('AI_ROLLOUT_ALLOWLIST entries must be allowlist digests (64 hex characters), not raw ids')
  if (entries.length > MAX_ALLOWLIST) throw new ConfigError(`AI_ROLLOUT_ALLOWLIST may hold at most ${MAX_ALLOWLIST} entries`)
  return { features, percent, allowlist: new Set(entries) }
}

/** The key and model of a real provider, or a ConfigError naming what is missing. */
function credentials(env: Env, provider: Exclude<LlmProviderName, 'mock'>, role: 'AI_LLM' | 'AI_VISION' | 'AI_STYLIST' | 'AI_OUTFIT') {
  const keyVar = getProviderDescriptor(provider).keyEnv!
  const apiKey = value(env, keyVar)
  if (!apiKey) throw new ConfigError(`${keyVar} must be set when ${role}_PROVIDER=${provider}`)
  if (/\s/.test(apiKey)) throw new ConfigError(`${keyVar} must not contain whitespace`)
  const model = value(env, `${role}_MODEL`)
  if (!model) throw new ConfigError(`${role}_MODEL must be set when ${role}_PROVIDER=${provider}`)
  if (!MODEL_ID.test(model)) throw new ConfigError(`${role}_MODEL is not a valid model id`)
  return { apiKey, model }
}

/** A per-feature text route (AI_STYLIST_* / AI_OUTFIT_*): both variables or neither. */
function routeOverride(env: Env, prefix: 'AI_STYLIST' | 'AI_OUTFIT'): { provider: LlmProviderName; model: string; apiKey: string | null } | null {
  const rawProvider = value(env, `${prefix}_PROVIDER`)
  const rawModel = value(env, `${prefix}_MODEL`)
  if (rawProvider === undefined && rawModel === undefined) return null
  if (rawProvider === undefined || rawModel === undefined) {
    throw new ConfigError(`${prefix}_PROVIDER and ${prefix}_MODEL must be set together (or both left unset to use AI_LLM_PROVIDER)`)
  }
  const provider = normalizeProviderId(rawProvider) as LlmProviderName
  if (!PROVIDER_IDS.includes(provider)) throw new ConfigError(`${prefix}_PROVIDER must be ${PROVIDERS}`)
  if (!supportsCapability(getProviderDescriptor(provider), 'text')) throw new ConfigError(`${prefix}_PROVIDER=${provider} does not support text`)
  if (!MODEL_ID.test(rawModel)) throw new ConfigError(`${prefix}_MODEL is not a valid model id`)
  if (provider === 'mock') return { provider, model: 'mock', apiKey: null }
  return { provider, ...credentials(env, provider, prefix) }
}

/** AI_APPROVED_PROVIDERS, validated; the legacy set when unset. The message never echoes an entry. */
function approvedProviders(env: Env): ReadonlySet<string> {
  const raw = value(env, 'AI_APPROVED_PROVIDERS')
  if (raw === undefined) return new Set(LEGACY_APPROVED_PROVIDERS)
  const ids = raw.split(',').map(normalizeProviderId).filter(Boolean)
  if (ids.length === 0) throw new ConfigError('AI_APPROVED_PROVIDERS must list at least one provider (leave it unset for the default: gemini, openai)')
  if (ids.includes('mock')) throw new ConfigError('AI_APPROVED_PROVIDERS lists real providers only; the mock is governed by AI_ALLOW_MOCK_IN_PRODUCTION')
  if (ids.some((id) => !(PROVIDER_IDS as readonly string[]).includes(id))) {
    throw new ConfigError(`AI_APPROVED_PROVIDERS contains an unknown provider (registered: ${describeIds(PROVIDER_IDS.filter((id) => id !== 'mock'))})`)
  }
  return new Set(ids)
}

function assertApproved(approved: ReadonlySet<string>, provider: LlmProviderName, variable: string): void {
  if (provider !== 'mock' && !approved.has(provider)) throw new ConfigError(`${variable}=${provider} is not an approved provider (AI_APPROVED_PROVIDERS)`)
}

export function parseAiConfig(env: Env = process.env): AiConfig {
  const production = env.NODE_ENV === 'production'
  if (value(env, 'LLM_PROVIDER')) {
    throw new ConfigError('LLM_PROVIDER was removed (the Z.ai provider is gone); use AI_LLM_PROVIDER=mock|gemini|openai')
  }

  const approved = approvedProviders(env)
  const stylistRoute = routeOverride(env, 'AI_STYLIST')
  const outfitRoute = routeOverride(env, 'AI_OUTFIT')
  // AI_LLM_* serves every text feature without its own route.
  const legacyNeeded = !stylistRoute || !outfitRoute

  const rawLlm = value(env, 'AI_LLM_PROVIDER')?.toLowerCase()
  if (rawLlm === undefined && production && legacyNeeded) {
    throw new ConfigError(`AI_LLM_PROVIDER must be set in production (${REAL_PROVIDERS})`)
  }
  const llmProvider = (rawLlm ?? 'mock') as LlmProviderName
  if (!PROVIDER_IDS.includes(llmProvider)) throw new ConfigError(`AI_LLM_PROVIDER must be ${PROVIDERS}`)
  if (!supportsCapability(getProviderDescriptor(llmProvider), 'text')) throw new ConfigError(`AI_LLM_PROVIDER=${llmProvider} does not support text`)

  const rawVision = value(env, 'AI_VISION_PROVIDER')?.toLowerCase()
  if (rawVision === undefined && production) {
    throw new ConfigError(`AI_VISION_PROVIDER must be set in production (${REAL_PROVIDERS})`)
  }
  const visionProvider = (rawVision ?? 'mock') as VisionProviderName
  if (!PROVIDER_IDS.includes(visionProvider)) throw new ConfigError(`AI_VISION_PROVIDER must be ${PROVIDERS}`)
  if (!supportsCapability(getProviderDescriptor(visionProvider), 'vision')) throw new ConfigError(`AI_VISION_PROVIDER=${visionProvider} does not support vision`)

  let model = 'mock'
  let apiKey: string | null = null
  if (llmProvider !== 'mock') ({ apiKey, model } = credentials(env, llmProvider, 'AI_LLM'))
  let visionModel = 'mock'
  let visionKey: string | null = null
  if (visionProvider !== 'mock') ({ apiKey: visionKey, model: visionModel } = credentials(env, visionProvider, 'AI_VISION'))

  if (rawLlm !== undefined) assertApproved(approved, llmProvider, 'AI_LLM_PROVIDER')
  if (stylistRoute) assertApproved(approved, stylistRoute.provider, 'AI_STYLIST_PROVIDER')
  if (outfitRoute) assertApproved(approved, outfitRoute.provider, 'AI_OUTFIT_PROVIDER')
  assertApproved(approved, visionProvider, 'AI_VISION_PROVIDER')

  const llmTimeout = timeout(env, 'AI_LLM_TIMEOUT_MS', DEFAULT_LLM_TIMEOUT_MS)
  const llmPrice = price(env, 'AI_LLM')
  const route = (override: ReturnType<typeof routeOverride>, source: TextRouteSource): TextRouteConfig =>
    override
      ? {
          ...override,
          timeoutMs: llmTimeout,
          // The legacy price belongs to the legacy provider and model only: never misattributed.
          price: rawLlm !== undefined && override.provider === llmProvider && override.model === model ? llmPrice : null,
          source,
        }
      : { provider: llmProvider, model, apiKey, timeoutMs: llmTimeout, price: llmPrice, source: 'AI_LLM' }
  const text: Record<AiTextFeature, TextRouteConfig> = {
    stylist_chat: route(stylistRoute, 'AI_STYLIST'),
    outfit_explanation: route(outfitRoute, 'AI_OUTFIT'),
  }

  const usesMock = text.stylist_chat.provider === 'mock' || text.outfit_explanation.provider === 'mock' || visionProvider === 'mock'
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
      timeoutMs: llmTimeout,
      price: llmPrice,
    },
    vision: {
      provider: visionProvider,
      model: visionModel,
      apiKey: visionKey,
      timeoutMs: timeout(env, 'AI_VISION_TIMEOUT_MS', DEFAULT_VISION_TIMEOUT_MS),
      maxSide: maxSide(env),
      geminiMediaResolution: oneOf(env, 'AI_VISION_RESOLUTION', ['low', 'medium', 'high', 'ultra_high'] as const, 'high'),
      geminiThinkingLevel: oneOf(env, 'AI_VISION_GEMINI_THINKING_LEVEL', ['none', 'minimal', 'low', 'medium', 'high'] as const, 'low'),
      openaiDetail: oneOf(env, 'AI_VISION_DETAIL', ['low', 'high', 'auto'] as const, 'high'),
      price: price(env, 'AI_VISION'),
    },
    text,
    approvedProviders: approved,
    mockInProduction: production && usesMock,
    rollout: rollout(env, production),
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
