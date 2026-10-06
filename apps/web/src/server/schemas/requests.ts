/**
 * Request schemas for every JSON body and query string. Route handlers
 * validate with these, and the OpenAPI document (src/server/openapi) is
 * generated from the same objects — one source of truth.
 */
import { z } from 'zod'
import {
  categorySchema,
  colorSchema,
  colorsSchema,
  fitSchema,
  formalitySchema,
  genderSchema,
  materialSchema,
  occasionSchema,
  patternSchema,
  seasonsSchema,
  sleeveLengthSchema,
  styleSchema,
  subcategorySchema,
} from '@/server/schemas/catalog'
import { idSchema, partialWeatherSchema, weatherSnapshotSchema } from '@/server/schemas/common'

// ─── Auth ───────────────────────────────────────────────────────────────────

const INVALID_CREDENTIALS = 'Email yoki parol noto‘g‘ri'
/** Same limit as the session protocol (DEVICE_NAME_MAX). */
const deviceName = z.string().trim().min(1).max(100).describe('Mobile only: a label for the device in the session list (ignored for web).')
/** Same limit as the session protocol (REFRESH_TOKEN_MAX_LENGTH). */
const refreshToken = z.string().min(1).max(128)

export const LoginRequest = z.object({
  email: z.string().email(INVALID_CREDENTIALS),
  password: z.string().min(1, INVALID_CREDENTIALS).max(200),
  deviceName: deviceName.optional(),
})

export const RegisterRequest = z.object({
  email: z.string().email('Email noto‘g‘ri'),
  password: z.string().min(8, 'Parol kamida 8 belgi bo‘lishi kerak').max(200),
  name: z.string().min(1).max(60).optional(),
  deviceName: deviceName.optional(),
})

export const MobileRefreshRequest = z.object({ refreshToken })
export const MobileLogoutRequest = z.object({ refreshToken: refreshToken.optional() })

// ─── Wardrobe ───────────────────────────────────────────────────────────────

export const WardrobeListQuery = z.object({
  // one enum (not a union) so generated clients get a plain string enum
  category: z.enum(['all', ...categorySchema.options]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  cursor: idSchema.optional(),
})

export const WardrobeItemPatchRequest = z.object({
  category: categorySchema.optional(),
  subcategory: subcategorySchema.nullable().optional(),
  colors: colorsSchema.optional(),
  pattern: patternSchema.nullable().optional(),
  material: materialSchema.nullable().optional(),
  sleeveLength: sleeveLengthSchema.nullable().optional(),
  fit: fitSchema.nullable().optional(),
  style: styleSchema.nullable().optional(),
  season: seasonsSchema.optional(),
  gender: genderSchema.nullable().optional(),
  formality: formalitySchema.nullable().optional(),
})

// ─── Outfits ────────────────────────────────────────────────────────────────

export const OutfitListQuery = z.object({
  saved: z.enum(['0', '1', 'true', 'false']).optional(),
})

export const OutfitSaveRequest = z.object({
  occasion: occasionSchema.optional().nullable(),
  weather: weatherSnapshotSchema.optional().nullable(),
  name: z.string().trim().max(80).optional().nullable(),
  score: z.number().min(0).max(100).optional().nullable(),
  reasons: z.array(z.string().max(120)).max(20).optional(),
  explanation: z.string().max(2000).optional().nullable(),
  isSaved: z.boolean().optional(),
  items: z
    .array(
      z.object({
        itemId: idSchema,
        role: z.string().trim().min(1).max(30).describe('top, bottom, shoes or accessory (legacy roles), or dress, outerwear, footwear; must match the item category (validated)'),
      }),
    )
    .min(1)
    .max(12),
})

export const OutfitPatchRequest = z.object({
  isSaved: z.boolean().optional(),
  name: z.string().trim().max(80).nullable().optional(),
})

export const OutfitFeedbackRequest = z.object({
  feedback: z.enum(['liked', 'disliked', 'saved', 'rejected']),
  note: z.string().trim().max(500).optional(),
})

export const OutfitGenerateRequest = z.object({
  occasion: occasionSchema.optional().nullable(),
  weather: weatherSnapshotSchema.optional().nullable(),
  lat: z.number().min(-90).max(90).optional().nullable(),
  lon: z.number().min(-180).max(180).optional().nullable(),
  seed: z.number().finite().optional().describe('Omitted: the best outfits. Any number: a deterministic window of the top candidates (same seed, same result)'),
  topN: z.number().int().min(1).max(5).optional(),
})

// ─── Profile ────────────────────────────────────────────────────────────────

const freeText = z.string().trim().max(60).nullable().optional()

export const ProfilePatchRequest = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  profile: z
    .object({
      gender: z.enum(['male', 'female', 'other', 'unisex']).nullable().optional(),
      ageRange: freeText,
      height: z.number().min(50).max(250).nullable().optional(),
      weight: z.number().min(20).max(300).nullable().optional(),
      bodyShape: freeText,
      skinTone: freeText,
      skinUndertone: freeText,
      hairColor: freeText,
      eyeColor: freeText,
      clothingSize: freeText,
      preferredFit: fitSchema.nullable().optional(),
      typicalBudget: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
    })
    .optional(),
  preferences: z
    .object({
      preferredStyles: z.array(styleSchema).max(20).optional(),
      dislikedStyles: z.array(styleSchema).max(20).optional(),
      favoriteColors: z.array(colorSchema).max(20).optional(),
      dislikedColors: z.array(colorSchema).max(20).optional(),
      language: z.enum(['uz', 'ru', 'en']).optional(),
    })
    .optional(),
})

// ─── Stylist ────────────────────────────────────────────────────────────────

export const StylistChatRequest = z.object({
  message: z.string().trim().min(1, 'Xabar bo‘sh bo‘lmasligi kerak').max(2000).describe('Trimmed; 1–2000 characters'),
  conversationId: idSchema.nullable().optional(),
  weather: partialWeatherSchema.nullable().optional(),
  event: z.string().trim().max(60).nullable().optional().describe('Occasion the user typed (free text, trimmed; an occasion id or label is also used by the outfit engine)'),
})

// ─── Weather ────────────────────────────────────────────────────────────────

export const WeatherQuery = z.object({
  lat: z.coerce.number({ error: 'lat va lon parametrlari noto‘g‘ri' }).min(-90).max(90),
  lon: z.coerce.number({ error: 'lat va lon parametrlari noto‘g‘ri' }).min(-180).max(180),
})

// ─── Media ──────────────────────────────────────────────────────────────────

export const MediaQuery = z.object({
  exp: z.string().regex(/^\d{1,12}$/).describe('Expiry (unix seconds), part of the signed URL'),
  sig: z.string().min(1).describe('HMAC signature, part of the signed URL'),
})
