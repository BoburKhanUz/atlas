/**
 * OpenAI adapter over the REST Chat Completions API, no SDK. Candidate
 * provider for the Phase 4 bake-off; selected only through
 * AI_LLM_PROVIDER=openai.
 */
import { AiProviderError } from './errors'
import { parseJsonOutput, postJson, type FetchLike } from './http'
import type { LLMProvider, LLMRequest, LLMResult, ProviderUsage, VisionProvider, VisionRequest, VisionResult } from './types'
import { assertVisionRequest, toBase64 } from './vision-input'

export const OPENAI_API_BASE = 'https://api.openai.com/v1'

/**
 * Reasoning model families accept only the default temperature; sending one
 * is a 400. For them the requested temperature is omitted.
 */
const FIXED_TEMPERATURE_MODEL = /^(gpt-5|gpt-6|o\d)/i

export interface OpenAIOptions {
  apiKey: string
  model: string
  fetch?: FetchLike
  baseUrl?: string
}

type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail: 'auto' } }

export class OpenAIProvider implements LLMProvider, VisionProvider {
  readonly name = 'openai'
  readonly model: string
  private readonly apiKey: string
  private readonly fetch: FetchLike
  private readonly baseUrl: string

  constructor(opts: OpenAIOptions) {
    if (!opts.apiKey) throw new AiProviderError('config', 'openai', { detail: 'API key missing' })
    this.apiKey = opts.apiKey
    this.model = opts.model
    this.fetch = opts.fetch ?? ((input, init) => fetch(input, init))
    this.baseUrl = opts.baseUrl ?? OPENAI_API_BASE
  }

  async generate(req: LLMRequest): Promise<LLMResult> {
    if (!req.messages.some((m) => m.role !== 'system')) {
      throw new AiProviderError('invalid_request', this.name, { detail: 'no user message' })
    }
    const result = await this.call(
      req.messages.map((m) => ({ role: m.role, content: m.content })),
      req.temperature,
      req.maxOutputTokens,
      req.jsonSchema,
      req.timeoutMs,
      req.signal,
    )
    return { text: req.jsonSchema ? JSON.stringify(parseJsonOutput(this.name, result.value)) : result.value, metadata: result.metadata }
  }

  async analyzeImage(req: VisionRequest): Promise<VisionResult> {
    assertVisionRequest(this.name, req)
    const content: ContentPart[] = [
      { type: 'text', text: req.instruction },
      { type: 'image_url', image_url: { url: `data:${req.mimeType};base64,${toBase64(req.image)}`, detail: 'auto' } },
    ]
    const result = await this.call(
      [{ role: 'user', content }],
      0,
      req.maxOutputTokens,
      req.jsonSchema ?? { name: 'vision_output', schema: { type: 'object' } },
      req.timeoutMs,
      req.signal,
    )
    return { output: parseJsonOutput(this.name, result.value), metadata: result.metadata }
  }

  private async call(
    messages: Array<{ role: string; content: string | ContentPart[] }>,
    temperature: number | undefined,
    maxOutputTokens: number | undefined,
    jsonSchema: LLMRequest['jsonSchema'],
    timeoutMs: number,
    signal?: AbortSignal,
  ) {
    const json = await postJson({
      provider: this.name,
      url: `${this.baseUrl}/chat/completions`,
      headers: { authorization: `Bearer ${this.apiKey}` },
      body: {
        model: this.model,
        messages,
        ...(temperature !== undefined && !FIXED_TEMPERATURE_MODEL.test(this.model) ? { temperature } : {}),
        ...(maxOutputTokens !== undefined ? { max_completion_tokens: maxOutputTokens } : {}),
        ...(jsonSchema
          ? { response_format: { type: 'json_schema', json_schema: { name: jsonSchema.name, schema: jsonSchema.schema, strict: true } } }
          : {}),
        // Do not let OpenAI keep these completions for its stored-completions features.
        store: false,
      },
      timeoutMs,
      signal,
      fetch: this.fetch,
    })
    return { value: this.extractText(json), metadata: { provider: this.name, model: this.model, usage: usageOf(json) } }
  }

  private extractText(json: unknown): string {
    const r = json as { choices?: Array<{ finish_reason?: unknown; message?: { content?: unknown; refusal?: unknown } }> }
    const choice = r && typeof r === 'object' && Array.isArray(r.choices) ? r.choices[0] : undefined
    if (!choice) throw new AiProviderError('malformed_response', this.name, { detail: 'no choice' })
    if (choice.finish_reason === 'content_filter' || (typeof choice.message?.refusal === 'string' && choice.message.refusal)) {
      throw new AiProviderError('content_filtered', this.name)
    }
    const content = choice.message?.content
    if (typeof content !== 'string' || !content.trim()) {
      throw new AiProviderError('malformed_response', this.name, { detail: 'empty output' })
    }
    return content
  }
}

function usageOf(json: unknown): ProviderUsage {
  const u = (json as { usage?: Record<string, unknown> }).usage
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined)
  if (!u || typeof u !== 'object') return {}
  return { inputTokens: num(u.prompt_tokens), outputTokens: num(u.completion_tokens), totalTokens: num(u.total_tokens) }
}
