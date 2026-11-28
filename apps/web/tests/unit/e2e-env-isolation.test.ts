/**
 * E2E isolation: Playwright starts each server with `{ ...process.env, ...webServer.env }`,
 * so a value in the developer's or CI's shell reaches the Go server unless the
 * configuration pins it. This loads the real configurations (no server starts, no
 * request is made) under a hostile shell and checks that no server of an e2e run can
 * be routed to a real AI provider or handed a key.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PINNED_AI_ENV } from '../../e2e/ai-env'

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

type WebServer = { command: string; env: Record<string, string> }

async function serversOf(config: string): Promise<WebServer[]> {
  for (const [k, v] of Object.entries(HOSTILE)) vi.stubEnv(k, v)
  // The configurations need these to load; nothing connects to them.
  vi.stubEnv('E2E_GO_BINARY', '/nonexistent/lookly')
  vi.stubEnv('E2E_DATABASE_URL', 'postgresql://unused@127.0.0.1:1/unused')
  vi.resetModules()
  return ((await import(config)).default as { webServer: WebServer[] }).webServer
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe.each(['../../playwright.config', '../../playwright.api.config'])('%s under a hostile shell', (config) => {
  it('pins every AI setting of every server it starts: the mock providers, no route, no model, no key', async () => {
    const servers = await serversOf(config)
    expect(servers.length).toBeGreaterThan(0)
    for (const server of servers) {
      // What the server receives: the shell, then the configuration's env on top.
      const effective = { ...HOSTILE, ...server.env }
      for (const name of Object.keys(HOSTILE)) {
        expect(effective[name as keyof typeof effective], `${server.command}: ${name}`).toBe(PINNED_AI_ENV[name as keyof typeof PINNED_AI_ENV])
      }
    }
  })
})

describe('the pinned settings', () => {
  it('cover every variable the hostile shell sets, and leave only the mock providers', () => {
    expect(Object.keys(PINNED_AI_ENV).sort()).toEqual(Object.keys(HOSTILE).sort())
    expect(Object.entries(PINNED_AI_ENV).filter(([, v]) => v !== '')).toEqual([
      ['AI_LLM_PROVIDER', 'mock'],
      ['AI_VISION_PROVIDER', 'mock'],
    ])
  })
})
