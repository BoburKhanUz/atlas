/**
 * Golden vectors of the AI configuration for the Go backend (stage B6): what
 * the real parser (src/lib/ai/config.ts, parseAiConfig) makes of an
 * environment, or the variable its refusal names.
 *
 *   bun scripts/golden-ai-config.ts ../api/testdata/golden/ai-config.json
 *
 * The keys in the cases are made up; a key's value is never written out
 * (only whether one was read).
 */
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { parseAiConfig, type AiConfig, type TextRouteConfig } from '../src/lib/ai/config'

type Env = Record<string, string>
const PROD: Env = { NODE_ENV: 'production' }
const G = 'fake-gemini-key'
const O = 'fake-openai-key'
const gemini: Env = { AI_LLM_PROVIDER: 'gemini', AI_LLM_MODEL: 'gemini-flash-test', GEMINI_API_KEY: G }
const openai: Env = { AI_LLM_PROVIDER: 'openai', AI_LLM_MODEL: 'gpt-test-mini', OPENAI_API_KEY: O }
const visionG: Env = { AI_VISION_PROVIDER: 'gemini', AI_VISION_MODEL: 'gemini-vision-test', GEMINI_API_KEY: G }
const visionO: Env = { AI_VISION_PROVIDER: 'openai', AI_VISION_MODEL: 'gpt-vision-test', OPENAI_API_KEY: O }
const real: Env = { ...gemini, ...visionO }
const digest = (c: string) => c.repeat(64)

