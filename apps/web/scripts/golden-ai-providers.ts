/**
 * Golden vectors of the AI provider layer for the Go backend (stage B6):
 * what the real adapters (src/lib/ai/providers) send for a request, what
 * they make of an answer, how failures are classified and retried, and the
 * fields of the monitoring's call record.
 *
 *   bun scripts/golden-ai-providers.ts ../api/testdata/golden/ai-providers.json
 *
 * No provider is called: `fetch` is a stand-in. The keys are made up.
 */
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { AiProviderError } from '../src/lib/ai/providers/errors'
import { GeminiProvider } from '../src/lib/ai/providers/gemini'
import { errorForStatus, parseRetryAfterMs } from '../src/lib/ai/providers/http'
import { MockProvider } from '../src/lib/ai/providers/mock'
import { OpenAIProvider } from '../src/lib/ai/providers/openai'
import { RetriedError, withRetry } from '../src/lib/ai/providers/retry'
import type { LLMRequest, VisionRequest } from '../src/lib/ai/providers/types'
import { assertVisionRequest } from '../src/lib/ai/providers/vision-input'
import { aiCallFields, type AiCallRecord } from '../src/lib/ai/telemetry'

const KEY = 'fake-provider-key'
type Sent = { url: string; headers: Record<string, string>; body: string }
let sent: Sent | null = null
let reply: { status: number; body: string; headers?: Record<string, string> } = { status: 200, body: '{}' }
const fetchStub = async (url: string, init: RequestInit) => {
  sent = {
    url,
    headers: Object.fromEntries(Object.entries(init.headers as Record<string, string>).map(([k, v]) => [k, v.replace(KEY, '<key>')])),
    body: String(init.body),
  }
  return new Response(reply.body, { status: reply.status, headers: reply.headers })
}
const providers = {
  gemini: (model: string) => new GeminiProvider({ apiKey: KEY, model, fetch: fetchStub }),
  openai: (model: string) => new OpenAIProvider({ apiKey: KEY, model, fetch: fetchStub }),
}
type ProviderName = keyof typeof providers

const failure = (e: unknown) => {
  if (e instanceof AiProviderError) return { kind: e.kind, status: e.status ?? null, retryAfterMs: e.retryAfterMs ?? null, message: e.message }
  // Not one of ours: a JavaScript error of the adapter itself (the Go adapters answer malformed_response).
  return { thrown: (e as Error).name }
}

// ── What is sent ─────────────────────────────────────────────────────────────
const schema = { name: 'stylist_answer', schema: { type: 'object', properties: { answer: { type: 'string', maxLength: 1500 }, needsMoreInfo: { type: 'boolean' } }, required: ['answer', 'needsMoreInfo'], additionalProperties: false } }
const textRequests: [string, Omit<LLMRequest, 'timeoutMs'>][] = [
  ['one user message', { messages: [{ role: 'user', content: 'Salom' }] }],
  ['system, then user', { messages: [{ role: 'system', content: 'Sen stilistsan.' }, { role: 'user', content: 'Bugun nima kiyay?' }] }],
  ['two leading system messages', { messages: [{ role: 'system', content: 'Birinchi qoida.' }, { role: 'system', content: 'Ikkinchi qoida.' }, { role: 'user', content: 'Savol' }] }],
  ['a conversation', { messages: [{ role: 'system', content: 'S' }, { role: 'user', content: 'Q1' }, { role: 'assistant', content: 'A1' }, { role: 'user', content: 'Q2' }] }],
  ['a correction after the answer (system in the middle)', { messages: [{ role: 'system', content: 'S' }, { role: 'user', content: 'Q' }, { role: 'assistant', content: '{"answer":"[W9]"}' }, { role: 'system', content: 'W9 yo‘q. Qayta yoz.' }] }],
  ['temperature and a token limit', { messages: [{ role: 'user', content: 'Q' }], temperature: 0.7, maxOutputTokens: 600 }],
  ['temperature zero', { messages: [{ role: 'user', content: 'Q' }], temperature: 0, maxOutputTokens: 400 }],
  ['a schema', { messages: [{ role: 'system', content: 'S' }, { role: 'user', content: 'Q' }], temperature: 0.3, maxOutputTokens: 400, jsonSchema: schema }],
  ['text that needs escaping', { messages: [{ role: 'user', content: 'Qator\n"qo‘shtirnoq" \\ <b>&amp;</b> \t emoji 👗 o‘zbek ʻ ’' }] }],
  ['only system messages', { messages: [{ role: 'system', content: 'S' }] }],
  ['no messages', { messages: [] }],
]
const okText = {
  gemini: JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"answer":"Yaxshi","needsMoreInfo":false}' }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 } }),
  openai: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"answer":"Yaxshi","needsMoreInfo":false}' } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }),
}
const models: Record<ProviderName, string[]> = { gemini: ['gemini-flash-test', 'tuned:model_1.0'], openai: ['gpt-4.1-mini-test', 'gpt-5.4-mini', 'GPT-6', 'o3-mini', 'ogpt-5'] }
const text: unknown[] = []
for (const name of Object.keys(providers) as ProviderName[]) {
  for (const model of models[name]) {
    for (const [title, request] of textRequests) {
      sent = null
      reply = { status: 200, body: okText[name] }
      let outcome: unknown
      try {
        const r = await providers[name](model).generate({ ...request, timeoutMs: 5000 })
        outcome = { ok: true, text: r.text, metadata: r.metadata }
      } catch (e) {
        outcome = { ok: false, ...failure(e) }
      }
      text.push({ name: `${name} ${model}: ${title}`, provider: name, model, request, reply: okText[name], sent, outcome })
    }
  }
}

