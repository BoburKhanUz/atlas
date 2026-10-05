import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/auth'
import { checkRateLimit, clientIp } from '@/lib/rate-limit'
import { RegisterRequest } from '@/server/schemas/requests'
import { clientTypeOf, createSession, mobileTokenBody, setSessionCookies } from '@/lib/session'
import { ApiError, parseJson, withApi } from '@/server/http'

export const runtime = 'nodejs'

const WINDOW_MS = 60 * 60 * 1000
const MAX_PER_IP = 10
// Always applied — the only guard when the client IP is unknown/untrusted.
const MAX_GLOBAL = 100

// POST /api/v1/auth/register — 201
//   web:    sets atlas_at + atlas_rt cookies; body is { user } only.
//   mobile (X-Atlas-Client: mobile): no cookies; body carries the tokens.
const handler = withApi(async (req: NextRequest) => {
  const ip = clientIp(req)
  const checks = [checkRateLimit('register:global', MAX_GLOBAL, WINDOW_MS)]
  if (ip) checks.push(checkRateLimit(`register:ip:${ip}`, MAX_PER_IP, WINDOW_MS))
  const blocked = checks.find((c) => !c.allowed)
  if (blocked) {
    throw new ApiError('RATE_LIMITED', undefined, undefined, { 'Retry-After': String(blocked.retryAfterSeconds) })
  }

  const { email, password, name, deviceName } = await parseJson(req, RegisterRequest)
  const normalizedEmail = email.toLowerCase().trim()

  const existing = await db.user.findUnique({ where: { email: normalizedEmail } })
  if (existing) throw new ApiError('CONFLICT', 'Bu email allaqachon ro‘yxatdan o‘tgan')

  const passwordHash = await hashPassword(password)

  // Transactional create: user + profile + preferences — never leave a User
  // without its companion rows (spec section 23).
  const user = await db.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: { email: normalizedEmail, name, passwordHash },
    })
    await tx.userProfile.create({ data: { userId: u.id } })
    await tx.userPreferences.create({
      data: {
        userId: u.id,
        preferredStyles: '[]',
        dislikedStyles: '[]',
        favoriteColors: '[]',
        dislikedColors: '[]',
        language: 'uz',
      },
    })
    return u
  })

  const clientType = clientTypeOf(req)
  const sessionUser = { id: user.id, email: user.email, name: user.name }
  const issued = await createSession(sessionUser, { clientType, userAgent: req.headers.get('user-agent'), deviceName })
  if (clientType === 'mobile') return NextResponse.json(mobileTokenBody(sessionUser, issued), { status: 201 })
  const res = NextResponse.json({ user: sessionUser }, { status: 201 })
  setSessionCookies(res, issued)
  return res
})

export async function POST(req: NextRequest) {
  return handler(req, undefined)
}
