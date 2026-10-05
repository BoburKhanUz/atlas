/** BND-01: refresh classification boundaries (pure function, fixed timestamps). */
import { describe, expect, it } from 'vitest'
import { GRACE_WINDOW_MS, classifyRefresh, type FamilyState, type SessionState } from '@/server/session/classify'

const T0 = Date.parse('2026-10-01T10:00:00.000Z')
const at = (ms: number) => new Date(T0 + ms)
const family = (over: Partial<FamilyState> = {}): FamilyState => ({
  revokedAt: null,
  absoluteExpiresAt: at(90 * 24 * 3600 * 1000),
  clientType: 'web',
  ...over,
})
const live = (over: Partial<SessionState> = {}): SessionState => ({
  revokedAt: null,
  replacedById: null,
  expiresAt: at(30 * 24 * 3600 * 1000),
  rotatedAt: null,
  rotatedAtSource: null,
  ...over,
})
const rotated = (over: Partial<SessionState> = {}): SessionState =>
  live({ revokedAt: at(0), rotatedAt: at(0), rotatedAtSource: 'db', replacedById: 's2', ...over })

const classify = (t: number, f: FamilyState, s: SessionState, legacyCutoverAt: Date | null = null, clientType: 'web' | 'mobile' = 'web') =>
  classifyRefresh({ t: at(t), family: f, session: s, clientType, legacyCutoverAt }).kind

describe('classifyRefresh', () => {
  it('grace window: Δ = −50, 0, 59 999 and exactly 60 000 ms are grace; 60 001 ms is reuse', () => {
    expect(GRACE_WINDOW_MS).toBe(60_000)
    for (const d of [-50, 0, 59_999, 60_000]) expect(classify(d, family(), rotated())).toBe('grace')
    expect(classify(60_001, family(), rotated())).toBe('reuse')
  })

  it('absolute limit: t = absoluteExpiresAt is expired, 1 ms before is allowed', () => {
    const f = family({ absoluteExpiresAt: at(1000) })
    expect(classify(999, f, live())).toBe('rotate')
    expect(classify(1000, f, live())).toBe('expired')
    expect(classify(1000, f, rotated())).toBe('expired')
  })

  it('session expiry: a live session at t = expiresAt is expired', () => {
    expect(classify(4999, family(), live({ expiresAt: at(5000) }))).toBe('rotate')
    expect(classify(5000, family(), live({ expiresAt: at(5000) }))).toBe('expired')
  })

  it('a revoked family wins over everything; client type is enforced before expiry', () => {
    expect(classify(0, family({ revokedAt: at(-1) }), live())).toBe('revoked')
    expect(classify(0, family({ revokedAt: at(-1) }), rotated())).toBe('revoked')
    expect(classify(0, family({ clientType: 'mobile' }), live())).toBe('client_mismatch')
    expect(classify(0, family(), live(), null, 'mobile')).toBe('client_mismatch')
    expect(classify(0, family({ clientType: 'mobile' }), live(), null, 'mobile')).toBe('rotate')
  })

  it('a session revoked without a successor (logout) is revoked, never reuse', () => {
    expect(classify(10 * 60_000, family(), live({ revokedAt: at(0) }))).toBe('revoked')
  })

  it('legacy rotations: rotatedAt is ignored; only t − legacyCutoverAt decides (race ≤ 60 000 < reuse)', () => {
    const M = at(1_000_000)
    for (const rotatedAt of [at(-365 * 24 * 3600 * 1000), at(10 * 365 * 24 * 3600 * 1000), null]) {
      const s = rotated({ rotatedAt, rotatedAtSource: 'legacy' })
      expect(classify(1_000_000 + 60_000, family(), s, M)).toBe('race')
      expect(classify(1_000_000 + 60_001, family(), s, M)).toBe('reuse')
    }
    // a rotated row with no trustworthy time and no cutover marker never revokes
    expect(classify(10 ** 9, family(), rotated({ rotatedAt: null, rotatedAtSource: null }), null)).toBe('race')
  })
})
