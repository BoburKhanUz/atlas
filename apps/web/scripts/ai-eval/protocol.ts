/**
 * The evaluation harness's own types (docs/plan/B7.md, B7.4c): the cases it
 * sends to `lookly eval`, the results it reads back, and the interface of the
 * scripted providers its stand-in serves. Nothing here comes from the web
 * app's source, so the harness outlives the TypeScript pipeline.
 */
import type { ConfidenceKey } from './catalog'

// ─── Provider errors ───────────────────────────────────────────────────────

/** The error kinds of a provider attempt (Go's ai.Kind values). */
export const AI_ERROR_KINDS = [
  'timeout', 'network', 'rate_limited', 'unavailable', 'auth', 'config', 'invalid_request', 'malformed_response', 'content_filtered', 'cancelled', 'provider_error',
] as const
export type AiErrorKind = (typeof AI_ERROR_KINDS)[number]

/** The kinds the app tries once more (Go's ai.Error.Retryable). */
export const RETRYABLE_KINDS: ReadonlySet<AiErrorKind> = new Set(['timeout', 'network', 'rate_limited', 'unavailable'])

/**
 * The kind of a scripted provider's failure: any error with a known `kind`
 * (the web app's AiProviderError included, while its pipeline runs the same
 * scripted providers); null for anything else.
 */
export function errorKindOf(err: unknown): AiErrorKind | null {
  const kind = typeof err === 'object' && err !== null ? (err as { kind?: unknown }).kind : undefined
  return (AI_ERROR_KINDS as readonly unknown[]).includes(kind) ? (kind as AiErrorKind) : null
}

// ─── The stand-in's scripted providers ─────────────────────────────────────

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** A JSON Schema the answer must follow. */
export interface StructuredOutputSchema {
  name: string
  schema: Record<string, unknown>
}

export interface ProviderUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

export interface ProviderMetadata {
  provider: string
  model: string
  usage: ProviderUsage
}

