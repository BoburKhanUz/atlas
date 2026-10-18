import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/api-helpers'
import { LegalConsentRequest } from '@/server/schemas/requests'
import { ApiError, parseJson, withApi } from '@/server/http'
import { recordConsent } from '@/server/legal-consent'

export const runtime = 'nodejs'

// POST /api/v1/legal/consent — the signed-in user accepts the current legal
// texts again after they changed (CONSENT_REQUIRED); registration records the
// first consent. Allowed without the current consent, by definition.
const handler = withApi(async (req: NextRequest) => {
  const authUser = await requireAuth(req, { allowOutdatedConsent: true })
  if (!authUser) throw new ApiError('UNAUTHORIZED')

  const { acceptedLegalVersion, ageConfirmed } = await parseJson(req, LegalConsentRequest)
  // A deleted account's access token stays valid for minutes: no orphan consent.
  const user = await db.user.findUnique({ where: { id: authUser.sub }, select: { id: true } })
  if (!user) throw new ApiError('UNAUTHORIZED')

  await recordConsent(user.id, acceptedLegalVersion, ageConfirmed)
  return NextResponse.json({ ok: true })
})

export async function POST(req: NextRequest) {
  return handler(req, undefined)
}
