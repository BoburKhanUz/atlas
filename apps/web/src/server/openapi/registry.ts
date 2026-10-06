/**
 * Every API operation, described once: the OpenAPI document is generated from
 * this list (src/server/openapi/document.ts), and tests check that it matches
 * the route files exactly (tests/unit/openapi.test.ts) and that real handler
 * responses match the response schemas (tests/integration/contract.itest.ts).
 */
import { ZodType } from 'zod'
import type { ErrorCode } from '@/server/http'
import * as Req from '@/server/schemas/requests'
import * as Res from '@/server/schemas/responses'

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'

export interface SuccessResponse {
  status: number
  description: string
  /** JSON body schema; omitted for binary responses (`binary`). */
  schema?: ZodType
  binary?: string[]
  headers?: Record<string, string>
}

export interface Operation {
  method: HttpMethod
  /** OpenAPI path, e.g. /api/v1/outfits/{id}. */
  path: string
  /** Route directory under src/app, e.g. api/v1/outfits/[id]. */
  route: string
  operationId: string
  summary: string
  tags: string[]
  /** required: Bearer or atlas_at cookie; optional: used when present; none: public. */
  auth: 'required' | 'optional' | 'none'
  /** Accepts `X-Atlas-Client: mobile` (auth routes). */
  clientMode?: boolean
  /** Accepts `Idempotency-Key`. */
  idempotency?: boolean
  pathParams?: Record<string, string>
  query?: ZodType
  jsonBody?: ZodType
  /** Required JSON body only in mobile mode (refresh). */
  jsonBodyMobileOnly?: boolean
  multipart?: { fields: Record<string, { description: string; binary?: boolean; required?: boolean }> }
  success: SuccessResponse[]
  /** Operation-specific error codes (the contract tests trigger each one). */
  errors: ErrorCode[]
}

const ID = { id: 'Resource id' }

