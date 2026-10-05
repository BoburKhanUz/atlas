import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth, unauthorized } from '@/lib/api-helpers'
import { withApi } from '@/server/http'

export const runtime = 'nodejs'

// GET /api/v1/color-profile — return the user's saved ColorProfile.
// Spec section 10. Returns null if not analyzed yet.
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
      season: cp.season,
      contrastLevel: cp.contrastLevel,
      recommendedColors: JSON.parse(cp.recommendedColors),
      neutralColors: JSON.parse(cp.neutralColors),
      cautionColors: JSON.parse(cp.cautionColors),
      skinTone: userProfile.skinTone,
      hairColor: userProfile.hairColor,
      eyeColor: userProfile.eyeColor,
      analyzedAt: cp.createdAt,
    },
    status: 'analyzed',
    disclaimer:
      'Bu AI tavsiyasi — tibbiy yoki ilmiy diagnosis emas. Faqat styling maqsadida.',
  })
})
