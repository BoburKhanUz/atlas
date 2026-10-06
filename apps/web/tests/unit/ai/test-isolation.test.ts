/**
 * Phase 4.5: tests never reach a real AI provider, whatever the developer's
 * shell holds. tests/setup.ts applies tests/ai-test-env.ts (mock pinned, keys
 * removed, provider hosts refused); vitest.integration.config.ts pins the same
 * environment; e2e and spawned servers set the mock explicitly.
 */
import { describe, expect, it } from 'vitest'
import { parseAiConfig, getAiConfig } from '@/lib/ai/config'
import { createLLMProvider, createVisionProvider, getLLMProvider, getVisionProvider } from '@/lib/ai/providers'
import { GeminiProvider } from '@/lib/ai/providers/gemini'
import { OpenAIProvider } from '@/lib/ai/providers/openai'
import { guardProviderFetch, LiveProviderCallError, pinMockAi } from '../../ai-test-env'

const HOSTILE = {
  NODE_ENV: 'test',
  AI_LLM_PROVIDER: 'gemini',
  AI_LLM_MODEL: 'live-model',
  GEMINI_API_KEY: 'real-looking-key-0123456789',
  AI_VISION_PROVIDER: 'openai',
  AI_VISION_MODEL: 'live-vision-model',
  OPENAI_API_KEY: 'sk-real-looking-key-0123456789',
}

describe('AI test isolation', () => {
  it('this run: the configured providers are the mock and no provider key or model is visible', () => {
    expect(getLLMProvider().name).toBe('mock')
    expect(getVisionProvider().name).toBe('mock')
    expect(getAiConfig().llm.apiKey).toBeNull()
    expect(getAiConfig().vision.apiKey).toBeNull()
    for (const name of ['GEMINI_API_KEY', 'OPENAI_API_KEY', 'AI_LLM_MODEL', 'AI_VISION_MODEL']) expect(process.env[name]).toBeUndefined()
  })

  it('a hostile shell environment (real provider names, models and keys) is neutralised by the test setup', () => {
    // Without the setup, this environment builds live providers…
    const live = parseAiConfig({ ...HOSTILE })
    expect([createLLMProvider(live.llm).name, createVisionProvider(live.vision).name]).toEqual(['gemini', 'openai'])
    // …with it, the mock and no credentials.
    const env: Record<string, string | undefined> = { ...HOSTILE }
    pinMockAi(env)
    const pinned = parseAiConfig(env)
    expect([pinned.llm.provider, pinned.vision.provider, pinned.llm.apiKey, pinned.vision.apiKey]).toEqual(['mock', 'mock', null, null])
    expect(Object.keys(env).filter((k) => /KEY|MODEL/.test(k))).toEqual([])
  })

  it('the network guard refuses provider hosts (second line of defence) and lets other requests through', async () => {
    const seen: string[] = []
    const fake = (async (input: string) => {
      seen.push(input)
      return new Response('{}')
    }) as unknown as typeof fetch
    const guarded = guardProviderFetch(fake)
    await expect(guarded('https://generativelanguage.googleapis.com/v1beta/models/x:generateContent')).rejects.toBeInstanceOf(LiveProviderCallError)
    await expect(guarded(new URL('https://api.openai.com/v1/chat/completions'))).rejects.toBeInstanceOf(LiveProviderCallError)
    await guarded('https://example.test/ok')
    expect(seen).toEqual(['https://example.test/ok'])
  })

  it('in this run, a real adapter WITHOUT an injected fetch cannot reach the provider', async () => {
    for (const p of [new GeminiProvider({ apiKey: 'k', model: 'm' }), new OpenAIProvider({ apiKey: 'k', model: 'm' })]) {
      const err = await p.generate({ messages: [{ role: 'user', content: 'x' }], timeoutMs: 1000 }).then(() => null, (e) => e)
      expect(err?.kind).toBe('network') // the guard's rejection, classified like any connection failure; nothing left the process
    }
  })
})
