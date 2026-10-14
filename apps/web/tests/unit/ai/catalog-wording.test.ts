import { describe, expect, it } from 'vitest'
import { exposedCatalogTerms, hasCyrillic, PROSE_FORBIDDEN_TERMS } from '@/lib/ai/catalog-wording'
import { deterministicExplanation } from '@/lib/ai/outfit-intelligence'
import { CATALOG_TERMS } from '../../../scripts/ai-eval/eval-common'

describe('runtime catalog wording check', () => {
  it('flags exactly the terms the evaluator fails (status uzbek_label)', () => {
    const runtime = PROSE_FORBIDDEN_TERMS.map((w) => w.join(' ')).sort()
    const evaluator = CATALOG_TERMS.filter((t) => t.status === 'uzbek_label').map((t) => t.words.join(' ')).sort()
    expect(runtime).toEqual(evaluator)
  })

  it('finds English catalog ids in prose, multi-word ids first', () => {
    expect(exposedCatalogTerms('Oq oxford shirt va brown loafers kiying.').sort()).toEqual(['brown', 'loafers', 'oxford shirt'])
    expect(exposedCatalogTerms('Light blue ko‘ylak.')).toContain('light blue')
    expect(exposedCatalogTerms('Light blue ko‘ylak.')).not.toContain('blue')
  })

  it('accepts Uzbek wording, loanwords the app shows and words that are also Uzbek', () => {
    expect(exposedCatalogTerms('Oq oksford ko‘ylak, to‘q ko‘k chinos va jigarrang lofer tufli.')).toEqual([])
    expect(exposedCatalogTerms('Polo va smart-casual uslub mos.')).toEqual([])
    expect(exposedCatalogTerms('Buni tan olish kerak.')).toEqual([])
    expect(exposedCatalogTerms('Bleyzer yoki blazer, denim, navy.')).toEqual([])
  })

  it('detects Cyrillic letters', () => {
    expect(hasCyrillic('Бу образ')).toBe(true)
    expect(hasCyrillic('Bu o‘g‘il ko‘ylak')).toBe(false)
  })

  it('the deterministic fallback explanation itself follows the policy', () => {
    const item = (category: string, subcategory: string | null, colors: string[]) => ({ item: { category, subcategory, colors } })
    const c = {
      items: [item('shirt', 'oxford_shirt', ['white']), item('pants', 'chinos', ['navy']), item('shoes', 'loafers', ['brown']), item('outerwear', 'windbreaker', ['olive'])],
      reasons: ['weather', 'occasion', 'color_harmony', 'rain_ready', 'wind_ready'],
    }
    const text = deterministicExplanation(c as never, { occasion: 'work', weather: { band: 'cool' } as never })
    expect(exposedCatalogTerms(text)).toEqual([])
    expect(hasCyrillic(text)).toBe(false)
  })
})