export const OPERATIONS: Operation[] = [
  // ─── Auth ─────────────────────────────────────────────────────────────────
  {
    method: 'POST', path: '/api/v1/auth/register', route: 'api/v1/auth/register', operationId: 'register', tags: ['auth'],
    summary: 'Create an account and sign in (web: cookies; mobile: tokens in the body)',
    auth: 'none', clientMode: true, jsonBody: Req.RegisterRequest,
    success: [{ status: 201, description: 'Signed in', schema: Res.AuthResponse, headers: { 'Set-Cookie': 'Web mode only: atlas_at and atlas_rt (HttpOnly)' } }],
    errors: ['CONFLICT', 'RATE_LIMITED'],
  },
  {
    method: 'POST', path: '/api/v1/auth/login', route: 'api/v1/auth/login', operationId: 'login', tags: ['auth'],
    summary: 'Sign in (web: cookies; mobile: tokens in the body)',
    auth: 'none', clientMode: true, jsonBody: Req.LoginRequest,
    success: [{ status: 200, description: 'Signed in', schema: Res.AuthResponse, headers: { 'Set-Cookie': 'Web mode only: atlas_at and atlas_rt (HttpOnly)' } }],
    errors: ['UNAUTHORIZED', 'RATE_LIMITED'],
  },
  {
    method: 'POST', path: '/api/v1/auth/refresh', route: 'api/v1/auth/refresh', operationId: 'refreshSession', tags: ['auth'],
    summary: 'Rotate the refresh token (web: atlas_rt cookie; mobile: body). A token rotated ≤ 60 s ago returns the same new token.',
    auth: 'none', clientMode: true, jsonBody: Req.MobileRefreshRequest, jsonBodyMobileOnly: true,
    success: [{ status: 200, description: 'New tokens', schema: Res.AuthResponse, headers: { 'Set-Cookie': 'Web mode only: atlas_at and atlas_rt (HttpOnly)' } }],
    errors: ['INVALID_TOKEN', 'SESSION_EXPIRED', 'SESSION_REVOKED', 'REFRESH_REUSED', 'SESSION_RACE', 'CLIENT_MISMATCH', 'SESSION_BUSY'],
  },
  {
    method: 'POST', path: '/api/v1/auth/logout', route: 'api/v1/auth/logout', operationId: 'logout', tags: ['auth'],
    summary: 'End this login (session family). Idempotent.',
    auth: 'optional', clientMode: true, jsonBody: Req.MobileLogoutRequest, jsonBodyMobileOnly: true,
    success: [{ status: 200, description: 'Logged out', schema: Res.OkResponse }],
    errors: ['SESSION_BUSY'],
  },
  {
    method: 'GET', path: '/api/v1/auth/me', route: 'api/v1/auth/me', operationId: 'getMe', tags: ['auth'],
    summary: 'The signed-in user', auth: 'required',
    success: [{ status: 200, description: 'Current user', schema: Res.MeResponse }],
    errors: ['NOT_FOUND'],
  },
  // ─── Account and profile ──────────────────────────────────────────────────
  {
    method: 'DELETE', path: '/api/v1/account', route: 'api/v1/account', operationId: 'deleteAccount', tags: ['account'],
    summary: 'Delete the account and all its data and images', auth: 'required',
    success: [{ status: 200, description: 'Deleted', schema: Res.OkResponse }],
    errors: ['NOT_FOUND'],
  },
  {
    method: 'GET', path: '/api/v1/profile', route: 'api/v1/profile', operationId: 'getProfile', tags: ['profile'],
    summary: 'Profile and style preferences', auth: 'required',
    success: [{ status: 200, description: 'Profile', schema: Res.ProfileResponse }],
    errors: ['NOT_FOUND'],
  },
  {
    method: 'PATCH', path: '/api/v1/profile', route: 'api/v1/profile', operationId: 'updateProfile', tags: ['profile'],
    summary: 'Update name, profile fields or preferences', auth: 'required', jsonBody: Req.ProfilePatchRequest,
    success: [{ status: 200, description: 'Updated', schema: Res.ProfilePatchResponse }],
    errors: [],
  },
  {
    method: 'GET', path: '/api/v1/color-profile', route: 'api/v1/color-profile', operationId: 'getColorProfile', tags: ['profile'],
    summary: 'The current colour profile (one per user). undertone: warm, neutral_warm, neutral, neutral_cool, cool or unknown; season null when no season is supported; hair/eye colour null when not measurable; confidences 0–1 (overall ≤ 0.8), null for profiles from before Phase 4.3.', auth: 'required',
    success: [{ status: 200, description: 'Colour profile, or status not_analyzed', schema: Res.ColorProfileResponse }],
    errors: [],
  },
  {
    method: 'DELETE', path: '/api/v1/color-profile', route: 'api/v1/color-profile', operationId: 'deleteColorProfile', tags: ['profile'],
    summary: 'Delete the colour profile and the selfie-derived skin tone, undertone, hair and eye colour (idempotent; selfies are never stored)', auth: 'required',
    success: [{ status: 200, description: 'Deleted (or there was nothing to delete)', schema: Res.OkResponse }],
    errors: [],
  },
  {
    method: 'POST', path: '/api/v1/color-profile/analyze', route: 'api/v1/color-profile/analyze', operationId: 'analyzeColorProfile', tags: ['profile'],
    summary: 'Analyse a selfie into a colour profile, replacing the current one. Deterministic and on the server only: the selfie is not stored, logged or sent to any AI provider. Nothing is stored for any error.',
    auth: 'required',
    multipart: { fields: { file: { description: 'Selfie (JPEG, PNG, WebP), ≤ 8 MB, shortest side ≥ 256 px', binary: true, required: true } } },
    success: [{ status: 200, description: 'Colour profile', schema: Res.ColorAnalysisResponse }],
    errors: ['BAD_REQUEST', 'INVALID_IMAGE', 'IMAGE_DIMENSIONS', 'PHOTO_QUALITY_TOO_LOW', 'SKIN_NOT_VISIBLE', 'ANALYSIS_UNAVAILABLE'],
  },
  // ─── Wardrobe ─────────────────────────────────────────────────────────────
  {
    method: 'POST', path: '/api/v1/wardrobe/items', route: 'api/v1/wardrobe/items', operationId: 'createWardrobeItem', tags: ['wardrobe'],
    summary: 'Upload a garment photo; returns the item with detected attributes', auth: 'required', idempotency: true,
    multipart: {
      fields: {
        file: { description: 'JPEG, PNG or WebP, ≤ 8 MB; shortest side ≥ 256 px, sides ≤ 8000 px. HEIC must be converted by the client.', binary: true, required: true },
        filename: { description: 'Optional name; a hint for the development mock only, never sent to an AI provider (defaults to the file name)' },
      },
    },
    success: [{ status: 201, description: 'Created (or replayed for a repeated Idempotency-Key)', schema: Res.WardrobeUploadResponse, headers: { 'Idempotent-Replayed': '"true" when this is the original response of an earlier request with the same Idempotency-Key' } }],
    errors: ['BAD_REQUEST', 'UNSUPPORTED_IMAGE_FORMAT', 'IMAGE_DIMENSIONS', 'INVALID_IMAGE', 'NOT_A_GARMENT', 'PAYLOAD_TOO_LARGE', 'UNSUPPORTED_MEDIA_TYPE', 'IDEMPOTENCY_KEY_MISMATCH', 'IDEMPOTENCY_IN_PROGRESS', 'NOT_FOUND', 'AI_QUOTA_EXCEEDED', 'AI_UNAVAILABLE'],
  },
  {
    method: 'GET', path: '/api/v1/wardrobe/items', route: 'api/v1/wardrobe/items', operationId: 'listWardrobeItems', tags: ['wardrobe'],
    summary: 'Wardrobe items, newest first (cursor pagination)', auth: 'required', query: Req.WardrobeListQuery,
    success: [{ status: 200, description: 'A page of items', schema: Res.WardrobeListResponse }],
    errors: [],
  },
  {
    method: 'GET', path: '/api/v1/wardrobe/items/{id}', route: 'api/v1/wardrobe/items/[id]', operationId: 'getWardrobeItem', tags: ['wardrobe'],
    summary: 'One wardrobe item', auth: 'required', pathParams: ID,
    success: [{ status: 200, description: 'The item', schema: Res.WardrobeItemResponse }],
    errors: ['NOT_FOUND'],
  },
  {
    method: 'PATCH', path: '/api/v1/wardrobe/items/{id}', route: 'api/v1/wardrobe/items/[id]', operationId: 'updateWardrobeItem', tags: ['wardrobe'],
    summary: 'Correct detected attributes (recorded in correctionLog)', auth: 'required', pathParams: ID, jsonBody: Req.WardrobeItemPatchRequest,
    success: [{ status: 200, description: 'Updated item and the recorded corrections', schema: Res.WardrobePatchResponse }],
    errors: ['NOT_FOUND'],
  },
  {
    method: 'DELETE', path: '/api/v1/wardrobe/items/{id}', route: 'api/v1/wardrobe/items/[id]', operationId: 'deleteWardrobeItem', tags: ['wardrobe'],
    summary: 'Delete an item and its images', auth: 'required', pathParams: ID,
    success: [{ status: 200, description: 'Deleted', schema: Res.OkResponse }],
    errors: ['NOT_FOUND'],
  },
  {
    method: 'GET', path: '/api/v1/media/{key}', route: 'api/v1/media/[...key]', operationId: 'getMedia', tags: ['media'],
    summary: 'A private image through its signed URL (use the URLs from API responses as-is)', auth: 'none',
    pathParams: { key: 'Storage key (contains "/"; part of the signed URL)' }, query: Req.MediaQuery,
    success: [{ status: 200, description: 'Image bytes', binary: ['image/webp', 'image/jpeg', 'image/png'] }],
    errors: ['NOT_FOUND'],
  },
  // ─── Outfits ──────────────────────────────────────────────────────────────
  {
    method: 'POST', path: '/api/v1/outfits/generate', route: 'api/v1/outfits/generate', operationId: 'generateOutfits', tags: ['outfits'],
    summary: 'Generate outfit suggestions from the wardrobe', auth: 'required', jsonBody: Req.OutfitGenerateRequest,
    success: [{ status: 200, description: 'Suggestions (empty with a message when the wardrobe is not enough)', schema: Res.OutfitGenerateResponse }],
    errors: [],
  },
  {
    method: 'GET', path: '/api/v1/outfits', route: 'api/v1/outfits', operationId: 'listOutfits', tags: ['outfits'],
    summary: 'Recent outfits (50), optionally saved only', auth: 'required', query: Req.OutfitListQuery,
    success: [{ status: 200, description: 'Outfits', schema: Res.OutfitListResponse }],
    errors: [],
  },
  {
    method: 'POST', path: '/api/v1/outfits', route: 'api/v1/outfits', operationId: 'saveOutfit', tags: ['outfits'],
    summary: 'Save an outfit made of own wardrobe items', auth: 'required', jsonBody: Req.OutfitSaveRequest,
    success: [{ status: 201, description: 'Saved outfit', schema: Res.OutfitSaveResponse }],
    errors: ['FORBIDDEN'],
  },
  {
    method: 'GET', path: '/api/v1/outfits/{id}', route: 'api/v1/outfits/[id]', operationId: 'getOutfit', tags: ['outfits'],
    summary: 'One outfit with its items', auth: 'required', pathParams: ID,
    success: [{ status: 200, description: 'The outfit', schema: Res.OutfitDetailResponse }],
    errors: ['NOT_FOUND'],
  },
  {
    method: 'PATCH', path: '/api/v1/outfits/{id}', route: 'api/v1/outfits/[id]', operationId: 'updateOutfit', tags: ['outfits'],
    summary: 'Rename or (un)save an outfit', auth: 'required', pathParams: ID, jsonBody: Req.OutfitPatchRequest,
    success: [{ status: 200, description: 'Updated', schema: Res.OutfitPatchResponse }],
    errors: ['NOT_FOUND'],
  },
  {
    method: 'DELETE', path: '/api/v1/outfits/{id}', route: 'api/v1/outfits/[id]', operationId: 'deleteOutfit', tags: ['outfits'],
    summary: 'Delete an outfit', auth: 'required', pathParams: ID,
    success: [{ status: 200, description: 'Deleted', schema: Res.OkResponse }],
    errors: ['NOT_FOUND'],
  },
  {
    method: 'POST', path: '/api/v1/outfits/{id}/feedback', route: 'api/v1/outfits/[id]/feedback', operationId: 'sendOutfitFeedback', tags: ['outfits'],
    summary: 'Like, dislike, save or reject an outfit', auth: 'required', pathParams: ID, jsonBody: Req.OutfitFeedbackRequest,
    success: [{ status: 201, description: 'Recorded', schema: Res.OutfitFeedbackResponse }],
    errors: ['NOT_FOUND'],
  },
  // ─── Stylist ──────────────────────────────────────────────────────────────
  {
    method: 'POST', path: '/api/v1/stylist/chat', route: 'api/v1/stylist/chat', operationId: 'stylistChat', tags: ['stylist'],
    summary: 'Send a message to the AI stylist. The user message and the answer are stored together, only when the turn succeeds: any error (incl. 503 AI_UNAVAILABLE and 429 AI_QUOTA_EXCEEDED) stores nothing. An unknown or foreign conversationId is 404 (never a new conversation).',
    auth: 'required', idempotency: true, jsonBody: Req.StylistChatRequest,
    success: [{ status: 200, description: 'Assistant reply (or the original reply, replayed for a repeated Idempotency-Key)', schema: Res.StylistChatResponse, headers: { 'Idempotent-Replayed': '"true" when this is the original response of an earlier request with the same Idempotency-Key' } }],
    errors: ['NOT_FOUND', 'IDEMPOTENCY_KEY_MISMATCH', 'IDEMPOTENCY_IN_PROGRESS', 'AI_QUOTA_EXCEEDED', 'AI_UNAVAILABLE'],
  },
  {
    method: 'GET', path: '/api/v1/stylist/conversations', route: 'api/v1/stylist/conversations', operationId: 'listConversations', tags: ['stylist'],
    summary: 'Recent stylist conversations (50)', auth: 'required',
    success: [{ status: 200, description: 'Conversations', schema: Res.ConversationListResponse }],
    errors: [],
  },
  {
    method: 'GET', path: '/api/v1/stylist/conversations/{id}', route: 'api/v1/stylist/conversations/[id]', operationId: 'getConversation', tags: ['stylist'],
    summary: 'A conversation with its messages', auth: 'required', pathParams: ID,
    success: [{ status: 200, description: 'The conversation', schema: Res.ConversationResponse }],
    errors: ['NOT_FOUND'],
  },
  // ─── Weather and service ──────────────────────────────────────────────────
  {
    method: 'GET', path: '/api/v1/weather/current', route: 'api/v1/weather/current', operationId: 'getCurrentWeather', tags: ['weather'],
    summary: 'Current weather (cached 30 min per ~1 km cell)', auth: 'required', query: Req.WeatherQuery,
    success: [{ status: 200, description: 'Weather', schema: Res.WeatherResponse }],
    errors: [],
  },
  {
    method: 'GET', path: '/api/health', route: 'api/health', operationId: 'getHealth', tags: ['service'],
    summary: 'Liveness and database check', auth: 'none',
    success: [
      { status: 200, description: 'Healthy', schema: Res.HealthResponse },
      { status: 503, description: 'Database unreachable', schema: Res.HealthResponse },
    ],
    errors: [],
  },
  {
    method: 'GET', path: '/api/v1/openapi.json', route: 'api/v1/openapi.json', operationId: 'getOpenApiDocument', tags: ['service'],
    summary: 'This OpenAPI document', auth: 'none',
    success: [{ status: 200, description: 'OpenAPI 3.1 document', schema: undefined, binary: ['application/json'] }],
    errors: [],
  },
]

/** Named component schemas: request bodies/queries (input form) and responses (output form). */
const zodExports = (mod: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(mod).filter((e): e is [string, ZodType] => e[1] instanceof ZodType))
export const REQUEST_COMPONENTS: Record<string, ZodType> = zodExports(Req)
export const RESPONSE_COMPONENTS: Record<string, ZodType> = zodExports(Res)
