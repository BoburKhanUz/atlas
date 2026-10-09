/**
 * E2E isolation (multi-provider review, finding F1): Playwright starts the
 * production server with `{ ...process.env, ...webServer.env }`, so a value in
 * the developer's or CI's shell reaches the server unless playwright.config.ts
 * pins it. This loads the real Playwright configuration (no server is started,
 * no request is made) and checks that a hostile shell cannot route any AI
 * feature of an e2e run to a real provider or hand it a key.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseAiConfig } from '@/lib/ai/config'

/** A shell that names real providers for every role, with keys and an allowlist. */
const HOSTILE = {
  AI_LLM_PROVIDER: 'gemini',
  AI_LLM_MODEL: 'live-text-model',
  AI_VISION_PROVIDER: 'openai',
  AI_VISION_MODEL: 'live-vision-model',
  AI_STYLIST_PROVIDER: 'gemini',
  AI_STYLIST_MODEL: 'live-stylist-model',
  AI_OUTFIT_PROVIDER: 'openai',
  AI_OUTFIT_MODEL: 'live-outfit-model',
  AI_APPROVED_PROVIDERS: 'gemini,openai',
  GEMINI_API_KEY: 'real-looking-gemini-key-0123456789',
  OPENAI_API_KEY: 'sk-real-looking-openai-key-0123456789',
}
const PINNED_EMPTY = ['AI_STYLIST_PROVIDER', 'AI_STYLIST_MODEL', 'AI_OUTFIT_PROVIDER', 'AI_OUTFIT_MODEL', 'AI_APPROVED_PROVIDERS', 'GEMINI_API_KEY', 'OPENAI_API_KEY']

type WebServer = { env: Record<string, string> }
let servers: WebServer[] = []

beforeEach(async () => {
  // The configuration needs these to load; nothing connects to them.
  vi.stubEnv('E2E_DATABASE_URL', 'postgresql://unused@127.0.0.1:1/unused')
  vi.stubEnv('STORAGE_LOCAL_DIR', '/nonexistent/atlas-e2e-storage')
  vi.resetModules()
  const config = (await import('../../../playwright.config')).default as { webServer: WebServer[] }
  servers = config.webServer
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('e2e server environment (playwright.config.ts)', () => {
  it('pins every provider route, the allowlist and the provider keys to empty for both servers', () => {
    expect(servers).toHaveLength(2)
    for (const s of servers) {
      for (const name of PINNED_EMPTY) expect(s.env[name]).toBe('')
      expect([s.env.AI_LLM_PROVIDER, s.env.AI_VISION_PROVIDER, s.env.AI_ALLOW_MOCK_IN_PRODUCTION, s.env.NODE_ENV]).toEqual(['mock', 'mock', '1', 'production'])
    }
  })

  it('a hostile shell, merged the way Playwright merges it, still yields mock-only AI with no key', () => {
    for (const s of servers) {
      const merged = { ...HOSTILE, ...s.env }
      const c = parseAiConfig(merged)
      expect([c.llm.provider, c.vision.provider, c.text.stylist_chat.provider, c.text.outfit_explanation.provider]).toEqual(['mock', 'mock', 'mock', 'mock'])
      expect([c.llm.apiKey, c.vision.apiKey, c.text.stylist_chat.apiKey, c.text.outfit_explanation.apiKey]).toEqual([null, null, null, null])
      expect([...c.approvedProviders]).toEqual(['gemini', 'openai'])
      expect(c.mockInProduction).toBe(true)
      expect(merged.GEMINI_API_KEY).toBe('')
      expect(merged.OPENAI_API_KEY).toBe('')
    }
  })

  it('control: without these pins the same shell would route stylist and outfit to real providers', () => {
    const unpinned = Object.fromEntries(Object.entries(servers[0].env).filter(([k]) => !PINNED_EMPTY.includes(k)))
    const c = parseAiConfig({ ...HOSTILE, ...unpinned })
    expect([c.text.stylist_chat.provider, c.text.outfit_explanation.provider]).toEqual(['gemini', 'openai'])
  })
})
