import { NextRequest, NextResponse } from 'next/server'
import {
  REFRESH_COOKIE,
  clearSessionCookies,
  clientTypeOf,
  mobileTokenBody,
  rotateSession,
  setSessionCookies,
} from '@/lib/session'
import { MobileRefreshRequest } from '@/server/schemas/requests'
import { ApiError, errorResponse, parseJson, requestIdOf, sessionBusy, withApi } from '@/server/http'

export const runtime = 'nodejs'

// POST /api/v1/auth/refresh — rotate the refresh token (or replay a rotation
// that happened ≤ 60 s ago: same refresh token, new access token).
//   web:    reads the atlas_rt cookie; 200 { user } + new cookies.
//   mobile (X-Atlas-Client: mobile): body { refreshToken }; 200 with tokens, no cookies.
// Failures: 401 with code INVALID_TOKEN | SESSION_EXPIRED | SESSION_REVOKED |
// REFRESH_REUSED | CLIENT_MISMATCH (terminal: web cookies are cleared) or
// SESSION_RACE (retry; cookies untouched), 503 SESSION_BUSY + Retry-After.
const handler = withApi(async (req: NextRequest) => {
  const clientType = clientTypeOf(req)
  const token =
    clientType === 'mobile' ? (await parseJson(req, MobileRefreshRequest)).refreshToken : req.cookies.get(REFRESH_COOKIE)?.value
  const result = await rotateSession(token, { clientType, userAgent: req.headers.get('user-agent') })

  if (!result.ok) {
    const res = errorResponse(result.code === 'SESSION_BUSY' ? sessionBusy() : new ApiError(result.code), requestIdOf(req))
    if (clientType === 'web' && result.clearCookies) clearSessionCookies(res)
    return res
  }
  if (clientType === 'mobile') return NextResponse.json(mobileTokenBody(result.user, result.issued))
  const res = NextResponse.json({ user: result.user })
  setSessionCookies(res, result.issued)
  return res
})

export async function POST(req: NextRequest) {
  return handler(req, undefined)
}