const image = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 250, 251, 252])
const visionSchema = { name: 'garment_analysis', schema: { type: 'object', properties: { subject: { type: 'string', enum: ['single_garment', 'not_garment'] } }, required: ['subject'] } }
const visionRequests: [string, Omit<VisionRequest, 'timeoutMs' | 'image'> & { image?: Uint8Array }][] = [
  ['with a schema and every option', { mimeType: 'image/jpeg', maxSide: 1024, instruction: 'Kiyimni tahlil qil.', jsonSchema: visionSchema, maxOutputTokens: 1024, options: { geminiMediaResolution: 'high', geminiThinkingLevel: 'low', openaiDetail: 'high' } }],
  ['no schema, no options', { mimeType: 'image/png', maxSide: 512, instruction: 'Nima bu?' }],
  ['thinking none, ultra high, detail low', { mimeType: 'image/webp', maxSide: 2048, instruction: 'I', jsonSchema: visionSchema, options: { geminiMediaResolution: 'ultra_high', geminiThinkingLevel: 'none', openaiDetail: 'low' } }],
  ['thinking only', { mimeType: 'image/jpeg', maxSide: 1, instruction: 'I', options: { geminiThinkingLevel: 'minimal' } }],
  ['an image type we do not send', { mimeType: 'image/gif' as never, maxSide: 1024, instruction: 'I' }],
  ['an empty image', { mimeType: 'image/jpeg', maxSide: 1024, instruction: 'I', image: new Uint8Array() }],
  ['an image over four megabytes', { mimeType: 'image/jpeg', maxSide: 1024, instruction: 'I', image: new Uint8Array(4 * 1024 * 1024 + 1) }],
  ['an image of exactly four megabytes', { mimeType: 'image/jpeg', maxSide: 1024, instruction: 'I', image: new Uint8Array(4 * 1024 * 1024) }],
  ['a side of zero', { mimeType: 'image/jpeg', maxSide: 0, instruction: 'I' }],
  ['a side over the limit', { mimeType: 'image/jpeg', maxSide: 2049, instruction: 'I' }],
  ['a side with a fraction', { mimeType: 'image/jpeg', maxSide: 512.5, instruction: 'I' }],
  ['a blank instruction', { mimeType: 'image/jpeg', maxSide: 1024, instruction: '  \n' }],
]
const okVision = {
  gemini: JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"subject":"single_garment"}' }] } }], usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 40, thoughtsTokenCount: 25, totalTokenCount: 1265 } }),
  openai: JSON.stringify({ choices: [{ message: { content: '{"subject":"single_garment"}' } }], usage: { prompt_tokens: 900, completion_tokens: 40, total_tokens: 940 } }),
}
const vision: unknown[] = []
for (const name of [...(Object.keys(providers) as ProviderName[]), 'mock' as const]) {
  for (const [title, request] of visionRequests) {
    sent = null
    const bytes = request.image ?? image
    let outcome: unknown
    try {
      const provider = name === 'mock' ? new MockProvider() : providers[name](name === 'gemini' ? 'gemini-vision-test' : 'gpt-vision-test')
      if (name !== 'mock') reply = { status: 200, body: okVision[name] }
      const r = await provider.analyzeImage({ ...request, image: bytes, timeoutMs: 5000 })
      outcome = { ok: true, output: r.output, metadata: r.metadata }
    } catch (e) {
      outcome = { ok: false, ...failure(e) }
    }
    // Large images are named by their length, not written out.
    const big = bytes.byteLength > 64
    const shown = sent && big ? { ...(sent as Sent), body: `<${(sent as Sent).body.length} characters>` } : sent
    vision.push({ name: `${name}: ${title}`, provider: name, request: { ...request, image: undefined }, imageBytes: big ? null : Array.from(bytes), imageLength: bytes.byteLength, reply: name === 'mock' ? null : okVision[name], sent: shown, outcome })
  }
}
const mockText: unknown[] = []
for (const [title, request] of textRequests.slice(0, 1).concat(textRequests.slice(7, 8))) {
  const r = await new MockProvider().generate({ ...request, timeoutMs: 1 })
  mockText.push({ name: `mock: ${title}`, request, outcome: { ok: true, text: r.text, metadata: r.metadata } })
}

