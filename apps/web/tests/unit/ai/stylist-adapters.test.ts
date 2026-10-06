/**
 * The stylist's real request (SYSTEM + CONTEXT + history + USER JSON, strict
 * schema) through the Gemini and OpenAI adapters, with fixtures only: no
 * network, no keys.
 */
import { describe, expect, it } from 'vitest'
import { AiProviderError } from '@/lib/ai/providers/errors'
import { GeminiProvider } from '@/lib/ai/providers/gemini'
import { OpenAIProvider } from '@/lib/ai/providers/openai'
import type { LLMRequest } from '@/lib/ai/providers/types'
import { STYLIST_LIMITS, STYLIST_SYSTEM_PROMPT, interpretStylistOutput, parseStylistText, stylistJsonSchema } from '@/lib/ai/stylist'
import { buildStylistContext, stylistMessages, type WardrobeRow } from '@/lib/ai/stylist-context'
import { fakeFetch, type Reply } from './fake-fetch'

const KEY = 'test-key-not-real-0123456789'
const row: WardrobeRow = {
  id: 'item_db_1', category: 'shirt', subcategory: 'tshirt', colors: ['white'], pattern: 'solid', material: 'cotton', sleeveLength: 'short',
  fit: 'regular', style: 'casual', season: ['summer'], gender: 'unisex', formality: 'casual', createdAt: new Date('2026-01-01'),
}
const ctx = buildStylistContext({ items: [row], candidates: [] })
const request = (): LLMRequest => ({
  messages: stylistMessages({
    system: STYLIST_SYSTEM_PROMPT,
    context: ctx.data,
    history: [{ role: 'user', content: 'Salom' }, { role: 'assistant', content: 'Salom!' }],
    message: 'Bugun nima kiyay?',
    occasionText: null,
  }),
  temperature: 0.7,
  maxOutputTokens: STYLIST_LIMITS.maxOutputTokens,
  jsonSchema: { name: 'stylist_answer', schema: stylistJsonSchema(ctx.refs) },
  timeoutMs: 1000,
})
const ANSWER = JSON.stringify({ answer: 'Bugun [W1] kiying.', referencedItems: ['W1'], needsMoreInfo: false })
const fail = async (p: Promise<unknown>) => (await p.then(() => null, (e) => e)) as AiProviderError

type Node = Record<string, unknown>
const checkStrict = (node: Node, path = 'root') => {
  if (node.type === 'object') {
    const props = Object.keys((node.properties ?? {}) as Node)
    expect(node.additionalProperties, path).toBe(false)
    expect([...((node.required ?? []) as string[])].sort(), path).toEqual([...props].sort())
    for (const [k, v] of Object.entries((node.properties ?? {}) as Record<string, Node>)) checkStrict(v, `${path}.${k}`)
  }
  if (node.items) checkStrict(node.items as Node, `${path}[]`)
}

describe('stylist schema', () => {
  it('is OpenAI strict-mode compatible, with and without wardrobe items', () => {
    checkStrict(stylistJsonSchema(['W1', 'W2']))
    checkStrict(stylistJsonSchema([]))
  })
})

describe('stylist through Gemini (generateContent)', () => {
  const ok = (text: string): Reply => ({
    status: 200,
    json: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 40, thoughtsTokenCount: 12, totalTokenCount: 952 } },
  })
  const make = (replies: Reply[]) => {
    const f = fakeFetch(replies)
    return { p: new GeminiProvider({ apiKey: KEY, model: 'gemini-candidate', fetch: f.fetch }), calls: f.calls }
  }

  it('request shape: rules + context in systemInstruction, history and the user JSON as contents, JSON schema, usage', async () => {
    const { p, calls } = make([ok(ANSWER)])
    const r = await p.generate(request())
    expect(interpretStylistOutput(parseStylistText(r.text), ctx.refs).referencedItems).toEqual(['W1'])
    expect(r.metadata.usage).toEqual({ inputTokens: 900, outputTokens: 52, totalTokens: 952 })
    const body = calls[0].body as any
    expect(body.systemInstruction.parts[0].text).toContain('You are ATLAS')
    expect(body.systemInstruction.parts[0].text).toContain('"ref":"W1"')
    expect(body.contents.map((c: { role: string }) => c.role)).toEqual(['user', 'model', 'user'])
    expect(JSON.parse(body.contents[2].parts[0].text)).toEqual({ message: 'Bugun nima kiyay?', occasion: null })
    expect(body.generationConfig).toMatchObject({ responseMimeType: 'application/json', responseJsonSchema: stylistJsonSchema(ctx.refs), maxOutputTokens: 600 })
    expect(JSON.stringify(body)).not.toContain('item_db_1')
    expect(calls[0].url).not.toContain(KEY)
  })

  it.each([
    [429, 'rate_limited'],
    [500, 'unavailable'],
    [503, 'unavailable'],
    [401, 'auth'],
  ] as const)('HTTP %s → %s', async (status, kind) => {
    expect((await fail(make([{ status, json: { error: { message: 'Bugun nima kiyay? echoed' } } }]).p.generate(request()))).kind).toBe(kind)
  })

  it('a hung request times out', async () => {
    expect((await fail(make([{ hang: true }]).p.generate({ ...request(), timeoutMs: 20 }))).kind).toBe('timeout')
  })
})

describe('stylist through OpenAI (chat completions)', () => {
  const ok = (content: string): Reply => ({
    status: 200,
    json: { choices: [{ finish_reason: 'stop', message: { content } }], usage: { prompt_tokens: 800, completion_tokens: 35, total_tokens: 835 } },
  })
  const make = (replies: Reply[]) => {
    const f = fakeFetch(replies)
    return { p: new OpenAIProvider({ apiKey: KEY, model: 'gpt-candidate', fetch: f.fetch }), calls: f.calls }
  }

  it('request shape: strict json_schema, store:false, roles kept, usage', async () => {
    const { p, calls } = make([ok(ANSWER)])
    const r = await p.generate(request())
    expect(interpretStylistOutput(parseStylistText(r.text), ctx.refs).answer).toBe('Bugun [W1] kiying.')
    expect(r.metadata.usage).toEqual({ inputTokens: 800, outputTokens: 35, totalTokens: 835 })
    const body = calls[0].body as any
    expect(body.store).toBe(false)
    expect(body.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'stylist_answer', schema: stylistJsonSchema(ctx.refs), strict: true } })
    expect(body.max_completion_tokens).toBe(600)
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(['system', 'system', 'user', 'assistant', 'user'])
    expect(JSON.stringify(body)).not.toContain('item_db_1')
    expect(calls[0].headers.authorization).toBe(`Bearer ${KEY}`)
  })

  it.each([
    [429, 'rate_limited'],
    [500, 'unavailable'],
    [502, 'unavailable'],
    [403, 'auth'],
  ] as const)('HTTP %s → %s', async (status, kind) => {
    expect((await fail(make([{ status, json: { error: { message: 'x' } } }]).p.generate(request()))).kind).toBe(kind)
  })

  it('a hung request times out; a refusal is content_filtered', async () => {
    expect((await fail(make([{ hang: true }]).p.generate({ ...request(), timeoutMs: 20 }))).kind).toBe('timeout')
    expect((await fail(make([{ status: 200, json: { choices: [{ finish_reason: 'stop', message: { content: null, refusal: 'no' } }] } }]).p.generate(request()))).kind).toBe('content_filtered')
  })
})
