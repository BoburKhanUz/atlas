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
import { assertConsent } from '@/server/legal-consent'

export type AuthUser = JwtPayload

/**
 * Also requires the user's consent to the current legal texts (one indexed
 * query): CONSENT_REQUIRED otherwise. Only the routes that let the user
 * review and accept the texts or delete the account pass
 * `allowOutdatedConsent` (OpenAPI: `consentExempt`).
 */
export async function requireAuth(req: NextRequest, { allowOutdatedConsent = false } = {}): Promise<AuthUser | null> {
  const user = (await authenticateRequest(req)).user
  if (user && !allowOutdatedConsent) await assertConsent(user.sub)
  return user
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
