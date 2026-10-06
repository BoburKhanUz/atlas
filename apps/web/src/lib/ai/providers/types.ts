/**
 * Provider-independent AI contracts. The application layer (stylist, outfit
 * explanation, vision, colour) talks only to these types; Gemini, OpenAI and
 * the mock implement them. Nothing here imports a vendor SDK.
 */

/** The product features that call AI. Used for telemetry and quotas. */
export type AiFeature = 'stylist_chat' | 'outfit_explanation' | 'clothing_analysis' | 'color_analysis'

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** A JSON Schema the provider must constrain its output to. */
export interface StructuredOutputSchema {
  /** Identifier sent to providers that require one (letters, digits, _ and -). */
  name: string
  schema: Record<string, unknown>
}

/** Token counts reported by the provider, when it reports them. */
export interface ProviderUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

/** Who answered: returned with every provider result. */
export interface ProviderMetadata {
  provider: string
  model: string
  usage: ProviderUsage
}

export interface LLMRequest {
  messages: LLMMessage[]
  temperature?: number
  maxOutputTokens?: number
  /** When set, the reply is JSON matching this schema (validated by the caller). */
  jsonSchema?: StructuredOutputSchema
  /** Per-attempt timeout; the caller's budget, not the provider's default. */
  timeoutMs: number
  signal?: AbortSignal
}

export interface LLMResult {
  text: string
  metadata: ProviderMetadata
}

export interface LLMProvider {
  readonly name: string
  readonly model: string
  generate(request: LLMRequest): Promise<LLMResult>
}

export type VisionImageMimeType = 'image/jpeg' | 'image/png' | 'image/webp'

export interface VisionRequest {
  /** Already prepared image bytes (rotated, metadata removed, ≤ maxSide). */
  image: Uint8Array
  mimeType: VisionImageMimeType
  /** Longest side of `image`, in pixels; providers refuse larger images. */
  maxSide: number
  /** What to extract. Product-specific prompts live in the application layer. */
  instruction: string
  jsonSchema?: StructuredOutputSchema
  maxOutputTokens?: number
  timeoutMs: number
  signal?: AbortSignal
}

export interface VisionResult {
  /** Parsed JSON output. Untrusted: the application layer validates it. */
  output: unknown
  metadata: ProviderMetadata
}

export interface VisionProvider {
  readonly name: string
  readonly model: string
  analyzeImage(request: VisionRequest): Promise<VisionResult>
}
