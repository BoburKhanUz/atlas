/**
 * Test isolation for AI providers (Phase 4.5). Applied by tests/setup.ts to
 * every unit and regression run, whatever the developer's shell holds:
 *
 * 1. the mock providers are pinned and provider keys/models are removed, so
 *    the configured providers can never be real ones;
 * 2. a network guard refuses any request to a provider API host, so even a
 *    test that builds a real adapter without an injected fetch cannot call it.
 *
 * Provider behaviour is tested with scripted providers or a scripted fetch.
 */
export const PROVIDER_ENV = [
  'AI_LLM_MODEL',
  'AI_VISION_MODEL',
  'GEMINI_API_KEY',
  'OPENAI_API_KEY',
  // Per-feature routes and the allowlist (multi-provider P1): a shell value must not route a test to a real provider.
  'AI_STYLIST_PROVIDER',
  'AI_STYLIST_MODEL',
  'AI_OUTFIT_PROVIDER',
  'AI_OUTFIT_MODEL',
  'AI_APPROVED_PROVIDERS',
] as const
export const PROVIDER_HOSTS = ['generativelanguage.googleapis.com', 'api.openai.com'] as const

export function pinMockAi(env: Record<string, string | undefined>): void {
  env.AI_LLM_PROVIDER = 'mock'
  env.AI_VISION_PROVIDER = 'mock'
  for (const name of PROVIDER_ENV) delete env[name]
}

export class LiveProviderCallError extends Error {
  constructor(host: string) {
    super(`a test tried to call a live AI provider (${host}); inject a scripted provider or fetch instead`)
    this.name = 'LiveProviderCallError'
  }
}

/** Wraps `fetch` so that provider hosts are refused; everything else is unchanged. */
export function guardProviderFetch(original: typeof fetch): typeof fetch {
  const guarded = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    let host = ''
    try {
      host = new URL(url).hostname
    } catch {
      // not an absolute URL: not a provider call
    }
    if ((PROVIDER_HOSTS as readonly string[]).includes(host)) return Promise.reject(new LiveProviderCallError(host))
    return original(input, init)
  }
  return guarded as typeof fetch
}
