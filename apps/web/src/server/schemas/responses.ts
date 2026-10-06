/**
 * Response schemas for every API operation (documentation + contract tests).
 * Objects are explicit: `z.strictObject` where the response has exactly these
 * fields, `z.looseObject` where the handler returns a database row that may
 * carry more columns than are documented. Never plain `z.object` here: the
 * contract tests parse real responses with these schemas, so strictness must
 * match what the OpenAPI document says (`additionalProperties`).
 */
import { z } from 'zod'

const DateTime = z.iso.datetime().describe('ISO 8601, UTC')
const nullableString = z.string().nullable()
const nullableNumber = z.number().nullable()
const Int = z.number().int()

// ─── Errors ─────────────────────────────────────────────────────────────────

export const ERROR_CODES = [
  'BAD_REQUEST',
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'INVALID_IMAGE',
  'UNSUPPORTED_IMAGE_FORMAT',
  'IMAGE_DIMENSIONS',
  'IDEMPOTENCY_KEY_MISMATCH',
  'IDEMPOTENCY_IN_PROGRESS',
  'RATE_LIMITED',
  'INTERNAL',
  'INVALID_TOKEN',
  'SESSION_EXPIRED',
  'SESSION_REVOKED',
  'REFRESH_REUSED',
  'SESSION_RACE',
  'CLIENT_MISMATCH',
  'SESSION_BUSY',
  'NOT_A_GARMENT',
  'AI_QUOTA_EXCEEDED',
  'AI_UNAVAILABLE',
  'PHOTO_QUALITY_TOO_LOW',
  'SKIN_NOT_VISIBLE',
  'ANALYSIS_UNAVAILABLE',
] as const

export const ErrorResponse = z
  .strictObject({
    error: z.string().describe('User-facing message (Uzbek)'),
    code: z.enum(ERROR_CODES),
    details: z.array(z.strictObject({ path: z.string(), message: z.string() })).optional(),
    requestId: z.string().optional(),
  })
  .describe('Every error response. Clients branch on `code`, never on `error`.')

export const OkResponse = z.strictObject({ ok: z.literal(true) })

// ─── Auth ───────────────────────────────────────────────────────────────────

export const SessionUser = z.strictObject({ id: z.string(), email: z.string(), name: nullableString })

export const WebAuthResponse = z.strictObject({ user: SessionUser }).describe('Web mode: tokens are only in HttpOnly cookies')

export const MobileAuthResponse = z
  .strictObject({
    user: SessionUser,
    accessToken: z.string(),
    accessTokenExpiresAt: DateTime,
    refreshToken: z.string(),
    refreshTokenExpiresAt: DateTime,
    sessionExpiresAt: DateTime.describe('Absolute limit of this login (90 days); refresh is impossible afterwards'),
  })
  .describe('Mobile mode (X-Atlas-Client: mobile): tokens in the body, no cookies')

export const AuthResponse = z.union([MobileAuthResponse, WebAuthResponse])

export const MeResponse = z.strictObject({
  user: z.strictObject({ id: z.string(), email: z.string(), name: nullableString, createdAt: DateTime }),
})

// ─── Wardrobe ───────────────────────────────────────────────────────────────

export const ImageObject = z
  .strictObject({
    id: z.string(),
    url: z.string().describe('Signed URL of the 1600 px display image (absolute when PUBLIC_BASE_URL is set)'),
    thumbnailUrl: nullableString.describe('Signed URL of the 400 px thumbnail'),
    urlExpiresAt: DateTime.describe('When url and thumbnailUrl stop working; cache images by id + variant'),
    isPrimary: z.boolean(),
    width: Int.nullable(),
    height: Int.nullable(),
  })
  .describe('A stored garment image. The full-resolution master is never exposed.')

export const CorrectionLogEntry = z.strictObject({ field: z.string(), from: z.string(), to: z.string(), at: DateTime })

const garmentAttributes = {
  category: z.string(),
  subcategory: nullableString,
  colors: z.array(z.string()),
  pattern: nullableString,
  material: nullableString,
  sleeveLength: nullableString,
  fit: nullableString,
  style: nullableString,
  season: z.array(z.string()),
  gender: nullableString,
  formality: nullableString,
}

export const WardrobeItem = z.strictObject({
  id: z.string(),
  ...garmentAttributes,
  confidences: z.record(z.string(), z.number()),
  wasCorrected: z.boolean(),
  correctionLog: z.array(CorrectionLogEntry),
  images: z.array(ImageObject),
  primaryImage: ImageObject.nullable(),
  createdAt: DateTime,
  updatedAt: DateTime,
})

