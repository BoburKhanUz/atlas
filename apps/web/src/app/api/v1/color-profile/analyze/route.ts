import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth, unauthorized } from '@/lib/api-helpers'
import { ApiError, withApi, parseForm, UPLOAD_BODY_LIMIT } from '@/server/http'
import { log } from '@/server/log'
import { ImageDimensionsError, InvalidImageError, UnsupportedImageFormatError, checkImageEnvelope } from '@/lib/storage/provider'
import { COLOR_DISCLAIMER, analyzeColorSelfie, type ColorAnalysisResult } from '@/lib/ai/color-service'
import { PhotoQualityError, SkinNotVisibleError, type QualityProblem } from '@/lib/ai/color-analysis'

export const runtime = 'nodejs'
export const maxDuration = 60

const QUALITY_MESSAGES: Record<QualityProblem, string> = {
  too_dark: 'Rasm juda qorong‘i. Yorug‘roq joyda, yuzingizga yorug‘lik tushadigan selfi oling.',
  overexposed: 'Rasm juda yorug‘ (oqarib ketgan). To‘g‘ridan-to‘g‘ri quyosh yoki chiroqqa qaramasdan qayta oling.',
  blurry: 'Rasm xira chiqdi. Telefonni qimirlatmasdan, aniq selfi oling.',
  low_detail: 'Rasmda tahlil uchun yetarli tafsilot yo‘q. Yuzingiz aniq ko‘rinadigan selfi oling.',
  background: 'Yuz va fonni ajratib bo‘lmadi. Teriga o‘xshamagan, oddiy fon oldida suratga oling.',
}

function analysisError(err: unknown): never {
  if (err instanceof PhotoQualityError) {
    throw new ApiError('PHOTO_QUALITY_TOO_LOW', QUALITY_MESSAGES[err.reason], [{ path: 'reason', message: err.reason }])
  }
  if (err instanceof SkinNotVisibleError) throw new ApiError('SKIN_NOT_VISIBLE')
  if (err instanceof ImageDimensionsError) throw new ApiError('IMAGE_DIMENSIONS')
  if (err instanceof InvalidImageError || err instanceof UnsupportedImageFormatError) throw new ApiError('INVALID_IMAGE')
  log.error('color analysis failed', { err })
  throw new ApiError('ANALYSIS_UNAVAILABLE')
}

/**
 * POST /api/v1/color-profile/analyze — multipart `file` (selfie).
 *
 * Deterministic, in-process analysis (color-analysis-v2): the selfie is
 * decoded in memory and dropped; it is never stored, logged or sent to any
 * provider, and no AI quota is used. The result replaces the user's current
 * colour profile (one per user, no history).
 *
 * 422 INVALID_IMAGE / IMAGE_DIMENSIONS — not a usable image file;
 * 422 PHOTO_QUALITY_TOO_LOW (details: reason) / SKIN_NOT_VISIBLE — the photo
 * cannot be analysed; 503 ANALYSIS_UNAVAILABLE — the analysis itself failed.
 * Nothing is stored for any error.
 */
export const POST = withApi(async (req) => {
  const authUser = await requireAuth(req)
  if (!authUser) return unauthorized()
  const userId = authUser.sub

  const formData = await parseForm(req, UPLOAD_BODY_LIMIT)
  const file = formData.get('file')
  if (!(file instanceof File)) throw new ApiError('BAD_REQUEST', 'Rasm fayli topilmadi')
  const envelope = checkImageEnvelope(file)
  if (envelope === 'unsupported_type') throw new ApiError('INVALID_IMAGE', 'Faqat JPG, PNG yoki WEBP qo‘llab-quvvatlanadi')
  if (envelope === 'too_large') throw new ApiError('INVALID_IMAGE', 'Rasm 8 MB dan oshmasligi kerak')

  let analysis: ColorAnalysisResult
  try {
    analysis = await analyzeColorSelfie({ buffer: Buffer.from(await file.arrayBuffer()) })
  } catch (err) {
    analysisError(err)
  }

  const now = new Date()
  const fields = {
    undertone: analysis.undertone,
    season: analysis.season,
    contrastLevel: analysis.contrastLevel,
    recommendedColors: JSON.stringify(analysis.recommendedColors),
    neutralColors: JSON.stringify(analysis.neutralColors),
    cautionColors: JSON.stringify(analysis.cautionColors),
    analysisJson: JSON.stringify(analysis.analysis),
    analysisVersion: analysis.version,
    confidence: analysis.confidence,
    undertoneConfidence: analysis.undertoneConfidence,
    secondarySeason: analysis.secondarySeason,
    secondaryConfidence: analysis.secondaryConfidence,
    createdAt: now,
  }
  const derived = {
    skinTone: analysis.skinTone,
    skinUndertone: analysis.undertone,
    hairColor: analysis.hairColor,
    eyeColor: analysis.eyeColor,
  }
  // Replace the current profile (unique per user) and point the user profile at it, atomically.
  const profile = await db.$transaction(async (tx) => {
    const p = await tx.colorProfile.upsert({ where: { userId }, update: fields, create: { userId, ...fields } })
    await tx.userProfile.upsert({
      where: { userId },
      update: { ...derived, colorProfileId: p.id },
      create: { userId, ...derived, colorProfileId: p.id },
    })
    return p
  })

  return NextResponse.json({
    colorProfile: {
      id: profile.id,
      undertone: analysis.undertone,
      undertoneConfidence: analysis.undertoneConfidence,
      season: analysis.season,
      secondarySeason: analysis.secondarySeason,
      secondaryConfidence: analysis.secondaryConfidence,
      confidence: analysis.confidence,
      contrastLevel: analysis.contrastLevel,
      recommendedColors: analysis.recommendedColors,
      neutralColors: analysis.neutralColors,
      cautionColors: analysis.cautionColors,
      skinTone: analysis.skinTone,
      hairColor: analysis.hairColor,
      eyeColor: analysis.eyeColor,
      analyzedAt: profile.createdAt,
    },
    disclaimer: COLOR_DISCLAIMER,
  })
})