// ── What is made of an answer ────────────────────────────────────────────────
const g = (candidate: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({ candidates: [candidate], ...extra })
const o = (choice: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({ choices: [choice], ...extra })
const answers: [ProviderName, string, number, string, Record<string, string>?][] = [
  ['gemini', 'plain text', 200, g({ finishReason: 'STOP', content: { parts: [{ text: 'Salom' }] } })],
  ['gemini', 'several parts are joined, thoughts dropped', 200, g({ content: { parts: [{ text: 'A', thought: true }, { text: 'B' }, { text: 'C', thought: false }, { inlineData: {} }, { text: 5 }] } })],
  ['gemini', 'usage with thoughts', 200, g({ content: { parts: [{ text: 'x' }] } }, { usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3, thoughtsTokenCount: 11, totalTokenCount: 21 } })],
  ['gemini', 'usage with thoughts only', 200, g({ content: { parts: [{ text: 'x' }] } }, { usageMetadata: { thoughtsTokenCount: 4 } })],
  ['gemini', 'usage of the wrong types', 200, g({ content: { parts: [{ text: 'x' }] } }, { usageMetadata: { promptTokenCount: '7', candidatesTokenCount: -1, totalTokenCount: 1.5 } })],
  ['gemini', 'usage that is no object', 200, g({ content: { parts: [{ text: 'x' }] } }, { usageMetadata: 'none' })],
  ['gemini', 'blocked prompt', 200, JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } })],
  ['gemini', 'block reason empty is no block', 200, g({ content: { parts: [{ text: 'x' }] } }, { promptFeedback: { blockReason: '' } })],
  ...['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY', 'LANGUAGE', 'MAX_TOKENS', 'OTHER', 'safety'].map(
    (reason): [ProviderName, string, number, string] => ['gemini', `finish reason ${reason}`, 200, g({ finishReason: reason, content: { parts: [{ text: 'x' }] } })],
  ),
  ['gemini', 'no candidates', 200, '{}'],
  ['gemini', 'candidates empty', 200, '{"candidates":[]}'],
  ['gemini', 'candidates not a list', 200, '{"candidates":{"0":{}}}'],
  ['gemini', 'candidate null', 200, '{"candidates":[null]}'],
  ['gemini', 'candidate zero', 200, '{"candidates":[0]}'],
  ['gemini', 'candidate false', 200, '{"candidates":[false]}'],
  ['gemini', 'candidate an empty text', 200, '{"candidates":[""]}'],
  ['gemini', 'candidate a number', 200, '{"candidates":[7]}'],
  ['gemini', 'candidate a text', 200, '{"candidates":["x"]}'],
  ['gemini', 'block reason zero is no block', 200, g({ content: { parts: [{ text: 'x' }] } }, { promptFeedback: { blockReason: 0 } })],
  ['gemini', 'block reason a number is a block', 200, g({ content: { parts: [{ text: 'x' }] } }, { promptFeedback: { blockReason: 3 } })],
  ['gemini', 'block reason false is no block', 200, g({ content: { parts: [{ text: 'x' }] } }, { promptFeedback: { blockReason: false } })],
  ['gemini', 'block reason an object is a block', 200, g({ content: { parts: [{ text: 'x' }] } }, { promptFeedback: { blockReason: {} } })],
  ['gemini', 'candidate without content', 200, g({ finishReason: 'STOP' })],
  ['gemini', 'parts not a list', 200, g({ content: { parts: 'text' } })],
  ['gemini', 'only white space', 200, g({ content: { parts: [{ text: ' \n\t ' }] } })],
  ['gemini', 'only a thought', 200, g({ content: { parts: [{ text: 'thinking', thought: true }] } })],
  ['gemini', 'a part that is null', 200, g({ content: { parts: [null, { text: 'x' }] } })],
  ['gemini', 'the answer is a list', 200, '[]'],
  ['gemini', 'the answer is null', 200, 'null'],
  ['gemini', 'the answer is a number', 200, '7'],
  ['gemini', 'the answer is not JSON', 200, '<html>busy</html>'],
  ['gemini', 'the answer is empty', 200, ''],
  ['openai', 'plain text', 200, o({ finish_reason: 'stop', message: { content: 'Salom' } }, { usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } })],
  ['openai', 'usage of the wrong types', 200, o({ message: { content: 'x' } }, { usage: { prompt_tokens: null, completion_tokens: '2', total_tokens: -5 } })],
  ['openai', 'content filter', 200, o({ finish_reason: 'content_filter', message: { content: 'x' } })],
  ['openai', 'a refusal', 200, o({ finish_reason: 'stop', message: { content: null, refusal: 'I cannot help with that.' } })],
  ['openai', 'an empty refusal is no refusal', 200, o({ message: { content: 'x', refusal: '' } })],
  ['openai', 'a refusal that is no text', 200, o({ message: { content: 'x', refusal: true } })],
  ['openai', 'length finish with text', 200, o({ finish_reason: 'length', message: { content: 'cut' } })],
  ['openai', 'no choices', 200, '{}'],
  ['openai', 'choices empty', 200, '{"choices":[]}'],
  ['openai', 'choices not a list', 200, '{"choices":"x"}'],
  ['openai', 'choice null', 200, '{"choices":[null]}'],
  ['openai', 'choice zero', 200, '{"choices":[0]}'],
  ['openai', 'choice a number', 200, '{"choices":[7]}'],
  ['openai', 'choice an empty text', 200, '{"choices":[""]}'],
  ['openai', 'no message', 200, o({ finish_reason: 'stop' })],
  ['openai', 'message null', 200, o({ message: null })],
  ['openai', 'content null', 200, o({ message: { content: null } })],
  ['openai', 'content a list', 200, o({ message: { content: [{ type: 'text', text: 'x' }] } })],
  ['openai', 'only white space', 200, o({ message: { content: '  \n' } })],
  ['openai', 'the answer is a list', 200, '[1]'],
  ['openai', 'the answer is not JSON', 200, 'Bad gateway'],
  ...[201, 204, 301, 400, 401, 403, 404, 408, 409, 413, 422, 429, 500, 501, 502, 503, 504, 529, 599].map(
    (status): [ProviderName, string, number, string] => ['openai', `status ${status}`, status, JSON.stringify({ error: { message: 'secret prompt echoed here' } })],
  ),
  ['gemini', 'status 429 with seconds to wait', 429, '{}', { 'retry-after': '2' }],
  ['gemini', 'status 429 with a long wait', 429, '{}', { 'retry-after': '120' }],
  ['gemini', 'status 429 with words', 429, '{}', { 'retry-after': 'soon' }],
  ['gemini', 'status 503 with a wait is not a rate limit', 503, '{}', { 'retry-after': '1' }],
]
const made: unknown[] = []
for (const [name, title, status, body, headers] of answers) {
  // 204 and 304 carry no body.
  reply = { status, body: status === 204 ? (null as never) : body, headers }
  let outcome: unknown
  try {
    const r = await providers[name](models[name][0]).generate({ messages: [{ role: 'user', content: 'Q' }], timeoutMs: 5000 })
    outcome = { ok: true, text: r.text, metadata: r.metadata }
  } catch (e) {
    outcome = { ok: false, ...failure(e) }
  }
  made.push({ name: `${name}: ${title}`, provider: name, status, body, headers: headers ?? null, outcome })
}
// Structured answers: the text must be JSON; what is returned is its JSON again.
const structured: unknown[] = []
for (const output of ['{"answer":"a","needsMoreInfo":false}', ' {"a" : 1.0, "b":[1,2 ] }\n', '{"a":1e3,"b":"\\u0041"}', 'not json', '{"a":1,}', '"just text"', '12', 'null', '']) {
  for (const name of Object.keys(providers) as ProviderName[]) {
    reply = { status: 200, body: name === 'gemini' ? g({ content: { parts: [{ text: output }] } }) : o({ message: { content: output } }) }
    let outcome: unknown
    try {
      const r = await providers[name](models[name][0]).generate({ messages: [{ role: 'user', content: 'Q' }], jsonSchema: schema, timeoutMs: 5000 })
      outcome = { ok: true, text: r.text }
    } catch (e) {
      outcome = { ok: false, ...failure(e) }
    }
    structured.push({ name: `${name}: ${JSON.stringify(output)}`, provider: name, output, outcome })
  }
}

