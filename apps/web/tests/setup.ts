import { guardProviderFetch, pinMockAi } from './ai-test-env'

// AI: tests never reach a real provider, whatever the developer's shell holds
// (mock pinned, keys removed, provider hosts refused). See tests/ai-test-env.ts.
pinMockAi(process.env)
globalThis.fetch = guardProviderFetch(globalThis.fetch)
