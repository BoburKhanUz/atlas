import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/api-helpers'
import { ApiError, withApi } from '@/server/http'
import { consentRequired } from '@/server/legal-consent'

export const runtime = 'nodejs'

// GET /api/v1/auth/me — the currently authenticated user (atlas_at cookie or
// Bearer), also when the legal texts changed: `consentRequired` tells the
// client to show them for acceptance first.
const handler = withApi(async (req: NextRequest) => {
  const authUser = await requireAuth(req, { allowOutdatedConsent: true })
  if (!authUser) throw new ApiError('UNAUTHORIZED')

  const user = await db.user.findUnique({
    where: { id: authUser.sub },
    select: { id: true, email: true, name: true, createdAt: true },
  })
  if (!user) throw new ApiError('NOT_FOUND', 'Foydalanuvchi topilmadi')

  return NextResponse.json({ user, consentRequired: await consentRequired(user.id) })
})

export async function GET(req: NextRequest) {
  return handler(req, undefined)
}