// ── Statuses, Retry-After, retries ──────────────────────────────────────────
const statuses: unknown[] = []
for (let status = 100; status <= 599; status++) {
  const e = errorForStatus('p', status, null)
  statuses.push({ status, kind: e.kind })
}
const NOW = Date.UTC(2026, 10, 27, 10, 0, 0)
// Seconds, or a date (RFC 9110). What Date.parse makes of other text ('1.5', '-1', '+2') differs between JavaScript
// engines and is left out: the Go server takes such a value for no value.
const retryAfter = [null, '', ' ', '0', '1', '3', '59', '60', '61', '86400', ' 5 ', '5s', 'Fri, 27 Nov 2026 10:00:02 GMT', 'Fri, 27 Nov 2026 09:59:00 GMT', 'Fri, 27 Nov 2026 11:00:00 GMT', '2026-11-27T10:00:30Z', 'tomorrow'].map(
  (value) => ({ value, ms: parseRetryAfterMs(value, NOW) ?? null }),
)

type Step = { kind: string; retryAfterMs?: number } | 'ok' | 'not ours'
const retryCases: [string, Step[], number][] = [
  ['succeeds at once', ['ok'], 0],
  ['a timeout, then succeeds', [{ kind: 'timeout' }, 'ok'], 0],
  ['a network error, then succeeds', [{ kind: 'network' }, 'ok'], 0.5],
  ['unavailable, then succeeds', [{ kind: 'unavailable' }, 'ok'], 0.999],
  ['rate limited without a wait, then succeeds', [{ kind: 'rate_limited' }, 'ok'], 0.25],
  ['rate limited with a short wait', [{ kind: 'rate_limited', retryAfterMs: 2000 }, 'ok'], 0.9],
  ['rate limited with a wait of exactly three seconds', [{ kind: 'rate_limited', retryAfterMs: 3000 }, 'ok'], 0],
  ['rate limited with a wait too long', [{ kind: 'rate_limited', retryAfterMs: 3001 }, 'ok'], 0],
  ['rate limited with a wait of zero', [{ kind: 'rate_limited', retryAfterMs: 0 }, 'ok'], 0.7],
  ['two timeouts', [{ kind: 'timeout' }, { kind: 'timeout' }, 'ok'], 0],
  ['a timeout, then a refusal', [{ kind: 'unavailable' }, { kind: 'auth' }], 0],
  ...['auth', 'config', 'invalid_request', 'malformed_response', 'content_filtered', 'cancelled', 'provider_error'].map((kind): [string, Step[], number] => [`${kind} is not tried again`, [{ kind }, 'ok'], 0]),
  ['an error that is not ours is not tried again', ['not ours', 'ok'], 0],
]
const retries: unknown[] = []
for (const [title, steps, random] of retryCases) {
  const sleeps: number[] = []
  let i = 0
  let outcome: unknown
  try {
    const r = await withRetry(
      async () => {
        const step = steps[i++]
        if (step === 'ok') return 'value'
        if (step === 'not ours') throw new TypeError('boom')
        throw new AiProviderError(step.kind as never, 'p', { retryAfterMs: step.retryAfterMs })
      },
      { sleep: async (ms) => void sleeps.push(ms), random: () => random },
    )
    outcome = { ok: true, attempts: r.attempts }
  } catch (e) {
    const last = (e as RetriedError).lastError
    outcome = { ok: false, attempts: (e as RetriedError).attempts, kind: last instanceof AiProviderError ? last.kind : 'not ours' }
  }
  retries.push({ name: title, steps, random, sleeps, outcome })
}