/** What the stand-in hands a scripted text provider (the request Go sent). */
export interface LLMRequest {
  messages: LLMMessage[]
  temperature?: number
  maxOutputTokens?: number
  jsonSchema?: StructuredOutputSchema
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

export interface VisionOptions {
  geminiMediaResolution?: 'low' | 'medium' | 'high' | 'ultra_high'
  geminiThinkingLevel?: 'none' | 'minimal' | 'low' | 'medium' | 'high'
  openaiDetail?: 'low' | 'high' | 'auto'
}

/** What the stand-in hands a scripted vision provider. */
export interface VisionRequest {
  image: Uint8Array
  mimeType: VisionImageMimeType
  maxSide: number
  instruction: string
  jsonSchema?: StructuredOutputSchema
  maxOutputTokens?: number
  options?: VisionOptions
  timeoutMs: number
  signal?: AbortSignal
}

export interface VisionResult {
  /** The model's JSON answer. */
  output: unknown
  metadata: ProviderMetadata
}

export interface VisionProvider {
  readonly name: string
  readonly model: string
  analyzeImage(request: VisionRequest): Promise<VisionResult>
}

/** Dollars a million tokens. */
export interface AiPrice {
  inputUsdPerMTok: number
  outputUsdPerMTok: number
}

// ─── Cases ─────────────────────────────────────────────────────────────────

export type Occasion = 'work' | 'wedding' | 'date' | 'travel' | 'casual' | 'other'

/** A wardrobe item as the outfit engine reads it. */
export interface WardrobeItemSummary {
  id: string
  category: string
  subcategory: string | null
  colors: string[]
  pattern: string | null
  material: string | null
  sleeveLength: string | null
  fit: string | null
  style: string | null
  season: string[]
  gender: string | null
  formality: string | null
}

/** A wardrobe item as the stylist's context reads it. */
export interface WardrobeRow extends WardrobeItemSummary {
  createdAt: Date
}

export interface WeatherSnapshot {
  temperature: number
  feelsLike: number
  condition: string
  precipitationProbability: number
  humidity: number
  windSpeed: number
  uvIndex: number
}

export interface StylePreferences {
  preferredStyles: string[]
  dislikedStyles: string[]
  favoriteColors: string[]
  dislikedColors: string[]
  preferredFit: string | null
}

/** The colour profile as the outfit engine reads it (null confidence: a profile from before confidences). */
export interface ColorProfileInput {
  season: string | null
  secondarySeason: string | null
  undertone: string | null
  confidence: number | null
  undertoneConfidence: number | null
  secondaryConfidence: number | null
  recommendedColors: string[]
  neutralColors: string[]
  cautionColors: string[]
}

/** The colour profile as the stylist's context reads it. */
export interface ColorProfileRow {
  season: string | null
  undertone: string | null
  contrastLevel: string | null
  recommendedColors: string[]
  neutralColors: string[]
  cautionColors: string[]
}

export type GenerateProblem = 'empty_wardrobe' | 'no_footwear' | 'no_main_pieces' | 'nothing_suitable'

export interface GarmentAttributes {
  category: string
  subcategory: string | null
  colors: string[]
  pattern: string | null
  material: string | null
  sleeveLength: string | null
  fit: string | null
  style: string | null
  season: string[]
  gender: string | null
  formality: string | null
}

export type ColorVerdict = 'supported' | 'weak' | 'conflict' | 'no_color'

// ─── Results of `lookly eval` ──────────────────────────────────────────────

/** A result line; `refused` instead when the request could not be read. */
export interface EvalResult<Outcome = unknown, Setup = unknown> {
  outcome: Outcome
  provider: string
  model: string
  calls: number
  requests: number
  inputTokens?: number
  outputTokens?: number
  latencyMs: number
  candidates?: number
  /** Each provider attempt's outcome, in order: 'ok' or an error kind. */
  attempts?: Array<'ok' | AiErrorKind | 'error'>
  setup?: Setup
}

export interface EvalRefusal {
  refused: string
}

export interface StylistSetup {
  refs: string[]
  messages: LLMMessage[]
  schema: StructuredOutputSchema
}

/** An engine outfit: its reference in the request, the engine's key, score, signals and items. */
export interface SetupCandidate {
  ref: string
  key: string
  score: number
  signals: Record<string, number>
  items: Array<{ item: WardrobeItemSummary; role: string }>
}

export interface OutfitSetup {
  candidates: SetupCandidate[]
  weatherProvided: boolean
  profileSent: boolean
  /** How strongly the engine used the colour profile; null when not at all. */
  profileStrength: number | null
  /** Why there are no outfits ('' when there are). */
  problem: GenerateProblem | ''
  /** The best outfit's deterministic explanation (what the user sees without the model). */
  fallbackExplanation: string | null
  messages: LLMMessage[]
  schema: StructuredOutputSchema
}

export interface VisionSetup {
  picture: { mimeType: VisionImageMimeType; width: number; height: number } | null
  schema: StructuredOutputSchema
}

export interface Versions {
  kind: 'versions'
  visionAnalysis: string
  stylistPrompt: string
  rankingPrompt: string
  engine: string
  colorAnalysis: string
}

/** The colour case's outcome: the analysis, a refusal, or an error. */
export type ColorOutcome =
  | { kind: 'profile'; profile: Record<string, unknown> }
  | { kind: 'rejected_quality'; reason: string }
  | { kind: 'rejected_skin' }
  | { kind: 'error'; error: 'picture_size' | 'unreadable_picture' | 'unexpected' }

/** The garment analysis's confidences, one for each key. */
export type GarmentConfidences = Record<ConfidenceKey, number>

// ─── The attempt gate (`lookly eval --gate`) ───────────────────────────────

/** What Go is about to send, asked before every provider attempt. */
export interface GateAsk {
  feature: string
  provider: string
  model: string
  text?: { messages: LLMMessage[]; temperature: number | null; maxOutputTokens: number | null; schema: StructuredOutputSchema | null }
  vision?: {
    mimeType: VisionImageMimeType
    /** The sent picture's size (0 when Go could not read it). */
    width: number
    height: number
    maxSide: number
    instruction: string
    schema: StructuredOutputSchema | null
    maxOutputTokens: number | null
    options: VisionOptions
  }
}

/** How an admitted attempt ended. */
export interface GateAttempted {
  outcome: 'ok' | AiErrorKind | 'error'
  inputTokens?: number
  outputTokens?: number
}

/** The harness's answer to every attempt Go makes. */
export interface AttemptGate {
  /** true: the attempt goes to the provider; false: it is refused (never sent, never counted). */
  ask(attempt: GateAsk): boolean | Promise<boolean>
  attempted(end: GateAttempted): void
}