const cases: [string, Env][] = [
  ['nothing set, outside production', {}],
  ['nothing set, production', PROD],
  ['production, mock acknowledged, nothing else', { ...PROD, AI_ALLOW_MOCK_IN_PRODUCTION: '1' }],
  ['production, both mocks named and acknowledged', { ...PROD, AI_LLM_PROVIDER: 'mock', AI_VISION_PROVIDER: 'mock', AI_ALLOW_MOCK_IN_PRODUCTION: '1' }],
  ['production, mocks named, not acknowledged', { ...PROD, AI_LLM_PROVIDER: 'mock', AI_VISION_PROVIDER: 'mock' }],
  ['production, acknowledgement is not 1', { ...PROD, AI_LLM_PROVIDER: 'mock', AI_VISION_PROVIDER: 'mock', AI_ALLOW_MOCK_IN_PRODUCTION: 'true' }],
  ['production, real text and vision', { ...PROD, ...real }],
  ['production, real text, mock vision', { ...PROD, ...gemini, AI_VISION_PROVIDER: 'mock' }],
  ['production, real text, mock vision acknowledged', { ...PROD, ...gemini, AI_VISION_PROVIDER: 'mock', AI_ALLOW_MOCK_IN_PRODUCTION: '1' }],
  ['production, real text, no vision provider', { ...PROD, ...gemini }],
  ['production, real vision, no text provider', { ...PROD, ...visionG }],
  ['production, text provider only through both routes', { ...PROD, ...visionO, AI_STYLIST_PROVIDER: 'gemini', AI_STYLIST_MODEL: 'g-stylist', AI_OUTFIT_PROVIDER: 'openai', AI_OUTFIT_MODEL: 'o-outfit', GEMINI_API_KEY: G }],
  ['production, one route only and no legacy provider', { ...PROD, ...visionO, AI_STYLIST_PROVIDER: 'openai', AI_STYLIST_MODEL: 'o-stylist' }],
  ['gemini text', gemini],
  ['openai text', openai],
  ['provider in capitals with spaces', { AI_LLM_PROVIDER: '  Gemini ', AI_LLM_MODEL: ' gemini-flash-test ', GEMINI_API_KEY: ` ${G} ` }],
  ['unknown text provider', { AI_LLM_PROVIDER: 'claude', AI_LLM_MODEL: 'x' }],
  ['unknown vision provider', { AI_VISION_PROVIDER: 'zai', AI_VISION_MODEL: 'x' }],
  ['the removed LLM_PROVIDER', { LLM_PROVIDER: 'zai' }],
  ['the removed LLM_PROVIDER, blank', { LLM_PROVIDER: '   ' }],
  ['gemini without a key', { AI_LLM_PROVIDER: 'gemini', AI_LLM_MODEL: 'm' }],
  ['gemini with the other provider\'s key only', { AI_LLM_PROVIDER: 'gemini', AI_LLM_MODEL: 'm', OPENAI_API_KEY: O }],
  ['a key with a space inside', { ...gemini, GEMINI_API_KEY: 'fake key' }],
  ['a key with a tab inside', { ...gemini, GEMINI_API_KEY: 'fake\tkey' }],
  ['gemini without a model', { AI_LLM_PROVIDER: 'gemini', GEMINI_API_KEY: G }],
  ['a model id that starts with a dash', { ...gemini, AI_LLM_MODEL: '-flash' }],
  ['a model id with a slash', { ...gemini, AI_LLM_MODEL: 'models/flash' }],
  ['a model id with a space', { ...gemini, AI_LLM_MODEL: 'gemini flash' }],
  ['a model id of 100 characters', { ...gemini, AI_LLM_MODEL: 'm'.repeat(100) }],
  ['a model id of 101 characters', { ...gemini, AI_LLM_MODEL: 'm'.repeat(101) }],
  ['a model id with dots, colons and dashes', { ...gemini, AI_LLM_MODEL: 'ft:gpt-5.4_mini:org-1' }],
  ['a model named for the mock is ignored', { AI_LLM_PROVIDER: 'mock', AI_LLM_MODEL: 'whatever model' }],
  ['vision gemini', visionG],
  ['vision openai', visionO],
  ['vision without a model', { AI_VISION_PROVIDER: 'openai', OPENAI_API_KEY: O }],
  ['vision without a key', { AI_VISION_PROVIDER: 'openai', AI_VISION_MODEL: 'm' }],
  ['text timeout at the least', { ...gemini, AI_LLM_TIMEOUT_MS: '1000' }],
  ['text timeout at the most', { ...gemini, AI_LLM_TIMEOUT_MS: '55000' }],
  ['text timeout below', { AI_LLM_TIMEOUT_MS: '999' }],
  ['text timeout above', { AI_LLM_TIMEOUT_MS: '55001' }],
  ['text timeout with a fraction', { AI_LLM_TIMEOUT_MS: '2000.5' }],
  ['text timeout negative', { AI_LLM_TIMEOUT_MS: '-2000' }],
  ['text timeout in words', { AI_LLM_TIMEOUT_MS: '25s' }],
  ['text timeout with leading zeros', { AI_LLM_TIMEOUT_MS: '0002000' }],
  ['text timeout too long a number', { AI_LLM_TIMEOUT_MS: '99999999999999999999' }],
  ['vision timeout', { AI_VISION_TIMEOUT_MS: '30000' }],
  ['vision timeout below', { AI_VISION_TIMEOUT_MS: '0' }],
  ['both text prices', { ...gemini, AI_LLM_PRICE_INPUT_USD_PER_MTOK: '0.3', AI_LLM_PRICE_OUTPUT_USD_PER_MTOK: '2.5' }],
  ['prices of zero', { AI_LLM_PRICE_INPUT_USD_PER_MTOK: '0', AI_LLM_PRICE_OUTPUT_USD_PER_MTOK: '0' }],
  ['prices as JavaScript reads numbers', { AI_LLM_PRICE_INPUT_USD_PER_MTOK: '1e-1', AI_LLM_PRICE_OUTPUT_USD_PER_MTOK: '0x10' }],
  ['only the input price', { AI_LLM_PRICE_INPUT_USD_PER_MTOK: '0.3' }],
  ['only the output price', { AI_LLM_PRICE_OUTPUT_USD_PER_MTOK: '2.5' }],
  ['a negative price', { AI_LLM_PRICE_INPUT_USD_PER_MTOK: '-1', AI_LLM_PRICE_OUTPUT_USD_PER_MTOK: '2' }],
  ['a price in words', { AI_LLM_PRICE_INPUT_USD_PER_MTOK: 'free', AI_LLM_PRICE_OUTPUT_USD_PER_MTOK: '2' }],
  ['an infinite price', { AI_LLM_PRICE_INPUT_USD_PER_MTOK: 'Infinity', AI_LLM_PRICE_OUTPUT_USD_PER_MTOK: '2' }],
  ['vision prices', { ...visionO, AI_VISION_PRICE_INPUT_USD_PER_MTOK: '0.75', AI_VISION_PRICE_OUTPUT_USD_PER_MTOK: '4.50' }],
  ['only one vision price', { AI_VISION_PRICE_OUTPUT_USD_PER_MTOK: '4.50' }],
  ['vision side at the least', { AI_VISION_MAX_SIDE: '256' }],
  ['vision side at the most', { AI_VISION_MAX_SIDE: '2048' }],
  ['vision side below', { AI_VISION_MAX_SIDE: '255' }],
  ['vision side above', { AI_VISION_MAX_SIDE: '2049' }],
  ['vision side with a fraction', { AI_VISION_MAX_SIDE: '1024.0' }],
  ['vision side in words', { AI_VISION_MAX_SIDE: 'large' }],
  ['vision resolution, detail and thinking', { AI_VISION_RESOLUTION: 'Ultra_High', AI_VISION_DETAIL: 'AUTO', AI_VISION_GEMINI_THINKING_LEVEL: 'none' }],
  ['unknown vision resolution', { AI_VISION_RESOLUTION: 'max' }],
  ['unknown vision detail', { AI_VISION_DETAIL: 'medium' }],
  ['unknown thinking level', { AI_VISION_GEMINI_THINKING_LEVEL: 'off' }],
  ['a stylist route beside the legacy provider', { ...gemini, AI_STYLIST_PROVIDER: 'openai', AI_STYLIST_MODEL: 'o-stylist', OPENAI_API_KEY: O }],
  ['an outfit route on the legacy provider and model keeps the price', { ...gemini, AI_OUTFIT_PROVIDER: 'gemini', AI_OUTFIT_MODEL: 'gemini-flash-test', AI_LLM_PRICE_INPUT_USD_PER_MTOK: '0.3', AI_LLM_PRICE_OUTPUT_USD_PER_MTOK: '2.5' }],
  ['an outfit route on the legacy provider and another model has no price', { ...gemini, AI_OUTFIT_PROVIDER: 'gemini', AI_OUTFIT_MODEL: 'gemini-pro-test', AI_LLM_PRICE_INPUT_USD_PER_MTOK: '0.3', AI_LLM_PRICE_OUTPUT_USD_PER_MTOK: '2.5' }],
  ['a route on the mock with the legacy provider unset keeps no price', { AI_STYLIST_PROVIDER: 'mock', AI_STYLIST_MODEL: 'mock', AI_LLM_PRICE_INPUT_USD_PER_MTOK: '1', AI_LLM_PRICE_OUTPUT_USD_PER_MTOK: '2' }],
  ['a mock route names any model', { AI_OUTFIT_PROVIDER: 'MOCK', AI_OUTFIT_MODEL: 'anything-1' }],
  ['a route provider without its model', { AI_STYLIST_PROVIDER: 'openai', OPENAI_API_KEY: O }],
  ['a route model without its provider', { AI_OUTFIT_MODEL: 'o-outfit' }],
  ['a route with an unknown provider', { AI_STYLIST_PROVIDER: 'claude', AI_STYLIST_MODEL: 'm' }],
  ['a route with a bad model id', { AI_STYLIST_PROVIDER: 'openai', AI_STYLIST_MODEL: 'bad model', OPENAI_API_KEY: O }],
  ['a route without its provider\'s key', { AI_OUTFIT_PROVIDER: 'gemini', AI_OUTFIT_MODEL: 'm' }],
  ['approved: only gemini, used', { ...gemini, AI_APPROVED_PROVIDERS: 'gemini' }],
  ['approved: only gemini, openai text', { ...openai, AI_APPROVED_PROVIDERS: 'gemini' }],
  ['approved: only gemini, openai vision', { ...visionO, AI_APPROVED_PROVIDERS: 'gemini' }],
  ['approved: only openai, gemini route', { ...openai, AI_APPROVED_PROVIDERS: 'openai', AI_STYLIST_PROVIDER: 'gemini', AI_STYLIST_MODEL: 'm', GEMINI_API_KEY: G }],
  ['approved: only openai, gemini outfit route', { ...openai, AI_APPROVED_PROVIDERS: 'openai', AI_OUTFIT_PROVIDER: 'gemini', AI_OUTFIT_MODEL: 'm', GEMINI_API_KEY: G }],
  ['a route keeps the text timeout that was set', { ...gemini, AI_LLM_TIMEOUT_MS: '40000', AI_STYLIST_PROVIDER: 'openai', AI_STYLIST_MODEL: 'o-stylist', OPENAI_API_KEY: O }],
  ['production, real vision, the mock named for text', { ...PROD, ...visionO, AI_LLM_PROVIDER: 'mock' }],
  ['production, real vision and text, one route on the mock', { ...PROD, ...real, AI_OUTFIT_PROVIDER: 'mock', AI_OUTFIT_MODEL: 'mock' }],
  ['production, real vision and text, one route on the mock, acknowledged', { ...PROD, ...real, AI_STYLIST_PROVIDER: 'mock', AI_STYLIST_MODEL: 'mock', AI_ALLOW_MOCK_IN_PRODUCTION: '1' }],
  ['approved: spaces, capitals, empty entries', { ...real, AI_APPROVED_PROVIDERS: ' OpenAI , ,gemini,' }],
  ['approved: nothing but commas', { AI_APPROVED_PROVIDERS: ' , ,' }],
  ['approved: the mock listed', { AI_APPROVED_PROVIDERS: 'gemini,mock' }],
  ['approved: an unknown provider', { AI_APPROVED_PROVIDERS: 'gemini,claude' }],
  ['approved: only gemini, mocks in use', { AI_APPROVED_PROVIDERS: 'gemini' }],
  ['switches off', { AI_STYLIST_ENABLED: 'false', AI_VISION_ENABLED: '0', AI_OUTFIT_AI_ENABLED: 'FALSE' }],
  ['switches on in production', { ...PROD, ...real, AI_STYLIST_ENABLED: 'true', AI_VISION_ENABLED: '1', AI_OUTFIT_AI_ENABLED: 'True' }],
  ['a switch that is neither', { AI_STYLIST_ENABLED: 'yes' }],
  ['another switch that is neither', { AI_OUTFIT_AI_ENABLED: 'on' }],
  ['rollout percent 0', { AI_ROLLOUT_PERCENT: '0' }],
  ['rollout percent 100', { AI_ROLLOUT_PERCENT: '100' }],
  ['rollout percent 37 in production', { ...PROD, ...real, AI_ROLLOUT_PERCENT: '37' }],
  ['rollout percent with leading zeros', { AI_ROLLOUT_PERCENT: '007' }],
  ['rollout percent 101', { AI_ROLLOUT_PERCENT: '101' }],
  ['rollout percent with a fraction', { AI_ROLLOUT_PERCENT: '12.5' }],
  ['rollout percent negative', { AI_ROLLOUT_PERCENT: '-1' }],
  ['rollout percent with a sign', { AI_ROLLOUT_PERCENT: '50%' }],
  ['rollout percent of four digits', { AI_ROLLOUT_PERCENT: '0100' }],
  ['allowlist of digests', { AI_ROLLOUT_ALLOWLIST: ` ${digest('a')}, ${digest('B')} ,,${digest('a')}` }],
  ['allowlist with a raw id', { AI_ROLLOUT_ALLOWLIST: `${digest('a')},cmabc123` }],
  ['allowlist with a short digest', { AI_ROLLOUT_ALLOWLIST: 'a'.repeat(63) }],
  ['allowlist with a non-hex digest', { AI_ROLLOUT_ALLOWLIST: 'g'.repeat(64) }],
  ['allowlist of a thousand', { AI_ROLLOUT_ALLOWLIST: Array.from({ length: 1000 }, (_, i) => i.toString(16).padStart(64, '0')).join(',') }],
  ['allowlist of a thousand and one', { AI_ROLLOUT_ALLOWLIST: Array.from({ length: 1001 }, (_, i) => i.toString(16).padStart(64, '0')).join(',') }],
  ['blank values are unset', { AI_LLM_PROVIDER: '  ', AI_VISION_MAX_SIDE: '', AI_ROLLOUT_PERCENT: ' ', AI_STYLIST_ENABLED: '\t' }],
]

