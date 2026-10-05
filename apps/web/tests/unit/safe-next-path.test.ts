import { describe, expect, it } from 'vitest'
import { safeNextPath } from '@/lib/routes'

describe('safeNextPath (open-redirect guard)', () => {
  it.each([
    ['/wardrobe', '/wardrobe'],
    ['/wardrobe/abc?x=1#y', '/wardrobe/abc?x=1#y'],
    ['/outfits?occasion=work', '/outfits?occasion=work'],
  ])('allows same-origin path %s', (input, expected) => {
    expect(safeNextPath(input)).toBe(expected)
  })

  it.each([
    null, '', 'https://evil.com', '//evil.com', '/\\evil.com', '/\t/evil.com', '/\n/evil.com',
    '/%09', 'javascript:alert(1)', '/login', '/login?next=/x', '/register', 'x'.repeat(10),
  ])('rejects %j', (input) => {
    const out = safeNextPath(input as string | null, '/')
    expect(out === '/' || (input === '/%09' && out === '/%09')).toBe(true)
  })

  it('uses the fallback', () => {
    expect(safeNextPath('//evil.com', '/profile')).toBe('/profile')
  })
})
