/**
 * Golden vectors of the AI monitoring events, the rollout and the quota day
 * for the Go backend (stage B6): what the real code (src/lib/ai/monitoring.ts,
 * rollout.ts, quota.ts) makes of an event, a user id, a moment.
 *
 *   bun scripts/golden-ai-monitoring.ts ../api/testdata/golden/ai-monitoring.json
 */
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { sanitizeAiEvent, setAiMonitoringSinks, recordAiQuota, recordAiRequest, AI_MONITORING_SCHEMA_VERSION, type AiMonitoringEvent } from '../src/lib/ai/monitoring'
import { AI_DAILY_LIMITS, quotaDay, secondsUntilNextQuotaDay } from '../src/lib/ai/quota'
import { allowlistDigest, decideAiEligibility, rolloutBucket } from '../src/lib/ai/rollout'

// ── Events: only known fields of the right kind survive ─────────────────────
const events: [string, AiMonitoringEvent][] = [
  ['a call, every field', { event: 'ai.call', feature: 'stylist_chat', provider: 'gemini', model: 'gemini-2.5-flash', outcome: 'ok', success: true, latencyMs: 812, attempts: 1, retried: false, retry: 'none', usageInput: 1234, usageOutput: 321, usageTotal: 1555, costUsd: 0.001173, environment: 'production', schemaVersion: 2 }],
  ['a failed call', { event: 'ai.call', feature: 'clothing_analysis', provider: 'openai', model: 'gpt-5.4-mini', outcome: 'rate_limited', success: false, errorCode: 'rate_limited', httpStatus: 429, latencyMs: 120, attempts: 2, retried: true, retry: 'failed' }],
  ['a request', { event: 'ai.request', feature: 'outfit_explanation', provider: 'gemini', model: 'm', outcome: 'fallback', reason: 'quota_exceeded', corrected: false, billable: false, latencyMs: 3 }],
  ['a quota decision', { event: 'ai.quota', feature: 'stylist_chat', provider: 'gemini', action: 'refunded', reason: 'provider_error' }],
  ['unknown fields are dropped', { event: 'ai.call', feature: 'stylist_chat', userId: 'cmabc', prompt: 'Salom', answer: 'x', itemId: 'W1', message: 'text', conversationId: 'c1' }],
  ['fields of another event are dropped', { event: 'ai.quota', feature: 'stylist_chat', latencyMs: 5, model: 'm', outcome: 'ok', billable: true }],
  ['a sentence where a code belongs', { event: 'ai.request', feature: 'stylist_chat', reason: 'the user asked about a red dress', outcome: 'ok' }],
  ['a code with capitals', { event: 'ai.request', feature: 'Stylist_Chat', provider: 'Gemini', outcome: 'OK' }],
  ['a code of 64 characters', { event: 'ai.request', reason: 'a'.repeat(64) }],
  ['a code of 65 characters', { event: 'ai.request', reason: 'a'.repeat(65) }],
  ['a code that starts with a dot', { event: 'ai.request', reason: '.hidden' }],
  ['codes with dots, colons and dashes', { event: 'ai.request', reason: 'http.429:rate-limited_x' }],
  ['an empty code', { event: 'ai.request', reason: '' }],
  ['a code with an email', { event: 'ai.request', reason: 'user@example.uz' }],
  ['a code with a URL', { event: 'ai.request', reason: 'https://example.uz/x' }],
  ['a model id', { event: 'ai.call', model: 'ft:gpt-5.4_Mini:Org-1' }],
  ['a model id with a space', { event: 'ai.call', model: 'gpt 5' }],
  ['a model id of 100 characters', { event: 'ai.call', model: 'm'.repeat(100) }],
  ['a model id of 101 characters', { event: 'ai.call', model: 'm'.repeat(101) }],
  ['numbers are rounded to a millionth', { event: 'ai.call', costUsd: 0.0000014999, latencyMs: 12.3456789, usageInput: 10.5 }],
  ['a number that rounds up at the half', { event: 'ai.call', costUsd: 0.0000005, latencyMs: 0.0000015 }],
  ['negative, infinite and non-numbers are dropped', { event: 'ai.call', latencyMs: -1, attempts: Infinity, usageInput: NaN, usageOutput: '5', httpStatus: null, costUsd: undefined }],
  ['zero stays', { event: 'ai.call', latencyMs: 0, attempts: 0, costUsd: 0 }],
  ['booleans must be booleans', { event: 'ai.call', success: 'true', retried: 1 }],
  ['a boolean where a code belongs', { event: 'ai.request', outcome: true, corrected: 'no', billable: false }],
  ['an event we do not know', { event: 'ai.secret' as never, feature: 'stylist_chat' }],
  ['schema version and environment', { event: 'ai.quota', environment: 'staging', schemaVersion: AI_MONITORING_SCHEMA_VERSION }],
  ['an environment that is no code', { event: 'ai.quota', environment: 'Production East' }],
]
const sanitized = events.map(([name, input]) => ({
  name,
  // NaN, Infinity and undefined do not survive JSON: they are written as names.
  input: Object.fromEntries(Object.entries(input).map(([k, v]) => [k, typeof v === 'number' && !Number.isFinite(v) ? { number: String(v) } : v === undefined ? { undefined: true } : v])),
  output: sanitizeAiEvent(input),
}))

