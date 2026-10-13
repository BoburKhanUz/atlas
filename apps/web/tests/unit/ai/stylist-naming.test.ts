/**
 * How wardrobe items are named in stylist answers. Real answers (OpenAI and
 * Gemini, local end-to-end run) named an item AND wrote its reference, so the
 * shown text repeated it ("oq oxford ko‘ylak oq oksford ko‘ylak"), and the
 * names used catalog labels the owner has since replaced ("ko‘k (navy)",
 * "jigarron mokasin" for loafers).
 */
import { describe, expect, it } from 'vitest'
import { InvalidStylistOutputError, itemDisplayName, resolveReferences, type ReferencedItem } from '@/lib/ai/stylist'

const items = new Map<string, ReferencedItem>([
  ['W1', { category: 'shirt', subcategory: 'oxford_shirt', colors: ['white'] }],
  ['W2', { category: 'pants', subcategory: 'chinos', colors: ['navy'] }],
  ['W3', { category: 'shoes', subcategory: 'loafers', colors: ['brown'] }],
])
const count = (text: string, part: string) => text.split(part).length - 1

describe('stylist item names: approved terminology', () => {
  it.each([
    [{ category: 'pants', subcategory: 'chinos', colors: ['navy'] }, 'to‘q ko‘k chinos'],
    [{ category: 'shoes', subcategory: 'loafers', colors: ['brown'] }, 'jigarrang lofer tufli'],
    [{ category: 'shoes', subcategory: 'oxford_shoes', colors: ['black'] }, 'qora oksford tufli'],
    [{ category: 'pants', subcategory: 'trousers', colors: ['gray'] }, 'kulrang klassik shim'],
    [{ category: 'shirt', subcategory: 'knit', colors: ['teal'] }, 'ko‘k-yashil sviter'],
    [{ category: 'outerwear', subcategory: 'windbreaker', colors: ['rust'] }, 'zang rang shamol kurtkasi'],
    [{ category: 'bag', subcategory: 'crossbody', colors: ['black'] }, 'qora ko‘ndalang tasmali sumka'],
    [{ category: 'bag', subcategory: 'clutch', colors: [] }, 'klatch'],
    [{ category: 'accessory', subcategory: 'belt', colors: ['brown'] }, 'jigarrang kamar'],
    [{ category: 'shoes', subcategory: 'sandals', colors: [] }, 'sandal'],
    [{ category: 'shirt', subcategory: null, colors: [] }, 'ko‘ylak'],
    [{ category: 'dress', subcategory: null, colors: ['red'] }, 'qizil ko‘ylak (ayol)'],
  ])('%j → %s', (item, name) => {
    expect(itemDisplayName(item)).toBe(name)
  })

  it('never names loafers "mokasin" and never shows English in parentheses', () => {
    const name = itemDisplayName({ category: 'shoes', subcategory: 'loafers', colors: ['navy'] })
    expect(name).not.toMatch(/mokasin|\(navy\)|\(rust\)|\(teal\)|jigarron/)
  })
})

describe('stylist item names: an item the model already named is shown once', () => {
  it('the real OpenAI answer: model name + reference → one canonical name per item', () => {
    const raw = 'Eng yaxshi tanlov: oq oxford ko‘ylak [W1], to‘q ko‘k chinos [W2] va jigarrang loafers [W3]. Bu ish uchrashuvi uchun tartibli ko‘rinadi.'
    expect(resolveReferences(raw, items)).toBe(
      'Eng yaxshi tanlov: oq oksford ko‘ylak, to‘q ko‘k chinos va jigarrang lofer tufli. Bu ish uchrashuvi uchun tartibli ko‘rinadi.',
    )
  })

  it('the model’s noun after the reference keeps its case suffix, once', () => {
    const raw = 'Uchrashuv uchun [W1] ko‘ylagini [W2] va [W3] bilan kiying.'
    const shown = resolveReferences(raw, items)
    expect(shown).toBe('Uchrashuv uchun oq oksford ko‘ylagini to‘q ko‘k chinos va jigarrang lofer tufli bilan kiying.')
    expect(count(shown, 'ko‘yla')).toBe(1)
  })

  it('a colour-only phrase before the reference is replaced by the full name (the item’s own colour wins)', () => {
    expect(resolveReferences('Bugun qora [W3] kiying.', items)).toBe('Bugun jigarrang lofer tufli kiying.')
  })

  it('a name at the very start of the answer or of a line is replaced whole', () => {
    expect(resolveReferences('oq oxford ko‘ylak [W1] eng yaxshisi.', items)).toBe('oq oksford ko‘ylak eng yaxshisi.')
    expect(resolveReferences('Tavsiya:\noq oxford ko‘ylak [W1] va [W2].', items)).toBe('Tavsiya:\noq oksford ko‘ylak va to‘q ko‘k chinos.')
  })

  it('each item’s name appears exactly once', () => {
    const shown = resolveReferences('Eng yaxshi tanlov: oq oxford ko‘ylak [W1], to‘q ko‘k chinos [W2] va jigarrang loafers [W3].', items)
    for (const name of ['oq oksford ko‘ylak', 'to‘q ko‘k chinos', 'jigarrang lofer tufli']) expect(count(shown, name)).toBe(1)
    expect(shown).not.toMatch(/oxford|loafers|mokasin|\(navy\)|\bW\d/)
  })
})