// ── The call record of the monitoring ───────────────────────────────────────
const price = { inputUsdPerMTok: 0.3, outputUsdPerMTok: 2.5 }
const records: [string, AiCallRecord][] = [
  ['ok, first attempt, priced', { feature: 'stylist_chat', provider: 'gemini', model: 'm', outcome: 'ok', latencyMs: 812.6, attempts: 1, usage: { inputTokens: 1234, outputTokens: 321, totalTokens: 1555 }, price }],
  ['ok after a retry, no price', { feature: 'outfit_explanation', provider: 'openai', model: 'm', outcome: 'ok', latencyMs: 2500.4, attempts: 2, usage: { inputTokens: 10, outputTokens: 20 }, price: null }],
  ['ok, usage without output tokens, priced', { feature: 'clothing_analysis', provider: 'gemini', model: 'm', outcome: 'ok', latencyMs: 0.4, attempts: 1, usage: { inputTokens: 10 }, price }],
  ['ok, no usage', { feature: 'clothing_analysis', provider: 'mock', model: 'mock', outcome: 'ok', latencyMs: -3, attempts: 1, usage: {}, price }],
  ['a tiny cost', { feature: 'stylist_chat', provider: 'gemini', model: 'm', outcome: 'ok', latencyMs: 1, attempts: 1, usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 }, price }],
  ['a cost that rounds at the sixth decimal', { feature: 'stylist_chat', provider: 'gemini', model: 'm', outcome: 'ok', latencyMs: 1.5, attempts: 1, usage: { inputTokens: 5, outputTokens: 1 }, price: { inputUsdPerMTok: 0.1, outputUsdPerMTok: 0 } }],
  ['a timeout after two attempts', { feature: 'stylist_chat', provider: 'gemini', model: 'm', outcome: 'timeout', latencyMs: 50123.5, attempts: 2 }],
  ['rate limited with its status', { feature: 'clothing_analysis', provider: 'openai', model: 'm', outcome: 'rate_limited', latencyMs: 120, attempts: 1, httpStatus: 429 }],
  ['an error that is not ours', { feature: 'outfit_explanation', provider: 'openai', model: 'm', outcome: 'error', latencyMs: 2.5, attempts: 1 }],
]
const calls = records.map(([name, record]) => ({ name, record, fields: aiCallFields(record) }))

const visionChecks = visionRequests.map(([title, request]) => {
  let problem: string | null = null
  try {
    assertVisionRequest('p', { ...request, image: request.image ?? image, timeoutMs: 1 })
  } catch (e) {
    problem = (e as Error).message
  }
  return { name: title, mimeType: request.mimeType, maxSide: request.maxSide, instruction: request.instruction, imageLength: (request.image ?? image).byteLength, problem }
})

const all = { text, vision, mockText, made, structured, statuses, retryAfter: { now: NOW, cases: retryAfter }, retries, calls, visionChecks }
writeFileSync(
  process.argv[2],
  JSON.stringify({ generatedBy: 'apps/web/scripts/golden-ai-providers.ts', sourceCommit: execSync('git rev-parse HEAD').toString().trim(), note: 'The provider adapters against a stand-in fetch; made-up keys, written as <key>.', ...all }, null, 1) + '\n',
)
console.log(Object.entries(all).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.length : (v as { cases: unknown[] }).cases.length}`).join(', '))
