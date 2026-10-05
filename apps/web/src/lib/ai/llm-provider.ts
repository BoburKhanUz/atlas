/**
 * LLM provider abstraction (spec section 15).
 *
 * The rest of the app should NEVER call a specific provider directly. It must
 * go through `LLMProvider` so we can swap OpenAI ↔ Gemini ↔ Anthropic ↔ local
 * without touching call sites.
 *
 * Current default provider: ZAI (via z-ai-web-dev-sdk) — already wired in this
 * project. Future providers just need to implement the same interface.
 */

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LLMResponse {
  content: string
  /** Provider that produced this response. */
  provider: string
  /** Optional raw usage info for logging/billing. */
  usage?: Record<string, number>
}

export interface LLMProvider {
  name: string
  /** Synchronous single-turn completion. */
  complete(messages: LLMMessage[], options?: { temperature?: number; maxTokens?: number }): Promise<LLMResponse>
}

// ─── ZAI provider (default) ──────────────────────────────────────────────────
class ZAIProvider implements LLMProvider {
  name = 'zai'

  async complete(
    messages: LLMMessage[],
    options?: { temperature?: number; maxTokens?: number },
  ): Promise<LLMResponse> {
    // z-ai-web-dev-sdk is server-only; imported lazily to avoid bundling.
    const ZAI = await import('z-ai-web-dev-sdk').then((m) => m.default ?? m)
    const zai = await ZAI.create()

    // The ZAI chat completions API accepts an OpenAI-compatible `messages`
    // array. The system prompt MUST be the first message with role:'system'.
    // We pass the full message list directly — the caller (stylist.ts) is
    // responsible for inserting the system message at index 0.
    const response = await zai.chat.completions.create({
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 1024,
      thinking: { type: 'disabled' },
    })

    const content =
      (response?.choices?.[0]?.message?.content as string | undefined) ?? ''
    return {
      content: typeof content === 'string' ? content : JSON.stringify(content),
      provider: this.name,
    }
  }
}

// Singleton — initialized lazily on first use
let _provider: LLMProvider | null = null

export function getLLMProvider(): LLMProvider {
  if (_provider) return _provider
  const configured = process.env.LLM_PROVIDER?.toLowerCase()
  if (configured && configured !== 'zai') {
    // Future: support 'openai' | 'gemini' | 'anthropic' | 'local'
    // For MVP, only ZAI is wired; anything else falls back with a clear error.
    throw new Error(
      `LLM_PROVIDER="${configured}" not configured in MVP. Falling back to "zai". ` +
        'To wire another provider, add a new class implementing LLMProvider.',
    )
  }
  _provider = new ZAIProvider()
  return _provider
}

/** Allow tests to inject a fake provider. */
export function setLLMProviderForTesting(p: LLMProvider) {
  _provider = p
}
