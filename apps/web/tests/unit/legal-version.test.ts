/**
 * Which accepted versions of the legal texts still count (re-consent rule,
 * src/lib/legal/version.ts).
 */
import { describe, expect, it } from 'vitest'
import { compareLegalVersions, consentStillValid, LEGAL_CONSENT_MIN_VERSION, LEGAL_DRAFT, LEGAL_VERSION } from '@/lib/legal/version'

describe('compareLegalVersions', () => {
  it.each([
    ['2026-10-17.2', '2026-10-18.1', -1], // later date
    ['2026-10-17.2', '2026-10-17.10', -1], // number, not text order
    ['2026-10-17.2-draft', '2026-10-17.2', -1], // the draft comes before the approved text
    ['2026-10-17.3-draft', '2026-10-17.2', 1],
    ['2026-10-17.2-draft', '2026-10-17.2-draft', 0],
    ['2026-11-01.1', '2026-10-17.9', 1],
  ])('%s vs %s → %i', (a, b, expected) => {
    expect(compareLegalVersions(a, b)).toBe(expected)
    expect(compareLegalVersions(b, a)).toBe(-expected || 0)
  })

  it.each(['2026-10-17', '2026-10-17.x', '2026-10-17.2-final', ' 2026-10-17.2', ''])('malformed %j → NaN', (bad) => {
    expect(compareLegalVersions(bad, LEGAL_VERSION)).toBeNaN()
  })
})

describe('consentStillValid', () => {
  it('the minimum and anything newer count; older or malformed versions do not', () => {
    expect(consentStillValid(LEGAL_CONSENT_MIN_VERSION)).toBe(true)
    expect(consentStillValid(LEGAL_VERSION)).toBe(true)
    expect(consentStillValid('2020-01-01.1')).toBe(false)
    expect(consentStillValid('not a version')).toBe(false)
  })
})

describe('the configured versions', () => {
  it('are well formed, and the minimum is not newer than the current texts (nobody could accept it)', () => {
    expect(compareLegalVersions(LEGAL_CONSENT_MIN_VERSION, LEGAL_VERSION)).toBeLessThanOrEqual(0)
  })

  it('once counsel approves the texts, consent to a draft no longer counts', () => {
    if (!LEGAL_DRAFT) expect(LEGAL_CONSENT_MIN_VERSION.endsWith('-draft')).toBe(false)
  })
})
