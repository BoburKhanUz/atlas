/**
 * Minimal fixed-window rate limiter for auth endpoints.
 *
 * In-memory, so limits are per server process. That is enough for the
 * single-instance MVP; move to Redis/Postgres before running several replicas.
 */

import { NextRequest } from 'next/server'
import { ApiError, errorResponse } from '@/server/http'

interface Window {
  count: number
  resetAt: number
}

const buckets = new Map<string, Window>()
const MAX_BUCKETS = 50_000

export interface RateLimitResult {
  allowed: boolean
  retryAfterSeconds: number
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  const current = buckets.get(key)
  if (!current || current.resetAt <= now) {
    if (!current && buckets.size >= MAX_BUCKETS) {
      pruneExpired(now)
      // Still full (e.g. under a key-flooding attack): never evict live
      // buckets — that would reset a victim's counter. Fail closed for new keys.
      if (buckets.size >= MAX_BUCKETS) {
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((soonestReset() - now) / 1000)) }
      }
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, retryAfterSeconds: 0 }
  }
  current.count += 1
  if (current.count > limit) {
    return { allowed: false, retryAfterSeconds: Math.ceil((current.resetAt - now) / 1000) }
  }
  return { allowed: true, retryAfterSeconds: 0 }
}

function pruneExpired(now: number) {
  for (const [k, w] of buckets) if (w.resetAt <= now) buckets.delete(k)
}

function soonestReset(): number {
  let soonest = Infinity
  for (const w of buckets.values()) if (w.resetAt < soonest) soonest = w.resetAt
  return soonest
}

/** Test helper. */
export function resetRateLimits() {
  buckets.clear()
}

/**
 * Client IP for rate-limit keys, or null when it cannot be trusted. Proxy
 * headers are client-controlled unless a reverse proxy overwrites them, so
 * they are only read when TRUST_PROXY=1. The trusted proxy appends the peer
 * address to X-Forwarded-For, so the RIGHT-most entry is the one it vouches
 * for; anything to its left was supplied by the client.
 */
export function clientIp(req: NextRequest): string | null {
  if (process.env.TRUST_PROXY !== '1') return null
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) {
    const last = fwd.split(',').map((s) => s.trim()).filter(Boolean).pop()
    if (last) return last
  }
  return req.headers.get('x-real-ip')
}

export function tooManyRequests(retryAfterSeconds: number) {
  return errorResponse(
    new ApiError('RATE_LIMITED', undefined, undefined, { 'Retry-After': String(retryAfterSeconds) }),
  )
}
