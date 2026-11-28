import path from 'path'
import { defineConfig } from 'vitest/config'

// The offline evaluation against the Go pipeline (stage B6.9): the harness's
// scripted cases through `lookly eval` (LOOKLY_BINARY, the built apps/api
// binary), required to give the TypeScript pipeline's records. No network,
// no keys. `bun run test:eval-go`; CI runs it in the e2e job, which builds
// the binary.
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    environment: 'node',
    include: ['tests/eval-go/**/*.evalgo.ts'],
    testTimeout: 120_000,
    env: { GEMINI_API_KEY: '', OPENAI_API_KEY: '', AI_LLM_PROVIDER: 'mock', AI_VISION_PROVIDER: 'mock' },
  },
})
