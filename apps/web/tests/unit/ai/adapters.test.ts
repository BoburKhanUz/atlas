import { describe, expect, it } from 'vitest'
import { AiProviderError } from '@/lib/ai/providers/errors'
import { GeminiProvider } from '@/lib/ai/providers/gemini'
import { MOCK_LLM_TEXT, MockProvider } from '@/lib/ai/providers/mock'
import { OpenAIProvider } from '@/lib/ai/providers/openai'
import type { LLMRequest, VisionRequest } from '@/lib/ai/providers/types'
import { fakeFetch, type Reply } from './fake-fetch'

const KEY = 'test-key-not-real-0123456789'
const req = (extra: Partial<LLMRequest> = {}): LLMRequest => ({
  messages: [
    { role: 'system', content: 'S1' },
    { role: 'system', content: 'S2' },
    { role: 'user', content: 'U1' },
    { role: 'assistant', content: 'A1' },
    { role: 'user', content: 'U2' },
  ],
  temperature: 0.7,
  maxOutputTokens: 600,
  timeoutMs: 1000,
  ...extra,
})
const vision = (extra: Partial<VisionRequest> = {}): VisionRequest => ({
  image: new Uint8Array([1, 2, 3]),
  mimeType: 'image/jpeg',
  maxSide: 1024,
  instruction: 'Describe',
  jsonSchema: { name: 'garment', schema: { type: 'object' } },
  timeoutMs: 1000,
  ...extra,
})
const fail = async (p: Promise<unknown>) => (await p.then(() => null, (e) => e)) as AiProviderError

const geminiOk = (text: string, extra: Record<string, unknown> = {}): Reply => ({
  status: 200,
  json: {
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'thinking…', thought: true }, { text }] } }],
    usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30, totalTokenCount: 150 },
    ...extra,
  },
})
const openaiOk = (content: string, extra: Record<string, unknown> = {}): Reply => ({
  status: 200,
  json: { choices: [{ finish_reason: 'stop', message: { content }, ...extra }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } },
})

describe('Gemini REST adapter', () => {
  const make = (replies: Reply[], model = 'gemini-test') => {
    const f = fakeFetch(replies)
    return { p: new GeminiProvider({ apiKey: KEY, model, fetch: f.fetch }), calls: f.calls }
  }

  it('maps messages: system → systemInstruction, assistant → model; key in a header, not the URL', async () => {
    const { p, calls } = make([geminiOk('Salom')])
    const r = await p.generate(req())
    expect(r.text).toBe('Salom') // thought parts are excluded
    expect(r.metadata).toEqual({ provider: 'gemini', model: 'gemini-test', usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150 } })
    const c = calls[0]
    expect(c.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent')
    expect(c.url).not.toContain(KEY)
    expect(c.headers['x-goog-api-key']).toBe(KEY)
    expect(c.body.systemInstruction).toEqual({ parts: [{ text: 'S1\n\nS2' }] })
    expect(c.body.contents).toEqual([
      { role: 'user', parts: [{ text: 'U1' }] },
      { role: 'model', parts: [{ text: 'A1' }] },
      { role: 'user', parts: [{ text: 'U2' }] },
    ])
    expect(c.body.generationConfig).toEqual({ temperature: 0.7, maxOutputTokens: 600 })
  })

  it('structured output: JSON schema in generationConfig; invalid JSON is malformed', async () => {
    const schema = { type: 'object', properties: { a: { type: 'string' } } }
    const { p, calls } = make([geminiOk('{"a":"x"}'), geminiOk('not json')])
    expect(JSON.parse((await p.generate(req({ jsonSchema: { name: 's', schema } }))).text)).toEqual({ a: 'x' })
    expect(calls[0].body.generationConfig).toMatchObject({ responseMimeType: 'application/json', responseJsonSchema: schema })
    expect((await fail(p.generate(req({ jsonSchema: { name: 's', schema } })))).kind).toBe('malformed_response')
  })

  it('blocked prompts and filtered candidates are content_filtered', async () => {
    const blocked = make([{ status: 200, json: { promptFeedback: { blockReason: 'SAFETY' } } }])
    expect((await fail(blocked.p.generate(req()))).kind).toBe('content_filtered')
    const filtered = make([geminiOk('x', { candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] })])
    expect((await fail(filtered.p.generate(req()))).kind).toBe('content_filtered')
  })

  it('no candidate or empty text is malformed', async () => {
    expect((await fail(make([{ status: 200, json: { candidates: [] } }]).p.generate(req()))).kind).toBe('malformed_response')
    expect((await fail(make([geminiOk('   ')]).p.generate(req()))).kind).toBe('malformed_response')
  })

  it('model ids are URL-encoded', async () => {
    const { p, calls } = make([geminiOk('x')], 'a/b')
    await p.generate(req())
    expect(calls[0].url).toContain('/models/a%2Fb:generateContent')
  })

  it('vision: inline base64 image + instruction, JSON output parsed', async () => {
    const { p, calls } = make([geminiOk('{"category":"shirt"}')])
    const r = await p.analyzeImage(vision())
    expect(r.output).toEqual({ category: 'shirt' })
    expect(calls[0].body.contents).toEqual([
      { role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data: 'AQID' } }, { text: 'Describe' }] },
    ])
  })

  it('no API key → config error at construction', () => {
    expect(() => new GeminiProvider({ apiKey: '', model: 'm' })).toThrow(/config/)
  })
})

