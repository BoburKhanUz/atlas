/**
 * Google Gemini adapter over the REST API (generateContent), no SDK.
 * Candidate provider for the Phase 4 bake-off; selected only through
 * AI_LLM_PROVIDER=gemini. The API key is sent as a header, never in the URL.
 */
import { AiProviderError } from './errors'
import { parseJsonOutput, postJson, type FetchLike } from './http'
import type { LLMProvider, LLMRequest, LLMResult, ProviderUsage, VisionProvider, VisionRequest, VisionResult } from './types'
import { assertVisionRequest, toBase64 } from './vision-input'

export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

/** Finish reasons that mean the provider refused or filtered the content. */
const FILTERED = new Set(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY', 'LANGUAGE'])

type Part = { text: string } | { inlineData: { mimeType: string; data: string } }
interface Content {
  role: 'user' | 'model'
  parts: Part[]
}

export interface GeminiOptions {
  apiKey: string
  model: string
  fetch?: FetchLike
  baseUrl?: string
}

export class GeminiProvider implements LLMProvider, VisionProvider {
  readonly name = 'gemini'
  readonly model: string
  private readonly apiKey: string
  private readonly fetch: FetchLike
  private readonly baseUrl: string

  constructor(opts: GeminiOptions) {
    if (!opts.apiKey) throw new AiProviderError('config', 'gemini', { detail: 'API key missing' })
    this.apiKey = opts.apiKey
    this.model = opts.model
    this.fetch = opts.fetch ?? ((input, init) => fetch(input, init))
    this.baseUrl = opts.baseUrl ?? GEMINI_API_BASE
  }

  async generate(req: LLMRequest): Promise<LLMResult> {
    const system = req.messages.filter((m) => m.role === 'system').map((m) => m.content)
    const contents: Content[] = req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))
    if (contents.length === 0) throw new AiProviderError('invalid_request', this.name, { detail: 'no user message' })
    const text = await this.call({
      ...(system.length ? { systemInstruction: { parts: [{ text: system.join('\n\n') }] } } : {}),
      contents,
      generationConfig: this.generationConfig(req.temperature, req.maxOutputTokens, req.jsonSchema?.schema),
    }, req.timeoutMs, req.signal)
    return { text: req.jsonSchema ? JSON.stringify(parseJsonOutput(this.name, text.value)) : text.value, metadata: text.metadata }
  }

  async analyzeImage(req: VisionRequest): Promise<VisionResult> {
    assertVisionRequest(this.name, req)
    const thinking = req.options?.geminiThinkingLevel
    const resolution = req.options?.geminiMediaResolution
    const result = await this.call({
      // Google recommends the text prompt before a single image.
      contents: [{ role: 'user', parts: [{ text: req.instruction }, { inlineData: { mimeType: req.mimeType, data: toBase64(req.image) } }] }],
      generationConfig: {
        ...this.generationConfig(0, req.maxOutputTokens, req.jsonSchema?.schema ?? { type: 'object' }),
        ...(resolution ? { mediaResolution: `MEDIA_RESOLUTION_${resolution.toUpperCase()}` } : {}),
        ...(thinking && thinking !== 'none' ? { thinkingConfig: { thinkingLevel: thinking } } : {}),
      },
    }, req.timeoutMs, req.signal)
    return { output: parseJsonOutput(this.name, result.value), metadata: result.metadata }
  }

  private generationConfig(temperature: number | undefined, maxOutputTokens: number | undefined, schema: Record<string, unknown> | undefined) {
    return {
      ...(temperature !== undefined ? { temperature } : {}),
      ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
      ...(schema ? { responseMimeType: 'application/json', responseJsonSchema: schema } : {}),
    }
  }

  private async call(body: unknown, timeoutMs: number, signal?: AbortSignal) {
    const json = await postJson({
      provider: this.name,
      url: `${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent`,
      headers: { 'x-goog-api-key': this.apiKey },
      body,
      timeoutMs,
      signal,
      fetch: this.fetch,
    })
    return { value: this.extractText(json), metadata: { provider: this.name, model: this.model, usage: usageOf(json) } }
  }

  private extractText(json: unknown): string {
    const r = json as {
      promptFeedback?: { blockReason?: unknown }
      candidates?: Array<{ finishReason?: unknown; content?: { parts?: Array<{ text?: unknown; thought?: unknown }> } }>
    }
    if (!r || typeof r !== 'object') throw new AiProviderError('malformed_response', this.name)
    if (r.promptFeedback?.blockReason) throw new AiProviderError('content_filtered', this.name)
    const candidate = Array.isArray(r.candidates) ? r.candidates[0] : undefined
    if (!candidate) throw new AiProviderError('malformed_response', this.name, { detail: 'no candidate' })
    if (typeof candidate.finishReason === 'string' && FILTERED.has(candidate.finishReason)) {
      throw new AiProviderError('content_filtered', this.name)
    }
    const parts = Array.isArray(candidate.content?.parts) ? candidate.content.parts : []
    const text = parts
      .filter((p) => typeof p.text === 'string' && p.thought !== true)
      .map((p) => p.text as string)
      .join('')
    if (!text.trim()) throw new AiProviderError('malformed_response', this.name, { detail: 'empty output' })
    return text
  }
}

function usageOf(json: unknown): ProviderUsage {
  const u = (json as { usageMetadata?: Record<string, unknown> }).usageMetadata
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined)
  if (!u || typeof u !== 'object') return {}
  // Thinking tokens are billed as output tokens.
  const candidates = num(u.candidatesTokenCount)
  const thoughts = num(u.thoughtsTokenCount)
  const outputTokens = candidates === undefined && thoughts === undefined ? undefined : (candidates ?? 0) + (thoughts ?? 0)
  return { inputTokens: num(u.promptTokenCount), outputTokens, totalTokens: num(u.totalTokenCount) }
}
