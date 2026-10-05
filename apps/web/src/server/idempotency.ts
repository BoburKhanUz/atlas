/**
 * `Idempotency-Key` for POST requests that create resources (currently
 * POST /api/v1/wardrobe/items), so a mobile retry after a timeout never
 * creates a duplicate. Per user + route + key, 24 h:
 *
 *   first request                         → processed; row in_progress → completed (with the resource id)
 *   same key, same payload, completed     → replay of the original resource (`Idempotent-Replayed: true`)
 *   same key, different payload           → 409 IDEMPOTENCY_KEY_MISMATCH
 *   same key, still in progress (< 5 min) → 409 IDEMPOTENCY_IN_PROGRESS + Retry-After
 *   in progress for ≥ 5 min (crashed)     → taken over by the next request
 *   earlier attempt failed                → its row was deleted, so a retry runs normally
 * Without the header nothing changes.
 */
import crypto from 'crypto'
import type { Prisma, PrismaClient } from '@prisma/client'
import { ApiError } from '@/server/http'

export const IDEMPOTENCY_HEADER = 'idempotency-key'
export const IDEMPOTENCY_TTL_MS = 24 * 3600 * 1000
export const IDEMPOTENCY_STALE_MS = 5 * 60 * 1000
const KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/

type Db = PrismaClient | Prisma.TransactionClient

/** The validated header value, null when absent; 400 when malformed. */
export function idempotencyKeyOf(req: Request): string | null {
  const raw = req.headers.get(IDEMPOTENCY_HEADER)
  if (raw === null) return null
  if (!KEY_PATTERN.test(raw)) {
    throw new ApiError('VALIDATION_ERROR', 'Idempotency-Key: 8–128 ta belgi (A-Z, a-z, 0-9, _ yoki -)', [
      { path: 'Idempotency-Key', message: 'must match ^[A-Za-z0-9_-]{8,128}$' },
    ])
  }
  return raw
}

/** SHA-256 over the canonical request: file bytes, filename, other form fields (sorted). */
export function multipartRequestHash(parts: { fileBytes: Buffer; filename: string; fields: Record<string, string> }): string {
  const h = crypto.createHash('sha256')
  h.update('v1\n')
  h.update(crypto.createHash('sha256').update(parts.fileBytes).digest('hex') + '\n')
  h.update(JSON.stringify(parts.filename) + '\n')
  h.update(JSON.stringify(Object.entries(parts.fields).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))))
  return h.digest('hex')
}

export type Claim =
  /** claimedAt identifies this claim: a takeover replaces it, after which the old owner can neither complete nor release. */
  | { kind: 'claimed'; id: string; claimedAt: Date }
  | { kind: 'replay'; resourceId: string | null; responseStatus: number | null }

/** Claim the key for this request, or report a replay; throws 409s as described above. */
export async function claimIdempotencyKey(
  db: PrismaClient,
  args: { userId: string; route: string; key: string; requestHash: string },
  now: Date = new Date(),
): Promise<Claim> {
  const where = { userId_route_key: { userId: args.userId, route: args.route, key: args.key } }
  // purge this user's expired keys (a reused expired key starts fresh)
  await db.idempotencyKey.deleteMany({ where: { userId: args.userId, expiresAt: { lte: now } } })
  // INSERT … ON CONFLICT DO NOTHING: exactly one concurrent request inserts.
  const id = crypto.randomUUID()
  const { count: inserted } = await db.idempotencyKey.createMany({
    data: [{ id, ...args, status: 'in_progress', createdAt: now, expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS) }],
    skipDuplicates: true,
  })
  if (inserted === 1) return { kind: 'claimed', id, claimedAt: now }
  const existing = await db.idempotencyKey.findUnique({ where })
  if (!existing) throw new ApiError('IDEMPOTENCY_IN_PROGRESS', undefined, undefined, { 'Retry-After': '1' }) // vanished meanwhile
  if (existing.requestHash !== args.requestHash) throw new ApiError('IDEMPOTENCY_KEY_MISMATCH')
  if (existing.status === 'completed') {
    return { kind: 'replay', resourceId: existing.resourceId, responseStatus: existing.responseStatus }
  }
  // in progress: take over only if stale (the earlier request crashed)
  const { count } = await db.idempotencyKey.updateMany({
    where: { id: existing.id, status: 'in_progress', createdAt: { lte: new Date(now.getTime() - IDEMPOTENCY_STALE_MS) } },
    data: { createdAt: now, expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS) },
  })
  if (count === 1) return { kind: 'claimed', id: existing.id, claimedAt: now }
  throw new ApiError('IDEMPOTENCY_IN_PROGRESS', undefined, undefined, { 'Retry-After': '5' })
}

export class IdempotencyClaimLost extends Error {}

/**
 * Mark completed — call inside the transaction that creates the resource. If
 * the claim was taken over meanwhile, throws so that transaction rolls back
 * (no duplicate resource).
 */
export async function completeIdempotencyKey(
  db: Db,
  claim: { id: string; claimedAt: Date },
  resourceId: string,
  responseStatus: number,
) {
  const { count } = await db.idempotencyKey.updateMany({
    where: { id: claim.id, status: 'in_progress', createdAt: claim.claimedAt },
    data: { status: 'completed', resourceId, responseStatus },
  })
  if (count !== 1) throw new IdempotencyClaimLost('idempotency claim was taken over')
}

/** Forget a failed attempt so a retry runs normally (only while this request still owns the claim). */
export async function releaseIdempotencyKey(db: Db, claim: { id: string; claimedAt: Date }) {
  await db.idempotencyKey.deleteMany({ where: { id: claim.id, status: 'in_progress', createdAt: claim.claimedAt } })
}
