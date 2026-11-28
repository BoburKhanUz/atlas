/**
 * The unit runs' AI isolation (tests/ai-test-env.ts, applied by tests/setup.ts): the
 * mock providers pinned and no key or model visible, whatever the shell holds, and
 * provider hosts refused on the network.
 */
import { describe, expect, it } from 'vitest'
import { guardProviderFetch, LiveProviderCallError, pinMockAi, PROVIDER_ENV } from '../ai-test-env'

describe('AI test isolation', () => {
  it('this run: the providers are the mock and no provider key, model or route is visible', () => {
    expect([process.env.AI_LLM_PROVIDER, process.env.AI_VISION_PROVIDER]).toEqual(['mock', 'mock'])
    for (const name of PROVIDER_ENV) expect(process.env[name], name).toBeUndefined()
    expect(PROVIDER_ENV).toEqual(expect.arrayContaining(['GEMINI_API_KEY', 'OPENAI_API_KEY', 'AI_STYLIST_PROVIDER', 'AI_OUTFIT_PROVIDER', 'AI_APPROVED_PROVIDERS']))
  })

  it('a hostile shell environment is neutralised', () => {
    const env: Record<string, string | undefined> = {
      AI_LLM_PROVIDER: 'gemini',
      AI_VISION_PROVIDER: 'openai',
      AI_LLM_MODEL: 'live',
      AI_STYLIST_PROVIDER: 'openai',
      AI_STYLIST_MODEL: 'live',
      AI_APPROVED_PROVIDERS: 'gemini,openai',
      GEMINI_API_KEY: 'k1',
      OPENAI_API_KEY: 'k2',
      UNRELATED: 'kept',
    }
    pinMockAi(env)
    expect(env).toEqual({ AI_LLM_PROVIDER: 'mock', AI_VISION_PROVIDER: 'mock', UNRELATED: 'kept' })
  })

  it('the network guard refuses provider hosts and lets other requests through', async () => {
    const seen: string[] = []
    const fake = (async (input: string) => {
      seen.push(String(input))
      return new Response('{}')
    }) as unknown as typeof fetch
    const guarded = guardProviderFetch(fake)
    await expect(guarded('https://generativelanguage.googleapis.com/v1beta/models/x:generateContent')).rejects.toBeInstanceOf(LiveProviderCallError)
    await expect(guarded(new URL('https://api.openai.com/v1/chat/completions'))).rejects.toBeInstanceOf(LiveProviderCallError)
    await expect(guarded(new Request('https://api.openai.com/v1/responses'))).rejects.toBeInstanceOf(LiveProviderCallError)
    await guarded('https://example.test/ok')
    await guarded('/relative/path')
    expect(seen).toEqual(['https://example.test/ok', '/relative/path'])
  })

  it('in this run, fetch itself refuses provider hosts (no request leaves)', async () => {
    await expect(fetch('https://api.openai.com/v1/chat/completions', { method: 'POST' })).rejects.toBeInstanceOf(LiveProviderCallError)
  })
})