export const Detection = z
  .strictObject({
    ...garmentAttributes,
    confidence: z.record(z.string(), z.number()),
    mock: z.boolean().describe('true when the deterministic development mock produced the attributes; false for a real vision provider'),
  })
  .describe('Attributes detected from the photo')

export const WardrobeUploadResponse = z.strictObject({ item: WardrobeItem, detection: Detection })
export const WardrobeListResponse = z.strictObject({ items: z.array(WardrobeItem), nextCursor: nullableString })
export const WardrobeItemResponse = z.strictObject({ item: WardrobeItem })
export const WardrobePatchResponse = z.strictObject({ item: WardrobeItem, corrections: z.array(CorrectionLogEntry) })

// ─── Outfits ────────────────────────────────────────────────────────────────

const WeatherSnapshot = z.strictObject({
  temperature: z.number(),
  feelsLike: z.number(),
  condition: z.string(),
  precipitationProbability: z.number(),
  humidity: z.number(),
  windSpeed: z.number(),
  uvIndex: z.number(),
})

const outfitItemSummary = {
  id: z.string(),
  role: nullableString,
  category: z.string(),
  subcategory: nullableString,
  colors: z.array(z.string()),
  style: nullableString,
  material: nullableString,
  season: z.array(z.string()),
}

export const OutfitSummaryItem = z.strictObject({ ...outfitItemSummary, image: ImageObject.nullable() })

export const OutfitSummary = z.strictObject({
  id: z.string(),
  name: nullableString,
  occasion: nullableString,
  score: Int.nullable(),
  reasons: z.array(z.string()),
  explanation: nullableString,
  isSaved: z.boolean(),
  weatherSnapshot: z.record(z.string(), z.unknown()).describe('Weather the outfit was generated for ({} when unknown)'),
  createdAt: DateTime,
  items: z.array(OutfitSummaryItem),
})
export const OutfitListResponse = z.strictObject({ outfits: z.array(OutfitSummary) })

/** An outfit database row (more columns may be present). */
export const OutfitRow = z.looseObject({
  id: z.string(),
  name: nullableString,
  occasion: nullableString,
  score: Int.nullable(),
  explanation: nullableString,
  isSaved: z.boolean(),
  createdAt: DateTime,
  updatedAt: DateTime,
})
export const OutfitSaveResponse = z.strictObject({
  outfit: OutfitRow.extend({ items: z.array(z.looseObject({ id: z.string(), wardrobeItemId: z.string(), role: nullableString })) }),
})
export const OutfitPatchResponse = z.strictObject({ outfit: OutfitRow })

export const OutfitDetailItem = z.strictObject({
  id: z.string(),
  role: nullableString,
  wardrobeItemId: z.string(),
  item: z.strictObject({
    id: z.string(),
    category: z.string(),
    subcategory: nullableString,
    colors: z.array(z.string()),
    style: nullableString,
    material: nullableString,
    season: z.array(z.string()),
    images: z.array(ImageObject),
  }),
})

export const OutfitDetail = OutfitRow.extend({
  reasons: z.array(z.string()),
  weatherSnapshot: z.record(z.string(), z.unknown()),
  items: z.array(OutfitDetailItem),
})

export const OutfitDetailResponse = z.strictObject({ outfit: OutfitDetail })

export const OutfitFeedbackResponse = z.strictObject({
  feedback: z.looseObject({ id: z.string(), outfitId: z.string(), feedback: z.string(), note: nullableString, createdAt: DateTime }),
})

export const OutfitGenerateResponse = z.strictObject({
  outfits: z.array(
    z.strictObject({
      tempId: z.string(),
      score: z.number(),
      factors: z.strictObject({
        weather: z.number(),
        color: z.number(),
        occasion: z.number(),
        style: z.number(),
        season: z.number(),
        balance: z.number(),
        preference: z.number(),
        feedback: z.number(),
      }),
      reasons: z.array(z.string()).describe('Internal reason codes (stable, for debugging); show reasonLabels to users'),
      reasonLabels: z.array(z.string()).describe('User-facing reason labels (Uzbek), same order as reasons'),
      contrastLevel: z.enum(['low', 'medium', 'high']),
      items: z.array(
        z.strictObject({
          ...outfitItemSummary,
          role: z.string().describe('Legacy role: top, bottom, shoes or accessory (dresses and outerwear are "top")'),
          layeringRole: z.enum(['top', 'bottom', 'dress', 'outerwear', 'footwear', 'accessory']),
          imageUrl: nullableString,
        }),
      ),
      explanation: nullableString,
    }),
  ),
  weatherUsed: WeatherSnapshot.nullable(),
  occasion: nullableString,
  wardrobeItemCount: Int,
  fallback: z.boolean().describe('true when the optional AI ranking/explanation was not used (deterministic order and explanations)'),
  message: z.string().optional().describe('Why no outfits were generated'),
})

