import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, clientIp } from '@/lib/rate-limit'
import { mailEnabled } from '@/server/mail-config'
import { schedulePasswordReset } from '@/server/password-reset'
import { PasswordForgotRequest } from '@/server/schemas/requests'
import { ApiError, parseJson, withApi } from '@/server/http'

export const runtime = 'nodejs'

const WINDOW_MS = 60 * 60 * 1000
const MAX_PER_EMAIL = 3
const MAX_PER_IP = 10
// Always applied — the only guard when the client IP is unknown/untrusted.
const MAX_GLOBAL = 200

function rateLimited(retryAfterSeconds: number): ApiError {
  return new ApiError('RATE_LIMITED', undefined, undefined, { 'Retry-After': String(retryAfterSeconds) })
}

// POST /api/v1/auth/password/forgot — 200 { ok: true } whether or not the
// e-mail has an account (no enumeration); the link is sent in the background.
const handler = withApi(async (req: NextRequest) => {
  if (!mailEnabled()) throw new ApiError('PASSWORD_RESET_UNAVAILABLE')
  const ip = clientIp(req)
  const checks = [checkRateLimit('password-forgot:global', MAX_GLOBAL, WINDOW_MS)]
  if (ip) checks.push(checkRateLimit(`password-forgot:ip:${ip}`, MAX_PER_IP, WINDOW_MS))
  const blocked = checks.find((c) => !c.allowed)
  if (blocked) throw rateLimited(blocked.retryAfterSeconds)

  const { email } = await parseJson(req, PasswordForgotRequest)
  const normalizedEmail = email.toLowerCase().trim()
  // Counted for every address alike, so the limit says nothing about accounts.
  const digest = crypto.createHash('sha256').update(normalizedEmail).digest('hex')
  const perEmail = checkRateLimit(`password-forgot:email:${digest}`, MAX_PER_EMAIL, WINDOW_MS)
  if (!perEmail.allowed) throw rateLimited(perEmail.retryAfterSeconds)

  schedulePasswordReset(normalizedEmail)
  return NextResponse.json({ ok: true })
})

export async function POST(req: NextRequest) {
  return handler(req, undefined)
}
