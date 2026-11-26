/**
 * The correction rules of PATCH /api/v1/wardrobe/items/[id]
 * (src/lib/wardrobe/corrections.ts). The Go server is checked against the
 * same functions through scripts/golden-wardrobe.ts.
 */
import { describe, expect, it } from 'vitest'
import { computeCorrections, subcategoryMismatch, type CorrectableColumns } from '@/lib/wardrobe/corrections'

const AT = '2026-11-26T09:30:15.042Z'
const shirt: CorrectableColumns = {
  category: 'shirt',
  subcategory: 'tshirt',
  colors: '["white","navy"]',
  pattern: 'solid',
  material: 'cotton',
  sleeveLength: 'short',
  fit: 'regular',
  style: 'casual',
  season: '["spring","summer"]',
  gender: 'unisex',
  formality: 'casual',
}

describe('computeCorrections', () => {
  it('logs nothing and writes nothing when every value is the stored one', () => {
    const same = { category: 'shirt', fit: 'regular', colors: ['white', 'navy'], season: ['spring', 'summer'] } as const
    expect(computeCorrections(shirt, { ...same, colors: [...same.colors], season: [...same.season] }, AT)).toEqual({ corrections: [], update: {} })
    expect(computeCorrections(shirt, {}, AT)).toEqual({ corrections: [], update: {} })
  })

  it('logs each changed field with its old and new text, lists as JSON', () => {
    const { corrections, update } = computeCorrections(shirt, { colors: ['black'], pattern: null, fit: 'slim' }, AT)
    expect(corrections).toEqual([
      { field: 'colors', from: '["white","navy"]', to: '["black"]', at: AT },
      { field: 'pattern', from: 'solid', to: '', at: AT },
      { field: 'fit', from: 'regular', to: 'slim', at: AT },
    ])
    expect(update).toEqual({ colors: '["black"]', pattern: null, fit: 'slim' })
  })

  it('does not count null over nothing as a change', () => {
    const bare = { ...shirt, pattern: null }
    expect(computeCorrections(bare, { pattern: null }, AT).corrections).toEqual([])
  })
})

describe('subcategoryMismatch', () => {
  it('judges the pair the item would end up with', () => {
    expect(subcategoryMismatch(shirt, { category: 'pants' })).toBe(true) // the stored subcategory goes stale
    expect(subcategoryMismatch(shirt, { category: 'pants', subcategory: 'jeans' })).toBe(false)
    expect(subcategoryMismatch(shirt, { category: 'pants', subcategory: null })).toBe(false)
    expect(subcategoryMismatch(shirt, { subcategory: 'jeans' })).toBe(true)
    expect(subcategoryMismatch(shirt, { subcategory: 'polo' })).toBe(false)
  })

  it('does not judge a stored pair when neither is named', () => {
    expect(subcategoryMismatch({ ...shirt, subcategory: 'jeans' }, { fit: 'slim' })).toBe(false)
  })
})