// ─── Profile and colour analysis ────────────────────────────────────────────

export const ProfileRow = z.looseObject({ id: z.string(), userId: z.string() }).describe('UserProfile row')
export const PreferencesRow = z.looseObject({ id: z.string(), userId: z.string(), language: z.string() }).describe('UserPreferences row (list fields as JSON strings)')
export const ProfilePreferences = z.looseObject({
  language: z.string(),
  preferredStyles: z.array(z.string()),
  dislikedStyles: z.array(z.string()),
  favoriteColors: z.array(z.string()),
  dislikedColors: z.array(z.string()),
})
export const ProfileUser = z.looseObject({ id: z.string(), email: z.string(), name: nullableString, createdAt: DateTime, profile: ProfileRow.nullable(), preferences: PreferencesRow.nullable() })

export const ProfileResponse = z.strictObject({
  user: ProfileUser,
  profile: ProfileRow.nullable(),
  preferences: ProfilePreferences.nullable(),
})

export const ProfilePatchResponse = z.strictObject({
  user: z.looseObject({ id: z.string(), email: z.string(), name: nullableString, profile: ProfileRow.nullable(), preferences: PreferencesRow.nullable() }),
})

/**
 * Phase 4.3: undertone is warm, neutral_warm, neutral, neutral_cool, cool or
 * unknown (weak evidence); season is null when the photo supports none;
 * hair/eye colours are null when they could not be measured reliably;
 * confidences are 0–1 (capped: overall 0.8, undertone 0.75) and null for
 * profiles from before Phase 4.3.
 */
const colorProfileFields = {
  id: z.string(),
  undertone: nullableString,
  undertoneConfidence: nullableNumber,
  season: nullableString,
  secondarySeason: nullableString,
  secondaryConfidence: nullableNumber,
  confidence: nullableNumber,
  contrastLevel: nullableString,
  recommendedColors: z.array(z.string()),
  neutralColors: z.array(z.string()),
  cautionColors: z.array(z.string()),
  skinTone: nullableString,
  hairColor: nullableString,
  eyeColor: nullableString,
  analyzedAt: DateTime,
}

export const ColorProfileResponse = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('not_analyzed'), colorProfile: z.null(), message: z.string() }),
  z.strictObject({ status: z.literal('analyzed'), colorProfile: z.strictObject(colorProfileFields), disclaimer: z.string() }),
])

export const ColorAnalysisResponse = z.strictObject({
  colorProfile: z.strictObject({ ...colorProfileFields, confidence: z.number() }),
  disclaimer: z.string(),
})

// ─── Stylist ────────────────────────────────────────────────────────────────

export const StylistChatResponse = z.strictObject({
  conversationId: z.string(),
  assistantMessage: z.string().describe('The stylist answer; wardrobe items are named in plain words (no internal references or ids)'),
  contextSummary: z.strictObject({
    wardrobeItemCount: Int.describe('Wardrobe items given to the stylist for this answer (at most 40)'),
    weatherProvided: z.boolean(),
    eventProvided: z.boolean(),
  }),
})

export const ConversationListResponse = z.strictObject({
  conversations: z.array(
    z.strictObject({ id: z.string(), title: nullableString, updatedAt: DateTime, lastMessage: nullableString, lastRole: nullableString }),
  ),
})

export const ConversationResponse = z.strictObject({
  conversation: z.looseObject({
    id: z.string(),
    title: nullableString,
    createdAt: DateTime,
    updatedAt: DateTime,
    messages: z.array(z.strictObject({ id: z.string(), role: z.string(), content: z.string(), createdAt: DateTime })),
  }),
})

// ─── Weather, health ────────────────────────────────────────────────────────

export const WeatherResponse = z.strictObject({
  weather: z.strictObject({
    temperature: z.number(),
    feelsLike: z.number(),
    condition: z.string(),
    conditionLabel: z.string(),
    precipitationProbability: z.number(),
    precipitationAmount: z.number(),
    humidity: z.number(),
    windSpeed: z.number(),
    uvIndex: z.number(),
    source: z.string(),
    fetchedAt: DateTime,
    cached: z.boolean(),
  }),
})

export const HealthResponse = z.strictObject({
  status: z.enum(['ok', 'degraded']),
  database: z.enum(['ok', 'unreachable']),
  version: z.string(),
})
