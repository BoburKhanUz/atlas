import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, clientIp } from '@/lib/rate-limit'
import { logClientErrors } from '@/server/client-errors'
import { ClientErrorsRequest } from '@/server/schemas/requests'
import { ApiError, parseJson, withApi } from '@/server/http'

export const runtime = 'nodejs'

const WINDOW_MS = 10 * 60 * 1000
// An app run sends at most 2 requests (20 reports), a page load at most 10.
const MAX_PER_IP = 30
// Always applied — keeps a crash loop on many devices, or a flood, from
// pushing everything else out of the rotated log.
const MAX_GLOBAL = 300

// POST /api/v1/client-errors — 200 { ok: true }. No session needed (errors
// happen before sign-in too); reports are logged, never stored.
const handler = withApi(async (req: NextRequest) => {
  const ip = clientIp(req)
  const checks = [checkRateLimit('client-errors:global', MAX_GLOBAL, WINDOW_MS)]
  if (ip) checks.push(checkRateLimit(`client-errors:ip:${ip}`, MAX_PER_IP, WINDOW_MS))
  const blocked = checks.find((c) => !c.allowed)
  if (blocked) {
    throw new ApiError('RATE_LIMITED', undefined, undefined, { 'Retry-After': String(blocked.retryAfterSeconds) })
  }
  const { reports } = await parseJson(req, ClientErrorsRequest)
  logClientErrors(reports)
  return NextResponse.json({ ok: true })
})

export async function POST(req: NextRequest) {
  return handler(req, undefined)
}
