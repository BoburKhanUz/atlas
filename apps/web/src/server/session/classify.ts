/**
 * Pure classification of a refresh request, evaluated under the family lock
 * with database timestamps only (`t` = the request transaction's start,
 * from atlas_now()). No I/O — every boundary is unit-tested here.
 */

/** A rotated token presented again within this window (inclusive) may be a concurrent request. */
export const GRACE_WINDOW_MS = 60_000

export type ClientType = 'web' | 'mobile'

export interface FamilyState {
  revokedAt: Date | null
  absoluteExpiresAt: Date
  clientType: string
}

export interface SessionState {
  revokedAt: Date | null
  replacedById: string | null
  expiresAt: Date
  rotatedAt: Date | null
  /** 'db' for rotations by this protocol, 'legacy' for rows migrated from Phase 2. */
  rotatedAtSource: string | null
}

export type Decision =
  | { kind: 'rotate' }
  | { kind: 'grace' }
  | { kind: 'race' }
  | { kind: 'reuse' }
  | { kind: 'expired'; revokeFamily: boolean }
  | { kind: 'revoked' }
  | { kind: 'client_mismatch' }

export function classifyRefresh(input: {
  t: Date
  family: FamilyState
  session: SessionState
  clientType: ClientType
  /** SystemMarker.legacyCutoverAt — needed only for legacy rotated rows. */
  legacyCutoverAt: Date | null
}): Decision {
  const { t, family: f, session: r } = input
  const now = t.getTime()

  if (f.revokedAt) return { kind: 'revoked' }
  if (f.clientType !== input.clientType) return { kind: 'client_mismatch' }
  if (now >= f.absoluteExpiresAt.getTime()) return { kind: 'expired', revokeFamily: true }

  if (r.revokedAt === null) {
    if (now >= r.expiresAt.getTime()) return { kind: 'expired', revokeFamily: true }
    return { kind: 'rotate' }
  }

  // Revoked without a successor: logged out / revoked — nothing to rotate.
  if (r.replacedById === null) return { kind: 'revoked' }

  // Rotated. Legacy rotation times come from the old servers' clocks and are
  // never trusted: every legacy rotation happened before the cutover, so the
  // true elapsed time is at least t − legacyCutoverAt.
  if (r.rotatedAtSource !== 'db' || r.rotatedAt === null) {
    if (input.legacyCutoverAt && now - input.legacyCutoverAt.getTime() > GRACE_WINDOW_MS) return { kind: 'reuse' }
    return { kind: 'race' }
  }

  return now - r.rotatedAt.getTime() <= GRACE_WINDOW_MS ? { kind: 'grace' } : { kind: 'reuse' }
}
