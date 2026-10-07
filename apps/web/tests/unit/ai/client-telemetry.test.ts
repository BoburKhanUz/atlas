import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateText, analyzeImage } from '@/lib/ai/client'
import { resetAiConfigForTesting } from '@/lib/ai/config'
import { setLLMProviderForTesting, setVisionProviderForTesting } from '@/lib/ai/providers'
import { AiProviderError } from '@/lib/ai/providers/errors'
import { MockProvider } from '@/lib/ai/providers/mock'
import type { LLMProvider, LLMRequest } from '@/lib/ai/providers/types'
import { aiCallFields, estimateCostUsd } from '@/lib/ai/telemetry'

const PROMPT = 'SYSTEM-PROMPT-CONTENT'
const MESSAGE = 'Mening qora ko‘ylagim bormi? USER-MESSAGE-CONTENT'
const KEY = 'sk-test-SHOULD-NEVER-BE-LOGGED-0123456789'

let lines: string[] = []
const capture = () => {
  lines = []
  const push = (chunk: unknown) => {
    lines.push(String(chunk))
    return true
  }
  vi.spyOn(process.stdout, 'write').mockImplementation(push as never)
  vi.spyOn(process.stderr, 'write').mockImplementation(push as never)
}
const aiLines = () => lines.filter((l) => l.includes('"msg":"ai.call"')).map((l) => JSON.parse(l))

class Scripted implements LLMProvider {
  readonly name = 'scripted'
  readonly model = 'scripted-model'
  seen: LLMRequest[] = []
  constructor(private readonly steps: Array<() => Promise<string>>) {}
  async generate(r: LLMRequest) {
    this.seen.push(r)
    const step = this.steps[Math.min(this.seen.length - 1, this.steps.length - 1)]
    return { text: await step(), metadata: { provider: this.name, model: this.model, usage: { inputTokens: 1000, outputTokens: 200, totalTokens: 1200 } } }
  }
}

const request = { messages: [{ role: 'system' as const, content: PROMPT }, { role: 'user' as const, content: MESSAGE }] }
const noSleep = { sleep: async () => undefined }

beforeEach(() => {
  resetAiConfigForTesting()
  capture()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  setLLMProviderForTesting(null)
  setVisionProviderForTesting(null)
  resetAiConfigForTesting()
})