const route = (r: TextRouteConfig) => ({ provider: r.provider, model: r.model, hasKey: r.apiKey !== null, timeoutMs: r.timeoutMs, price: r.price, source: r.source })
const shape = (c: AiConfig) => ({
  llm: { provider: c.llm.provider, model: c.llm.model, hasKey: c.llm.apiKey !== null, timeoutMs: c.llm.timeoutMs, price: c.llm.price },
  vision: {
    provider: c.vision.provider,
    model: c.vision.model,
    hasKey: c.vision.apiKey !== null,
    timeoutMs: c.vision.timeoutMs,
    maxSide: c.vision.maxSide,
    geminiMediaResolution: c.vision.geminiMediaResolution,
    geminiThinkingLevel: c.vision.geminiThinkingLevel,
    openaiDetail: c.vision.openaiDetail,
    price: c.vision.price,
  },
  stylist: route(c.text.stylist_chat),
  outfit: route(c.text.outfit_explanation),
  approvedProviders: [...c.approvedProviders].sort(),
  mockInProduction: c.mockInProduction,
  rollout: { stylist: c.rollout.features.stylist_chat, vision: c.rollout.features.clothing_analysis, outfit: c.rollout.features.outfit_explanation, percent: c.rollout.percent, allowlist: [...c.rollout.allowlist].sort() },
})

const out = cases.map(([name, env]) => {
  try {
    return { name, env, ok: true, config: shape(parseAiConfig(env)) }
  } catch (e) {
    const message = (e as Error).message
    // The variable the refusal names (the first name in capitals of four letters or more).
    const variable = /[A-Z][A-Z0-9_]{3,}/.exec(message)?.[0]
    if (!variable) throw new Error(`no variable in: ${message}`)
    return { name, env, ok: false, error: message, variable }
  }
})
if (new Set(out.map((c) => c.name)).size !== out.length) throw new Error('duplicate case names')

writeFileSync(
  process.argv[2],
  JSON.stringify({ generatedBy: 'apps/web/scripts/golden-ai-config.ts', sourceCommit: execSync('git rev-parse HEAD').toString().trim(), note: 'What parseAiConfig makes of an environment; made-up keys, never written out.', cases: out }, null, 1) + '\n',
)
console.log(`${out.length} cases, ${out.filter((c) => c.ok).length} accepted`)
