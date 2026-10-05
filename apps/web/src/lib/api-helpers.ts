/**
 * Auth helper for API route handlers — extracts the user from the access JWT
 * (atlas_at cookie or `Authorization: Bearer`), returns null if invalid. Usage:
 *
 *   const authUser = await requireAuth(req)
 *   if (!authUser) return unauthorized()
 *
 * Trade-off: the token's session (`sid`) is not looked up in the DB per
 * request; a revoked session stays usable until its access token expires
 * (≤ 15 min). Logout clears the cookie immediately. CSRF (cross-origin
 * cookie-authenticated writes) is rejected centrally in src/proxy.ts.
 *
 * Spec section 28: "authorization checks" + "user data isolation" — every
 * authenticated route must verify the user, and downstream queries must
 * always scope by userId.
 */

import { NextRequest } from 'next/server'
import type { JwtPayload } from '@/lib/auth'
import { authenticateRequest } from '@/lib/session'
import { apiError } from '@/server/http'

export type AuthUser = JwtPayload

export async function requireAuth(req: NextRequest): Promise<AuthUser | null> {
  return (await authenticateRequest(req)).user
}

// Thin wrappers kept for existing call sites; all errors use the shared
// contract in src/server/http.ts ({ error, code, details?, requestId? }).
export function unauthorized() {
  return apiError('UNAUTHORIZED')
}

export function notFound() {
  return apiError('NOT_FOUND')
}

export function badRequest(message?: string) {
  return apiError('BAD_REQUEST', message)
}