describe('generateText', () => {
  it('uses the configured default timeout and records one content-free ai.call line', async () => {
    vi.stubEnv('AI_LLM_TIMEOUT_MS', '12345')
    vi.stubEnv('OPENAI_API_KEY', KEY)
    const p = new Scripted([async () => 'javob'])
    setLLMProviderForTesting(p)
    const r = await generateText('stylist_chat', request, noSleep)
    expect(r.text).toBe('javob')
    expect(p.seen[0].timeoutMs).toBe(12345)
    const [line, ...rest] = aiLines()
    expect(rest).toHaveLength(0)
    expect(line).toMatchObject({
      level: 'info',
      feature: 'stylist_chat',
      provider: 'scripted',
      model: 'scripted-model',
      outcome: 'ok',
      attempts: 1,
      retried: false,
      usageInput: 1000,
      usageOutput: 200,
      usageTotal: 1200,
    })
    expect(typeof line.latencyMs).toBe('number')
    const all = lines.join('\n')
    for (const secret of [PROMPT, 'USER-MESSAGE-CONTENT', 'javob', KEY]) expect(all).not.toContain(secret)
  })

  it('an explicit timeout wins over the default', async () => {
    const p = new Scripted([async () => 'x'])
    setLLMProviderForTesting(p)
    await generateText('outfit_explanation', { ...request, timeoutMs: 15000 }, noSleep)
    expect(p.seen[0].timeoutMs).toBe(15000)
  })

  it('retries one transient failure and records attempts=2', async () => {
    const p = new Scripted([
      async () => {
        throw new AiProviderError('unavailable', 'scripted', { status: 503 })
      },
      async () => 'ok',
    ])
    setLLMProviderForTesting(p)
    await generateText('stylist_chat', request, noSleep)
    expect(p.seen).toHaveLength(2)
    expect(aiLines()[0]).toMatchObject({ outcome: 'ok', attempts: 2, retried: true })
  })

  it('a final failure rethrows the provider error and logs its kind at warn level, without content', async () => {
    setLLMProviderForTesting(
      new Scripted([
        async () => {
          throw new AiProviderError('auth', 'scripted', { status: 401 })
        },
      ]),
    )
    const err = await generateText('stylist_chat', request, noSleep).catch((e) => e)
    expect(err).toBeInstanceOf(AiProviderError)
    expect(err.kind).toBe('auth')
    const [line] = aiLines()
    expect(line).toMatchObject({ level: 'warn', outcome: 'auth', attempts: 1 })
    expect(line).not.toHaveProperty('usageInput')
    expect(lines.join('\n')).not.toContain('USER-MESSAGE-CONTENT')
  })

  it('a non-provider error is recorded as "error"', async () => {
    setLLMProviderForTesting(
      new Scripted([
        async () => {
          throw new TypeError('bug')
        },
      ]),
    )
    await expect(generateText('stylist_chat', request, noSleep)).rejects.toThrow('bug')
    expect(aiLines()[0]).toMatchObject({ outcome: 'error', attempts: 1 })
  })

  it('cost is estimated only when prices are configured', async () => {
    vi.stubEnv('AI_LLM_PRICE_INPUT_USD_PER_MTOK', '0.25')
    vi.stubEnv('AI_LLM_PRICE_OUTPUT_USD_PER_MTOK', '1.5')
    setLLMProviderForTesting(new Scripted([async () => 'x']))
    await generateText('stylist_chat', request, noSleep)
    expect(aiLines()[0].costUsd).toBe(0.00055) // 1000 × 0.25 + 200 × 1.5 per million
  })

  it('the mock provider is the development default', async () => {
    const r = await generateText('stylist_chat', request, noSleep)
    expect(r.metadata.provider).toBe('mock')
  })
})

describe('analyzeImage', () => {
  it('goes through the vision provider with the same telemetry', async () => {
    setVisionProviderForTesting(new MockProvider({ see: () => ({ category: 'shirt' }) }))
    const r = await analyzeImage('clothing_analysis', { image: new Uint8Array([1]), mimeType: 'image/jpeg', maxSide: 512, instruction: 'x' }, noSleep)
    expect(r.output).toEqual({ category: 'shirt' })
    expect(aiLines()[0]).toMatchObject({ feature: 'clothing_analysis', provider: 'mock', outcome: 'ok' })
  })
})

describe('telemetry fields', () => {
  it('names avoid the logger’s sensitive-key redaction and contain no identifiers', () => {
    const f = aiCallFields({ feature: 'stylist_chat', provider: 'p', model: 'm', outcome: 'ok', latencyMs: 12.6, attempts: 1, usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } })
    expect(Object.keys(f).sort()).toEqual(['attempts', 'feature', 'latencyMs', 'model', 'outcome', 'provider', 'retried', 'retry', 'success', 'usageInput', 'usageOutput', 'usageTotal'])
    expect(f.latencyMs).toBe(13)
    expect([f.success, f.retry, f.errorCode]).toEqual([true, 'none', undefined])
    // A failure carries its typed code and HTTP status; retry outcome is explicit.
    const failed = aiCallFields({ feature: 'stylist_chat', provider: 'p', model: 'm', outcome: 'unavailable', latencyMs: 5, attempts: 2, httpStatus: 503 })
    expect([failed.success, failed.errorCode, failed.httpStatus, failed.retry]).toEqual([false, 'unavailable', 503, 'failed'])
    expect(aiCallFields({ feature: 'stylist_chat', provider: 'p', model: 'm', outcome: 'ok', latencyMs: 5, attempts: 2 }).retry).toBe('succeeded')
  })

  it('cost needs both a price and both token counts', () => {
    const price = { inputUsdPerMTok: 1, outputUsdPerMTok: 2 }
    expect(estimateCostUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, price)).toBe(3)
    expect(estimateCostUsd({ inputTokens: 10 }, price)).toBeUndefined()
    expect(estimateCostUsd({ inputTokens: 10, outputTokens: 1 }, null)).toBeUndefined()
  })
})
