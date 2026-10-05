/**
 * Next.js 16 proxy (formerly middleware). Always runs on the Node.js runtime
 * in Next 16 (route segment `runtime` config is rejected here), so it can use
 * Prisma and share the refresh-rotation code with /api/v1/auth/refresh.
 *
 * - Every request: ensure an `x-request-id` request header (read by withApi).
 * - /api/**: CSRF guard only — a state-changing, cookie-authenticated request
 *   whose Origin host differs from Host gets 403 FORBIDDEN. Bearer-authenticated
 *   requests are exempt. No DB work on API requests.
 * - Pages: valid access cookie → continue. Otherwise, with a refresh cookie,
 *   rotate server-side and continue with fresh cookies. Otherwise redirect to
 *   /login?next=<path>. /login and /register redirect a signed-in user to `/`.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { verifyAccessTokenOrNull } from '@/lib/auth'
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  clearSessionCookies,
  isCrossOriginCookieRequest,
  rotateSession,
  safeNextPath,
  setSessionCookies,
} from '@/lib/session'
import { ApiError, errorResponse, requestIdOf } from '@/server/http'
import { log } from '@/server/log'

const GUEST_ONLY_PATHS = new Set(['/login', '/register'])

function forwardHeaders(request: NextRequest, requestId: string): Headers {
  const headers = new Headers(request.headers)
  headers.set('x-request-id', requestId)
  return headers
}

function next(request: NextRequest, requestId: string, headers = forwardHeaders(request, requestId)) {
  const res = NextResponse.next({ request: { headers } })
  res.headers.set('x-request-id', requestId)
  return res
}

function redirect(request: NextRequest, path: string) {
  return NextResponse.redirect(new URL(path, request.url))
}

type PageSession = 'valid' | 'rotated' | 'race' | 'none'

/** Next.js router prefetches (and browser speculative prefetches). */
export function isPrefetch(request: NextRequest): boolean {
  if (request.headers.get('next-router-prefetch') === '1') return true
  const purpose = request.headers.get('sec-purpose') ?? request.headers.get('purpose') ?? ''
  return /prefetch/i.test(purpose)
}

export async function proxy(request: NextRequest) {
  const requestId = requestIdOf(request)
  const { pathname, search } = request.nextUrl

  if (pathname === '/api' || pathname.startsWith('/api/')) {
    if (isCrossOriginCookieRequest(request)) {
      log.warn('cross-origin cookie request rejected', { requestId, method: request.method, path: pathname })
      return errorResponse(new ApiError('FORBIDDEN'), requestId)
    }
    return next(request, requestId)
  }

  // ── Pages ────────────────────────────────────────────────────────────────
  let state: PageSession = 'none'
  let clearCookies = false
  let rotated: Awaited<ReturnType<typeof rotateSession>> | null = null

  if (await verifyAccessTokenOrNull(request.cookies.get(ACCESS_COOKIE)?.value)) {
    state = 'valid'
  } else if (request.cookies.has(REFRESH_COOKIE)) {
    if (isPrefetch(request)) {
      // Never rotate on a background prefetch: if its response is dropped, the
      // browser keeps a token that was already replaced, which later looks
      // like theft. An empty response makes Next fetch the page for real on
      // navigation, and that request rotates.
      return new NextResponse(null, {
        status: 204,
        headers: { 'Cache-Control': 'no-store', 'x-request-id': requestId },
      })
    }
    rotated = await rotateSession(request.cookies.get(REFRESH_COOKIE)?.value, request.headers.get('user-agent'))
    if (rotated.ok) state = 'rotated'
    else if (rotated.reason === 'race') state = 'race'
    else clearCookies = rotated.clearCookies
  } else if (request.cookies.has(ACCESS_COOKIE)) {
    clearCookies = true // stale access cookie, nothing to refresh with
  }

  const isGuestPage = GUEST_ONLY_PATHS.has(pathname)
  let res: NextResponse

  if (state === 'valid' || state === 'rotated') {
    if (isGuestPage) {
      res = redirect(request, safeNextPath(request.nextUrl.searchParams.get('next')))
    } else {
      const headers = forwardHeaders(request, requestId)
      if (rotated?.ok) {
        // Let this render (getCurrentUser) see the new access token too.
        request.cookies.set(ACCESS_COOKIE, rotated.issued.accessToken)
        if (rotated.issued.refreshToken) request.cookies.set(REFRESH_COOKIE, rotated.issued.refreshToken)
        headers.set('cookie', request.cookies.toString())
      }
      res = next(request, requestId, headers)
    }
    if (rotated?.ok) setSessionCookies(res, rotated.issued)
    return res
  }

  if (isGuestPage || state === 'race') {
    // race: a parallel request just rotated the token and its response sets
    // fresh cookies; render without touching cookies rather than looping.
    res = next(request, requestId)
  } else {
    res = redirect(request, `/login?next=${encodeURIComponent(safeNextPath(pathname + search))}`)
  }
  if (clearCookies) clearSessionCookies(res)
  return res
}

export const config = {
  matcher: [
    // Everything except Next internals and static files (anything with a file
    // extension). /api is included only for x-request-id + the CSRF check.
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.[A-Za-z0-9]+$).*)',
  ],
}