describe('stylist item names: real provider outputs (captured raw answers, local run)', () => {
  // Raw model answers before post-processing, with W1 = white oxford shirt,
  // W2 = navy chinos, W3 = brown loafers.
  const real = {
    openai:
      'Ofisdagi muhim uchrashuv uchun eng to‘g‘ri tanlov: [W1] + [W2] + [W3]. Bu kombinatsiya saranjom va ishonchli ko‘rinadi, ob-havoga ham mos. Agar xohlasangiz, shu libosga yanada rasmiyroq yoki yumshoqroq variant ham tavsiya qilaman.',
    gemini:
      "Ofisdagi muhim uchrashuv uchun [W1] ko'ylagini [W2] shim va [W3] tuflilar bilan moslab kiyishingizni tavsiya qilaman. Bu ko'rinish ish uslubiga juda mos keladi.",
  }

  it.each(Object.entries(real))('%s: each item named once, approved terms, no internal references', (_provider, raw) => {
    const shown = resolveReferences(raw, items)
    // The item's name, up to an inflected last word ("ko‘ylak" → "ko'ylagini", "tufli" → "tuflilar").
    expect(count(shown, 'oq oksford ko')).toBe(1)
    expect(count(shown, 'to‘q ko‘k chinos')).toBe(1)
    expect(count(shown, 'jigarrang lofer tufli')).toBe(1)
    expect(shown).not.toMatch(/\bW\d|mokasin|jigarron|\(navy\)|oxford|loafers/i)
  })

  it('gemini: the model’s inflected nouns keep their suffix on the canonical name', () => {
    expect(resolveReferences(real.gemini, items)).toBe(
      "Ofisdagi muhim uchrashuv uchun oq oksford ko'ylagini to‘q ko‘k chinos shim va jigarrang lofer tuflilar bilan moslab kiyishingizni tavsiya qilaman. Bu ko'rinish ish uslubiga juda mos keladi.",
    )
  })
})

describe('stylist item names: safety', () => {
  it('a word naming ANOTHER item is never merged into or removed for this reference', () => {
    // "chinos" belongs to W2, not W1: kept as written; W1 still gets its own name.
    expect(resolveReferences('Bugun chinos [W1] kiying.', items)).toBe('Bugun chinos oq oksford ko‘ylak kiying.')
  })

  it('stops at clause words and punctuation: nothing before them is touched', () => {
    expect(resolveReferences('Shim va [W1] mos.', items)).toBe('Shim va oq oksford ko‘ylak mos.')
    expect(resolveReferences('Tanlov: [W2].', items)).toBe('Tanlov: to‘q ko‘k chinos.')
  })

  it('a repeated reference resolves to the same item each time; adjacent references stay separate', () => {
    const shown = resolveReferences('[W2] juda qulay. Yana [W2] ni [W3] bilan kiying.', items)
    expect(shown).toBe('to‘q ko‘k chinos juda qulay. Yana to‘q ko‘k chinos ni jigarrang lofer tufli bilan kiying.')
  })

  it('text without references is unchanged, including names of items the user does not own', () => {
    const raw = 'Qizil palto va oq krossovka yaxshi uyg‘unlashadi.'
    expect(resolveReferences(raw, items)).toBe(raw)
  })

  it('an unknown reference still fails closed', () => {
    expect(() => resolveReferences('oq ko‘ylak [W9] kiying.', items)).toThrow(InvalidStylistOutputError)
  })
})
