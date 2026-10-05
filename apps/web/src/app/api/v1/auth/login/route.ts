import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyPassword } from '@/lib/auth'
import { checkRateLimit, clientIp } from '@/lib/rate-limit'
import { LoginRequest } from '@/server/schemas/requests'
import { clientTypeOf, createSession, mobileTokenBody, setSessionCookies } from '@/lib/session'
import { ApiError, parseJson, withApi } from '@/server/http'

const WINDOW_MS = 15 * 60 * 1000
const MAX_ATTEMPTS_PER_EMAIL = 10
const MAX_ATTEMPTS_PER_IP = 50
// Global cap, always applied — the only IP-independent guard when the client
// IP is unknown/untrusted (TRUST_PROXY unset).
const MAX_ATTEMPTS_GLOBAL = 1000

// bcrypt (cost 10) hash of a random throwaway string — not a secret. Compared
// against when the user does not exist so response timing does not reveal
// which emails are registered.
const DUMMY_PASSWORD_HASH = '$2b$10$UP7t/OLVj2aGiK9rf1bzUO6eASGwhNMjWhjmYsPN2fyuwjFKXBdr6'

const INVALID_CREDENTIALS = 'Email yoki parol noto‘g‘ri'

export const runtime = 'nodejs'

// POST /api/v1/auth/login
//   web:    sets atlas_at + atlas_rt cookies; body is { user } only.
//   mobile (X-Atlas-Client: mobile): no cookies; body carries the tokens.
const handler = withApi(async (req: NextRequest) => {
  const { email, password, deviceName } = await parseJson(req, LoginRequest)
  const normalizedEmail = email.toLowerCase().trim()

  // Brute-force protection: per account always, per IP when it is trustworthy.
  const ip = clientIp(req)
  const checks = [
    checkRateLimit('login:global', MAX_ATTEMPTS_GLOBAL, WINDOW_MS),
    checkRateLimit(`login:email:${normalizedEmail}`, MAX_ATTEMPTS_PER_EMAIL, WINDOW_MS),
  ]
  if (ip) checks.push(checkRateLimit(`login:ip:${ip}`, MAX_ATTEMPTS_PER_IP, WINDOW_MS))
  const blocked = checks.find((c) => !c.allowed)
  if (blocked) {
    throw new ApiError('RATE_LIMITED', undefined, undefined, { 'Retry-After': String(blocked.retryAfterSeconds) })
  }

  const user = await db.user.findUnique({ where: { email: normalizedEmail } })
  if (!user) {
    // Equalise timing with the wrong-password path.
    await verifyPassword(password, DUMMY_PASSWORD_HASH)
    // Generic message: do not leak which emails exist.
    throw new ApiError('UNAUTHORIZED', INVALID_CREDENTIALS)
  }

  const valid = await verifyPassword(password, user.passwordHash)
  if (!valid) throw new ApiError('UNAUTHORIZED', INVALID_CREDENTIALS)

  const clientType = clientTypeOf(req)
  const sessionUser = { id: user.id, email: user.email, name: user.name }
  const issued = await createSession(sessionUser, { clientType, userAgent: req.headers.get('user-agent'), deviceName })
  if (clientType === 'mobile') return NextResponse.json(mobileTokenBody(sessionUser, issued))
  const res = NextResponse.json({ user: sessionUser })
  setSessionCookies(res, issued)
  return res
})

export async function POST(req: NextRequest) {
  return handler(req, undefined)
}
