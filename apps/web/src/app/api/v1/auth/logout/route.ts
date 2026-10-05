import { NextRequest, NextResponse } from 'next/server'
import { REFRESH_COOKIE, authenticateRequest, clearSessionCookies, revokeSession } from '@/lib/session'
import { withApi } from '@/server/http'

export const runtime = 'nodejs'

// POST /api/v1/auth/logout — revoke the current session and clear both
// cookies. Idempotent: always 200 { ok: true }, even when already logged out.
const handler = withApi(async (req: NextRequest) => {
  const { user } = await authenticateRequest(req)
  await revokeSession({
    refreshToken: req.cookies.get(REFRESH_COOKIE)?.value,
    sid: user?.sid,
    userId: user?.sub,
  })
  const res = NextResponse.json({ ok: true })
  clearSessionCookies(res)
  return res
})

export async function POST(req: NextRequest) {
  return handler(req, undefined)
}
