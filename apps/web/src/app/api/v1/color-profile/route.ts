import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth, unauthorized } from '@/lib/api-helpers'
import { withApi } from '@/server/http'
import { COLOR_DISCLAIMER } from '@/lib/ai/color-service'

export const runtime = 'nodejs'

const list = (raw: string): string[] => {
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

// GET /api/v1/color-profile — the user's current colour profile (spec section 10).
export const GET = withApi(async (req) => {
  const authUser = await requireAuth(req)
  if (!authUser) return unauthorized()

  const userProfile = await db.userProfile.findUnique({
    where: { userId: authUser.sub },
    include: { colorProfile: true },
  })

  if (!userProfile?.colorProfile) {
    return NextResponse.json({
      colorProfile: null,
      status: 'not_analyzed',
      message: 'Rang tahlilisi hali amalga oshirilmadi. Selfie yuklang.',
    })
  }

  const cp = userProfile.colorProfile
  return NextResponse.json({
    colorProfile: {
      id: cp.id,
      undertone: cp.undertone,
      undertoneConfidence: cp.undertoneConfidence,
      season: cp.season,
      secondarySeason: cp.secondarySeason,
      secondaryConfidence: cp.secondaryConfidence,
      confidence: cp.confidence,
      contrastLevel: cp.contrastLevel,
      recommendedColors: list(cp.recommendedColors),
      neutralColors: list(cp.neutralColors),
      cautionColors: list(cp.cautionColors),
      skinTone: userProfile.skinTone,
      hairColor: userProfile.hairColor,
      eyeColor: userProfile.eyeColor,
      analyzedAt: cp.createdAt,
    },
    status: 'analyzed',
    disclaimer: COLOR_DISCLAIMER,
  })
})

/**
 * DELETE /api/v1/color-profile — removes the colour profile and the values
 * derived from the selfie on the user profile (skin tone, undertone, hair and
 * eye colour). No selfie or image reference exists to delete: selfies are
 * never stored. Idempotent.
 */
export const DELETE = withApi(async (req) => {
  const authUser = await requireAuth(req)
  if (!authUser) return unauthorized()
  const userId = authUser.sub
  await db.$transaction([
    db.colorProfile.deleteMany({ where: { userId } }),
    db.userProfile.updateMany({
      where: { userId },
      data: { colorProfileId: null, skinTone: null, skinUndertone: null, hairColor: null, eyeColor: null },
    }),
  ])
  return NextResponse.json({ ok: true })
})
