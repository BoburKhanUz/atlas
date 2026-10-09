/**
 * Multi-provider P0: the provider registry and resolver. The existing
 * providers (gemini, openai, mock) resolve through the registry with exactly
 * the behaviour the old factory had; unknown providers and unsupported
 * capabilities fail closed; nothing falls back to another provider. Scripted
 * fetch only: no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseAiConfig } from '@/lib/ai/config'
import { ConfigError } from '@/lib/config'
import { createLLMProvider, createVisionProvider } from '@/lib/ai/providers'
import { AiProviderError } from '@/lib/ai/providers/errors'
import { GeminiProvider } from '@/lib/ai/providers/gemini'
import { errorForStatus, postJson } from '@/lib/ai/providers/http'
import { MockProvider } from '@/lib/ai/providers/mock'
import { OpenAIProvider } from '@/lib/ai/providers/openai'
import {
  describeIds,
  getProviderDescriptor,
  normalizeProviderId,
  PROVIDER_IDS,
  PROVIDER_REGISTRY,
  resolveProvider,
  supportsCapability,
  type ProviderDescriptor,
} from '@/lib/ai/providers/registry'
import type { LLMProvider, LLMRequest, VisionRequest } from '@/lib/ai/providers/types'
import { fakeFetch, type Reply } from './fake-fetch'

const KEY = 'test-key-not-real-0123456789'
const textReq: LLMRequest = {
  messages: [{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }],
  temperature: 0.7,
  maxOutputTokens: 600,
  jsonSchema: { name: 'answer', schema: { type: 'object' } },
  timeoutMs: 1000,
}
const visionReq: VisionRequest = {
  image: new Uint8Array([1, 2, 3]),
  mimeType: 'image/jpeg',
  maxSide: 1024,
  instruction: 'Describe',
  jsonSchema: { name: 'garment', schema: { type: 'object' } },
  maxOutputTokens: 1024,
  options: { geminiMediaResolution: 'high', geminiThinkingLevel: 'low', openaiDetail: 'high' },
  timeoutMs: 1000,
}
const geminiOk: Reply = { status: 200, json: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"a":1}' }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 } } }
const openaiOk: Reply = { status: 200, json: { choices: [{ finish_reason: 'stop', message: { content: '{"a":1}' } }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } } }

// No test here may reach the network.
let networkCalls = 0
beforeEach(() => {
  networkCalls = 0
  vi.stubGlobal('fetch', async () => {
    networkCalls++
    throw new Error('network is not allowed in unit tests')
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  expect(networkCalls).toBe(0)
})

describe('provider registry', () => {
  it('registers exactly mock, gemini and openai, in a fixed order, with their key variables', () => {
    expect(PROVIDER_IDS).toEqual(['mock', 'gemini', 'openai'])
    expect([...PROVIDER_REGISTRY.keys()]).toEqual(['mock', 'gemini', 'openai'])
    expect(PROVIDER_IDS.map((id) => getProviderDescriptor(id).keyEnv)).toEqual([null, 'GEMINI_API_KEY', 'OPENAI_API_KEY'])
    for (const id of PROVIDER_IDS) {
      expect([supportsCapability(getProviderDescriptor(id), 'text'), supportsCapability(getProviderDescriptor(id), 'vision')]).toEqual([true, true])
    }
    expect(describeIds(PROVIDER_IDS)).toBe('mock, gemini or openai')
  })

  it('normalizes provider names the same way everywhere: trimmed and lowercase', () => {
    expect(normalizeProviderId('  Gemini ')).toBe('gemini')
    expect(normalizeProviderId('OPENAI')).toBe('openai')
    expect(getProviderDescriptor(' MOCK ').id).toBe('mock')
    const p = resolveProvider('text', { provider: 'GeMiNi', model: 'm', apiKey: KEY })
    expect(p).toBeInstanceOf(GeminiProvider)
    expect(p.name).toBe('gemini')
  })
})

describe('resolver', () => {
  it('gemini, openai and mock resolve to their adapters for text and vision, with the configured model', () => {
    expect(resolveProvider('text', { provider: 'gemini', model: 'g-text', apiKey: KEY })).toBeInstanceOf(GeminiProvider)
    expect(resolveProvider('vision', { provider: 'gemini', model: 'g-vis', apiKey: KEY })).toBeInstanceOf(GeminiProvider)
    expect(resolveProvider('text', { provider: 'openai', model: 'o-text', apiKey: KEY })).toBeInstanceOf(OpenAIProvider)
    expect(resolveProvider('vision', { provider: 'openai', model: 'o-vis', apiKey: KEY })).toBeInstanceOf(OpenAIProvider)
    expect(resolveProvider('text', { provider: 'mock', model: 'mock', apiKey: null })).toBeInstanceOf(MockProvider)
    expect(resolveProvider('vision', { provider: 'mock', model: 'mock', apiKey: null })).toBeInstanceOf(MockProvider)
    expect([
      resolveProvider('text', { provider: 'gemini', model: 'g-text', apiKey: KEY }).model,
      resolveProvider('vision', { provider: 'openai', model: 'o-vis', apiKey: KEY }).model,
      resolveProvider('text', { provider: 'mock', model: 'ignored', apiKey: null }).model,
    ]).toEqual(['g-text', 'o-vis', 'mock'])
  })

  it('an unknown provider fails closed with a configuration error; nothing else is built', () => {
    for (const id of ['claude', 'anthropic', 'groq', 'zai', '', ' ']) {
      expect(() => resolveProvider('text', { provider: id, model: 'm', apiKey: KEY })).toThrow(ConfigError)
      expect(() => resolveProvider('text', { provider: id, model: 'm', apiKey: KEY })).toThrow(/unknown AI provider \(registered: mock, gemini or openai\)/)
    }
  })

  it('an unsupported capability fails closed; the resolver never substitutes another provider', () => {
    let built = 0
    const textOnly: ProviderDescriptor = { id: 'textonly', keyEnv: 'TEXTONLY_KEY', text: () => (built++, new MockProvider()) }
    const registry = new Map<string, ProviderDescriptor>([...PROVIDER_REGISTRY, ['textonly', textOnly]])
    expect(supportsCapability(textOnly, 'vision')).toBe(false)
    expect(() => resolveProvider('vision', { provider: 'textonly', model: 'm', apiKey: KEY }, { registry })).toThrow(/AI provider textonly does not support vision/)
    expect(built).toBe(0)
    expect(resolveProvider('text', { provider: 'textonly', model: 'm', apiKey: KEY }, { registry })).toBeInstanceOf(MockProvider)
    expect(built).toBe(1)
  })

  it('a real provider without a key still fails in its adapter, as before (config error, provider named)', () => {
    for (const provider of ['gemini', 'openai']) {
      const err = (() => {
        try {
          resolveProvider('text', { provider, model: 'm', apiKey: null })
        } catch (e) {
          return e
        }
      })() as AiProviderError
      expect(err).toBeInstanceOf(AiProviderError)
      expect([err.kind, err.provider]).toEqual(['config', provider])
    }
  })
})

describe('compatibility with the previous factory', () => {
  const real = { NODE_ENV: 'production', AI_LLM_PROVIDER: 'gemini', AI_LLM_MODEL: 'g-text', GEMINI_API_KEY: KEY, AI_VISION_PROVIDER: 'openai', AI_VISION_MODEL: 'o-vis', OPENAI_API_KEY: KEY }

  it('existing environment variables build the same adapters as before, with no new variable required', () => {
    const c = parseAiConfig(real)
    const llm = createLLMProvider(c.llm), vision = createVisionProvider(c.vision)
    expect([llm, vision].map((p) => [p.constructor.name, p.name, p.model])).toEqual([['GeminiProvider', 'gemini', 'g-text'], ['OpenAIProvider', 'openai', 'o-vis']])
    const swapped = parseAiConfig({ ...real, AI_LLM_PROVIDER: 'OpenAI', AI_VISION_PROVIDER: 'GEMINI', AI_VISION_MODEL: 'g-vis' })
    expect([createLLMProvider(swapped.llm).name, createVisionProvider(swapped.vision).name]).toEqual(['openai', 'gemini'])
    const dev = parseAiConfig({ NODE_ENV: 'development' })
    expect([createLLMProvider(dev.llm), createVisionProvider(dev.vision)].every((p) => p instanceof MockProvider)).toBe(true)
  })

  it('configuration messages are unchanged', () => {
    expect(() => parseAiConfig({ NODE_ENV: 'development', AI_LLM_PROVIDER: 'claude' })).toThrow(/^AI_LLM_PROVIDER must be mock, gemini or openai$/)
    expect(() => parseAiConfig({ NODE_ENV: 'development', AI_VISION_PROVIDER: 'zai' })).toThrow(/^AI_VISION_PROVIDER must be mock, gemini or openai$/)
    expect(() => parseAiConfig({ NODE_ENV: 'production' })).toThrow(/^AI_LLM_PROVIDER must be set in production \(gemini or openai\)$/)
    expect(() => parseAiConfig({ ...real, AI_VISION_PROVIDER: undefined })).toThrow(/^AI_VISION_PROVIDER must be set in production \(gemini or openai\)$/)
    expect(() => parseAiConfig({ ...real, GEMINI_API_KEY: undefined })).toThrow(/^GEMINI_API_KEY must be set when AI_LLM_PROVIDER=gemini$/)
    expect(() => parseAiConfig({ ...real, OPENAI_API_KEY: undefined })).toThrow(/^OPENAI_API_KEY must be set when AI_VISION_PROVIDER=openai$/)
  })

  it('Gemini and OpenAI requests through the registry are byte-identical to direct construction', async () => {
    const send = async (p: LLMProvider & { analyzeImage?: (r: VisionRequest) => Promise<unknown> }) => {
      await p.generate(textReq)
      await p.analyzeImage!(visionReq)
    }
    for (const [provider, Ctor, reply] of [['gemini', GeminiProvider, geminiOk], ['openai', OpenAIProvider, openaiOk]] as const) {
      const viaRegistry = fakeFetch([reply]), direct = fakeFetch([reply])
      const text = resolveProvider('text', { provider, model: 'model-x', apiKey: KEY }, { fetch: viaRegistry.fetch })
      await text.generate(textReq)
      await resolveProvider('vision', { provider, model: 'model-x', apiKey: KEY }, { fetch: viaRegistry.fetch }).analyzeImage(visionReq)
      await send(new Ctor({ apiKey: KEY, model: 'model-x', fetch: direct.fetch }))
      expect(viaRegistry.calls).toEqual(direct.calls)
      expect(viaRegistry.calls).toHaveLength(2)
    }
  })
})

describe('transient overload statuses (normalized error model)', () => {
  it('existing classification is unchanged; 529 is transient only for an adapter that declares it', () => {
    expect([500, 502, 503, 504].map((s) => errorForStatus('p', s, null).kind)).toEqual(['unavailable', 'unavailable', 'unavailable', 'unavailable'])
    expect(errorForStatus('p', 529, null).kind).toBe('provider_error')
    expect(errorForStatus('p', 529, null).retryable).toBe(false)
    const declared = errorForStatus('p', 529, null, new Set([529]))
    expect([declared.kind, declared.status, declared.retryable]).toEqual(['unavailable', 529, true])
    expect(errorForStatus('p', 429, '2', new Set([529])).kind).toBe('rate_limited')
  })

  it('postJson applies the declared statuses; the Gemini and OpenAI adapters declare none', async () => {
    const overloaded = fakeFetch([{ status: 529, json: {} }])
    const fail = (p: Promise<unknown>) => p.then(() => null, (e) => e as AiProviderError)
    const withDecl = await fail(postJson({ provider: 'p', url: 'https://x.invalid', headers: {}, body: {}, timeoutMs: 1000, fetch: overloaded.fetch, transientStatuses: new Set([529]) }))
    expect(withDecl!.kind).toBe('unavailable')
    for (const [provider, Ctor] of [['gemini', GeminiProvider], ['openai', OpenAIProvider]] as const) {
      const f = fakeFetch([{ status: 529, json: {} }])
      const err = await fail(new Ctor({ apiKey: KEY, model: 'm', fetch: f.fetch }).generate(textReq))
      expect([err!.kind, err!.provider, err!.status]).toEqual(['provider_error', provider, 529])
    }
  })
})