describe('OpenAI REST adapter', () => {
  const make = (replies: Reply[], model = 'gpt-4o-mini') => {
    const f = fakeFetch(replies)
    return { p: new OpenAIProvider({ apiKey: KEY, model, fetch: f.fetch }), calls: f.calls }
  }

  it('chat completions with Bearer auth, max_completion_tokens, store:false', async () => {
    const { p, calls } = make([openaiOk('Salom')])
    const r = await p.generate(req())
    expect(r.text).toBe('Salom')
    expect(r.metadata).toEqual({ provider: 'openai', model: 'gpt-4o-mini', usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } })
    const c = calls[0]
    expect(c.url).toBe('https://api.openai.com/v1/chat/completions')
    expect(c.headers.authorization).toBe(`Bearer ${KEY}`)
    expect(c.body).toMatchObject({ model: 'gpt-4o-mini', temperature: 0.7, max_completion_tokens: 600, store: false })
    expect(c.body.messages).toEqual(req().messages)
  })

  it.each(['gpt-5-mini', 'gpt-5.4-nano', 'gpt-6-luna', 'o4-mini'])('%s: temperature is omitted (fixed-temperature family)', async (model) => {
    const { p, calls } = make([openaiOk('x')], model)
    await p.generate(req())
    expect(calls[0].body).not.toHaveProperty('temperature')
  })

  it('structured output uses a strict json_schema response_format', async () => {
    const schema = { type: 'object' }
    const { p, calls } = make([openaiOk('{"a":1}')])
    await p.generate(req({ jsonSchema: { name: 'out', schema } }))
    expect(calls[0].body.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'out', schema, strict: true } })
  })

  it('refusals and content filtering are content_filtered; empty is malformed', async () => {
    expect((await fail(make([openaiOk('', { message: { content: null, refusal: 'no' } })]).p.generate(req()))).kind).toBe('content_filtered')
    expect((await fail(make([openaiOk('x', { finish_reason: 'content_filter' })]).p.generate(req()))).kind).toBe('content_filtered')
    expect((await fail(make([openaiOk('  ')]).p.generate(req()))).kind).toBe('malformed_response')
    expect((await fail(make([{ status: 200, json: { choices: [] } }]).p.generate(req()))).kind).toBe('malformed_response')
  })

  it('vision: data URL image part', async () => {
    const { p, calls } = make([openaiOk('{"category":"pants"}')])
    expect((await p.analyzeImage(vision())).output).toEqual({ category: 'pants' })
    const content = (calls[0].body.messages as Array<{ content: unknown }>)[0].content
    expect(content).toEqual([
      { type: 'text', text: 'Describe' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AQID', detail: 'auto' } },
    ])
    expect(calls[0].body).toMatchObject({ temperature: 0 })
  })

  it('a conversation with only system messages is refused before any request', async () => {
    const { p, calls } = make([openaiOk('x')])
    expect((await fail(p.generate(req({ messages: [{ role: 'system', content: 's' }] })))).kind).toBe('invalid_request')
    expect(calls).toHaveLength(0)
  })
})

describe('vision request rules (all adapters)', () => {
  it.each([
    ['unsupported image type', { mimeType: 'image/heic' as never }],
    ['empty image', { image: new Uint8Array() }],
    ['image too large', { image: new Uint8Array(4 * 1024 * 1024 + 1) }],
    ['maxSide out of range', { maxSide: 4096 }],
    ['maxSide out of range', { maxSide: 0 }],
    ['missing instruction', { instruction: '  ' }],
  ])('%s → invalid_request, nothing sent', async (detail, extra) => {
    const f = fakeFetch([{ status: 200, json: {} }])
    for (const p of [new GeminiProvider({ apiKey: KEY, model: 'm', fetch: f.fetch }), new OpenAIProvider({ apiKey: KEY, model: 'm', fetch: f.fetch }), new MockProvider()]) {
      const e = await fail(p.analyzeImage(vision(extra)))
      expect(e.kind).toBe('invalid_request')
      expect(e.message).toContain(detail)
    }
    expect(f.calls).toHaveLength(0)
  })
})

describe('mock provider', () => {
  it('is labelled as a demo and never pretends to be a real AI', async () => {
    const r = await new MockProvider().generate(req())
    expect(r.text).toBe(MOCK_LLM_TEXT)
    expect(r.text).toMatch(/Demo rejim/)
    expect(r.metadata).toEqual({ provider: 'mock', model: 'mock', usage: {} })
  })

  it('returns {} for structured requests and supports scripted replies', async () => {
    expect((await new MockProvider().generate(req({ jsonSchema: { name: 's', schema: {} } }))).text).toBe('{}')
    expect((await new MockProvider({ respond: () => 'scripted' }).generate(req())).text).toBe('scripted')
    expect((await new MockProvider({ see: () => ({ a: 1 }) }).analyzeImage(vision())).output).toEqual({ a: 1 })
  })
})
