import { describe, expect, it } from 'vitest'
import { OCCASIONS } from '@/lib/ai/catalog'
import { buildOccasionLookup, OCCASION_ALIASES, occasionFromEvent } from '@/server/schemas/catalog'

describe('occasionFromEvent (stylist event → occasion id)', () => {
  it('maps every occasion id and catalog label to its id', () => {
    for (const o of OCCASIONS) {
      expect(occasionFromEvent(o.id)).toBe(o.id)
      expect(occasionFromEvent(o.label)).toBe(o.id)
      expect(occasionFromEvent(o.label.toUpperCase())).toBe(o.id)
    }
  })

  it.each(['casual', 'Casual', 'CASUAL', 'Kasual', 'kasual', 'Kundalik', 'KUNDALIK', '  Kundalik  '])(
    'maps %j to casual',
    (input) => {
      expect(occasionFromEvent(input)).toBe('casual')
    },
  )

  it.each(['wedding', 'To‘y', "To'y", 'Toʻy', 'To’y', 'Toʼy', 'TO‘Y', "  To'y  ", '\tTo’y\n', ' Toʼy '])(
    'maps %j to wedding',
    (input) => {
      expect(occasionFromEvent(input)).toBe('wedding')
    },
  )

  it.each([
    undefined, null, '', ' ', '   \t\n',
    'nikoh', 'Kun', 'kundalik kiyim', 'Casual wear', 'To', "To'yga", 'Toʼyga', 'ʼ', 'Toy', 'To`y', 'To´y', 'Tooy', 'wed', 'party', 'Bayram',
  ])('leaves %j as free text', (input) => {
    expect(occasionFromEvent(input)).toBeUndefined()
  })
})

describe('occasion alias table', () => {
  it('only names existing occasion ids', () => {
    const ids = new Set(OCCASIONS.map((o) => o.id))
    for (const id of Object.keys(OCCASION_ALIASES)) expect(ids.has(id)).toBe(true)
  })

  it('builds without collisions for the real catalog', () => {
    expect(() => buildOccasionLookup(OCCASIONS, OCCASION_ALIASES)).not.toThrow()
  })

  it('rejects an alias that would name two occasions, including after normalization', () => {
    const entries = [{ id: 'casual', label: 'Casual' }, { id: 'wedding', label: 'To‘y' }]
    expect(() => buildOccasionLookup(entries, { casual: ['Wedding'] })).toThrow(/both/)
    expect(() => buildOccasionLookup(entries, { casual: ["  TO'Y "] })).toThrow(/both/)
  })

  it('rejects an alias for an unknown id', () => {
    expect(() => buildOccasionLookup(OCCASIONS, { party: ['Bazm'] })).toThrow(/unknown id/)
  })
})
