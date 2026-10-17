import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, clientIp } from '@/lib/rate-limit'
import { completePasswordReset } from '@/server/password-reset'
import { PasswordResetRequest } from '@/server/schemas/requests'
import { ApiError, parseJson, withApi } from '@/server/http'

export const runtime = 'nodejs'

const WINDOW_MS = 60 * 60 * 1000
const MAX_PER_IP = 20
// Always applied — the only guard when the client IP is unknown/untrusted.
const MAX_GLOBAL = 300

// POST /api/v1/auth/password/reset — 200 { ok: true }: the new password is
// set and every session of the account is signed out. The user signs in again.
const handler = withApi(async (req: NextRequest) => {
  const ip = clientIp(req)
  const checks = [checkRateLimit('password-reset:global', MAX_GLOBAL, WINDOW_MS)]
  if (ip) checks.push(checkRateLimit(`password-reset:ip:${ip}`, MAX_PER_IP, WINDOW_MS))
  const blocked = checks.find((c) => !c.allowed)
  if (blocked) {
    throw new ApiError('RATE_LIMITED', undefined, undefined, { 'Retry-After': String(blocked.retryAfterSeconds) })
  }

  const { token, password } = await parseJson(req, PasswordResetRequest)
  if (!(await completePasswordReset(token, password))) throw new ApiError('RESET_TOKEN_INVALID')
  return NextResponse.json({ ok: true })
})

export async function POST(req: NextRequest) {
  return handler(req, undefined)
}
