import { NextRequest, NextResponse } from 'next/server'
import { REFRESH_COOKIE, authenticateRequest, clearSessionCookies, clientTypeOf, revokeSession } from '@/lib/session'
import { MobileLogoutRequest } from '@/server/schemas/requests'
import { parseJson, sessionBusy, withApi } from '@/server/http'

export const runtime = 'nodejs'

// POST /api/v1/auth/logout — revoke the current session family (this device's
// login, including every rotated token) and, for web, clear both cookies.
//   web:    atlas_rt cookie and/or the access token's sid.
//   mobile (X-Atlas-Client: mobile): body { refreshToken } and/or Bearer sid.
// Idempotent: 200 { ok: true } even when already logged out. 503 SESSION_BUSY
// (cookies kept) when the session store is busy — retry.
const handler = withApi(async (req: NextRequest) => {
  const clientType = clientTypeOf(req)
  const { user } = await authenticateRequest(req)
  const refreshToken =
    clientType === 'mobile' ? (await parseJson(req, MobileLogoutRequest)).refreshToken : req.cookies.get(REFRESH_COOKIE)?.value
  const result = await revokeSession({ refreshToken, sid: user?.sid, userId: user?.sub })
  if (!result.ok) throw sessionBusy()
  const res = NextResponse.json({ ok: true })
  if (clientType === 'web') clearSessionCookies(res)
  return res
})

export async function POST(req: NextRequest) {
  return handler(req, undefined)
}
