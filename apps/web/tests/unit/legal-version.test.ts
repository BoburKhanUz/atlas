/**
 * The version the legal pages show (src/lib/legal/version.ts). Which accepted
 * versions still count is the Go server's rule (apps/api/internal/legal), whose
 * test holds its version to this one.
 */
import { describe, expect, it } from 'vitest'
import { LEGAL_DRAFT, LEGAL_EFFECTIVE_DATE, LEGAL_VERSION } from '@/lib/legal/version'

describe('the legal version', () => {
  it('is YYYY-MM-DD.N, marked -draft exactly while the texts are drafts', () => {
    const m = /^(\d{4}-\d{2}-\d{2})\.([1-9]\d*)(-draft)?$/.exec(LEGAL_VERSION)
    expect(m).not.toBeNull()
    expect(Boolean(m?.[3])).toBe(LEGAL_DRAFT)
  })

  it('takes effect on a real date', () => {
    expect(LEGAL_EFFECTIVE_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(new Date(`${LEGAL_EFFECTIVE_DATE}T00:00:00Z`).toISOString().slice(0, 10)).toBe(LEGAL_EFFECTIVE_DATE)
  })
})
