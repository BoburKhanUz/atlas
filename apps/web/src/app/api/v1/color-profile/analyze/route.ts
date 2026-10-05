import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth, unauthorized } from '@/lib/api-helpers'
import { ApiError, withApi, parseForm, UPLOAD_BODY_LIMIT } from '@/server/http'
import { log } from '@/server/log'
import { InvalidImageError } from '@/lib/storage/provider'
import { analyzeSelfie, type ColorAnalysisResult } from '@/lib/ai/color-analysis'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * POST /api/v1/color-profile/analyze
 * Multipart form-data:
 *   - file: selfie image (required)
 *
 * Runs color analysis on the uploaded selfie, persists the result as a
 * ColorProfile row, links it to the user's UserProfile, and returns the
 * derived palette. Spec section 10.
 */
export const POST = withApi(async (req) => {
  const authUser = await requireAuth(req)
  if (!authUser) return unauthorized()

  // Size/type checks happen before the body is read.
  const formData = await parseForm(req, UPLOAD_BODY_LIMIT)
  const file = formData.get('file')
  if (!(file instanceof File)) {
    throw new ApiError('BAD_REQUEST', 'Rasm fayli topilmadi')
  }

  // Validate file type
  const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic']
  if (!allowed.includes(file.type.toLowerCase())) {
    throw new ApiError('INVALID_IMAGE', 'Faqat JPG, PNG, WEBP yoki HEIC qo‘llab-quvvatlanadi')
  }
  if (file.size > 8 * 1024 * 1024) {
    throw new ApiError('INVALID_IMAGE', 'Rasm 8 MB dan oshmasligi kerak')
  }

  // Convert File → Buffer for sharp analysis
  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  // Run analysis
  let analysis: ColorAnalysisResult
  try {
    analysis = await analyzeSelfie({ buffer })
  } catch (err) {
    if (err instanceof InvalidImageError) {
      throw new ApiError('INVALID_IMAGE')
    }
    log.error('color analysis failed', { err })
    throw new ApiError('INTERNAL', 'Rasm tahlil qilinmadi. Boshqa rasm bilan urinib ko‘ring.')
  }

  // Persist the ColorProfile — spec section 10 + schema model ColorProfile
  const profile = await db.colorProfile.create({
    data: {
      userId: authUser.sub,
      undertone: analysis.undertone,
      season: analysis.season,
      contrastLevel: analysis.contrastLevel,
      recommendedColors: JSON.stringify(analysis.recommendedColors),
      neutralColors: JSON.stringify(analysis.neutralColors),
      cautionColors: JSON.stringify(analysis.cautionColors),
      analysisJson: JSON.stringify(analysis.analysis),
    },
  })

  // Link the ColorProfile to the user's UserProfile (or create profile if missing)
  await db.userProfile.upsert({
    where: { userId: authUser.sub },
    update: {
      skinTone: analysis.skinTone,
      skinUndertone: analysis.undertone,
      hairColor: analysis.hairColor,
      eyeColor: analysis.eyeColor,
      colorProfileId: profile.id,
    },
    create: {
      userId: authUser.sub,
      skinTone: analysis.skinTone,
      skinUndertone: analysis.undertone,
      hairColor: analysis.hairColor,
      eyeColor: analysis.eyeColor,
      colorProfileId: profile.id,
    },
  })

  return NextResponse.json({
    colorProfile: {
      id: profile.id,
      undertone: analysis.undertone,
      season: analysis.season,
      contrastLevel: analysis.contrastLevel,
      recommendedColors: analysis.recommendedColors,
      neutralColors: analysis.neutralColors,
      cautionColors: analysis.cautionColors,
      skinTone: analysis.skinTone,
      hairColor: analysis.hairColor,
      eyeColor: analysis.eyeColor,
      confidence: analysis.analysis.confidence,
      analyzedAt: profile.createdAt,
    },
    // Spec rule: "Always present as an AI recommendation, not diagnosis"
    disclaimer:
      'Bu AI tavsiyasi — tibbiy yoki ilmiy diagnosis emas. Faqat styling maqsadida.',
  })
})
