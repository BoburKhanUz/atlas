import { NextRequest, NextResponse } from 'next/server'
import { REFRESH_COOKIE, clearSessionCookies, rotateSession, setSessionCookies } from '@/lib/session'
import { ApiError, errorResponse, requestIdOf, withApi } from '@/server/http'

export const runtime = 'nodejs'

// POST /api/v1/auth/refresh — rotate the atlas_rt refresh token.
// 200 { user } + new cookies, or 401. On a concurrent-tab race the 401 leaves
// cookies untouched: the other response already set fresh ones, so retry.
const handler = withApi(async (req: NextRequest) => {
  const result = await rotateSession(req.cookies.get(REFRESH_COOKIE)?.value, req.headers.get('user-agent'))
  if (!result.ok) {
    const res = errorResponse(new ApiError('UNAUTHORIZED'), requestIdOf(req))
    if (result.clearCookies) clearSessionCookies(res)
    return res
  }
  const res = NextResponse.json({ user: result.user })
  setSessionCookies(res, result.issued)
  return res
})

export async function POST(req: NextRequest) {
  return handler(req, undefined)
}