// ── The typed helpers, as they reach a sink ─────────────────────────────────
const emitted: AiMonitoringEvent[] = []
setAiMonitoringSinks([{ emit: (e) => void emitted.push(e) }])
const helpers: { name: string; call: string; args: unknown; event: AiMonitoringEvent }[] = []
const record = (name: string, call: 'request' | 'quota', args: Record<string, unknown>) => {
  emitted.length = 0
  if (call === 'request') recordAiRequest(args as never)
  else recordAiQuota(args as never)
  helpers.push({ name, call, args, event: emitted[0] })
}
record('a request with a latency that rounds', 'request', { feature: 'stylist_chat', provider: 'gemini', model: 'm', outcome: 'ok', corrected: true, billable: true, latencyMs: 1234.5 })
record('a request with a negative latency', 'request', { feature: 'clothing_analysis', provider: 'openai', outcome: 'image_rejected', reason: 'undecodable', billable: false, latencyMs: -4 })
record('a request that needed no correction', 'request', { feature: 'stylist_chat', provider: 'openai', model: 'gpt-5.4-mini', outcome: 'ok', corrected: false, billable: true, latencyMs: 0.4 })
record('a request without a latency', 'request', { feature: 'outfit_explanation', provider: 'mock', outcome: 'disabled', reason: 'feature_disabled', billable: false })
record('a quota charge', 'quota', { feature: 'stylist_chat', provider: 'gemini', action: 'charged' })
record('a quota refund with its reason', 'quota', { feature: 'clothing_analysis', provider: 'openai', action: 'refunded', reason: 'invalid_output' })
setAiMonitoringSinks(null)

// ── Rollout: a stable bucket and an allowlist digest per user id ────────────
const ids = ['cmabc123', 'cmabc124', 'c' + 'x'.repeat(24), '', 'a', 'user with spaces', 'Ўзбек', '👗', ...Array.from({ length: 60 }, (_, i) => `cm${(i * 7919).toString(36)}user${i}`)]
const users = ids.map((id) => ({ id, bucket: rolloutBucket(id), digest: allowlistDigest(id) }))
const on = { stylist_chat: true, clothing_analysis: true, outfit_explanation: true }
const decisions: unknown[] = []
for (const id of ids.slice(0, 12)) {
  for (const [name, rollout] of [
    ['everything on, 100 %', { features: on, percent: 100, allowlist: new Set<string>() }],
    ['everything on, 0 %', { features: on, percent: 0, allowlist: new Set<string>() }],
    ['50 %', { features: on, percent: 50, allowlist: new Set<string>() }],
    ['1 %', { features: on, percent: 1, allowlist: new Set<string>() }],
    ['99 %', { features: on, percent: 99, allowlist: new Set<string>() }],
    ['0 %, this user allowlisted', { features: on, percent: 0, allowlist: new Set([allowlistDigest(id)]) }],
    ['0 %, another user allowlisted', { features: on, percent: 0, allowlist: new Set([allowlistDigest(id + 'x')]) }],
    ['the stylist off, this user allowlisted, 100 %', { features: { ...on, stylist_chat: false }, percent: 100, allowlist: new Set([allowlistDigest(id)]) }],
    ['only the stylist on, 100 %', { features: { stylist_chat: true, clothing_analysis: false, outfit_explanation: false }, percent: 100, allowlist: new Set<string>() }],
    ['only the garment analysis on, 100 %', { features: { stylist_chat: false, clothing_analysis: true, outfit_explanation: false }, percent: 100, allowlist: new Set<string>() }],
    ['only the outfit explanation on, 100 %', { features: { stylist_chat: false, clothing_analysis: false, outfit_explanation: true }, percent: 100, allowlist: new Set<string>() }],
  ] as const) {
    for (const feature of ['stylist_chat', 'clothing_analysis', 'outfit_explanation'] as const) {
      decisions.push({ id, rollout: { name, stylist: rollout.features.stylist_chat, vision: rollout.features.clothing_analysis, outfit: rollout.features.outfit_explanation, percent: rollout.percent, allowlist: [...rollout.allowlist] }, feature, ...decideAiEligibility(feature, id, rollout) })
    }
  }
}

// ── The quota day in Uzbekistan (UTC+5) ─────────────────────────────────────
const moments = [
  '2026-11-27T00:00:00.000Z', '2026-11-27T18:59:59.000Z', '2026-11-27T18:59:59.001Z', '2026-11-27T18:59:59.999Z', '2026-11-27T19:00:00.000Z',
  '2026-11-27T19:00:00.001Z', '2026-11-27T12:34:56.789Z', '2026-12-31T19:00:00.000Z', '2026-12-31T18:59:59.500Z', '2028-02-28T19:00:00.000Z',
  '2028-02-29T19:00:00.000Z', '2026-03-28T20:30:00.000Z',
].map((at) => ({ at, day: quotaDay(new Date(at)), secondsUntilNextDay: secondsUntilNextQuotaDay(new Date(at)) }))

const all = { sanitized, helpers, users, decisions, moments }
writeFileSync(
  process.argv[2],
  JSON.stringify({ generatedBy: 'apps/web/scripts/golden-ai-monitoring.ts', sourceCommit: execSync('git rev-parse HEAD').toString().trim(), note: 'The monitoring events, the rollout and the quota day of the Next.js AI code.', schemaVersion: AI_MONITORING_SCHEMA_VERSION, limits: AI_DAILY_LIMITS, ...all }, null, 1) + '\n',
)
console.log(Object.entries(all).map(([k, v]) => `${k}: ${v.length}`).join(', '))
