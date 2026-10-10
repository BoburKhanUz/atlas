/**
 * Uzbek output policy (docs/ai/uzbek-output-policy.md, evaluator rubric v3):
 * user-visible clothing and colour wording uses the catalog's Uzbek labels;
 * catalog ids stay internal. Also pins what the policy must NOT change: the
 * conservative premise rule, grounding, isolation and the script/alphabet
 * checks. Texts marked "bake-off" are stored synthetic outputs. No provider,
 * no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONFIDENCE_KEYS, type GarmentAttributes } from '@/lib/ai/garment-analysis'
import { CATEGORIES, COLORS, FITS, FORMALITIES, MATERIALS, PATTERNS, SLEEVE_LENGTHS, STYLES, SUBCATEGORIES } from '../../../src/lib/ai/catalog'
import { readFileSync } from 'fs'
import path from 'path'
import { MOBILE_LABELS } from '../../../scripts/ai-eval/client-labels'
import { CATALOG_TERMS, catalogWording, uzbekCheck } from '../../../scripts/ai-eval/eval-common'
import { stylistRubricFor } from '../../../scripts/ai-eval/eval-rubric'
import { outfitCases } from '../../../scripts/ai-eval/outfit-cases'
import { outfitCaseContext } from '../../../scripts/ai-eval/outfit-eval'
import { scoreOutfit } from '../../../scripts/ai-eval/outfit-scoring'
import { failureReasons, reviewReasons } from '../../../scripts/ai-eval/replay'
import { stylistCases } from '../../../scripts/ai-eval/stylist-cases'
import { scoreStylistCase } from '../../../scripts/ai-eval/stylist-eval'
import { premiseCorrected, type StylistOutcome } from '../../../scripts/ai-eval/stylist-scoring'
import { scoreItem, type ItemOutcome } from '../../../scripts/ai-eval/vision-scoring'

const answer = (shown: string, refs: string[] = []): StylistOutcome => ({ kind: 'answer', firstError: null, raw: shown, shown, refs, needsMoreInfo: false })
const stylist = (id: string, shown: string, refs: string[] = []) => scoreStylistCase(stylistCases().find((c) => c.id === id)!, answer(shown, refs))
const outfit = (id: string, explanation: string) => {
  const ctx = outfitCaseContext(outfitCases().find((c) => c.id === id)!)
  return scoreOutfit(ctx, { kind: 'ranked', firstError: null, ranking: ctx.candidates.map((_, i) => `O${i + 1}`), explanation })
}
const reasons = (feature: 'stylist' | 'outfit', r: { checks: object; pass: boolean }) => (r.pass ? [] : failureReasons(feature, r.checks as Record<string, unknown>))
const premise = stylistRubricFor({ version: 'synthetic-v1', sha256: '8733e67cf7fdbde2109006f3e476a792c115364bd0fc798220253dba83416c54' })('nonexistent_item')!.premise!

let globalFetch: ReturnType<typeof vi.fn>
beforeEach(() => {
  globalFetch = vi.fn(async () => {
    throw new Error('network is not allowed in this test')
  })
  vi.stubGlobal('fetch', globalFetch)
})
afterEach(() => {
  vi.unstubAllGlobals()
  expect(globalFetch).not.toHaveBeenCalled()
})

describe('policy table is derived from the catalog (no invented translations)', () => {
  const POLICY = [CATEGORIES, ...Object.values(SUBCATEGORIES), COLORS, PATTERNS, MATERIALS, STYLES, SLEEVE_LENGTHS, FITS, FORMALITIES].flat()

  it('every identifier carries exactly the web catalog labels plus the Flutter client labels of that id', () => {
    for (const t of CATALOG_TERMS) {
      const web = [...new Set(POLICY.filter((e) => e.id === t.id).map((e) => e.label))]
      for (const l of web) expect(t.webLabels, t.id).toContain(l)
      expect(t.mobileLabels, t.id).toEqual(MOBILE_LABELS[t.id] ?? [])
      expect(new Set(t.labels), t.id).toEqual(new Set([...t.webLabels, ...t.mobileLabels]))
    }
    const labels = (id: string) => CATALOG_TERMS.find((t) => t.id === id)!.labels
    expect(labels('olive')).toEqual(['Zaytun'])
    expect(labels('brown')).toEqual(['Jigarron', 'Jigarrang'])
    expect(labels('windbreaker')).toEqual(['Vetrovka', 'Shamoldan himoya kurtka'])
    expect(labels('sneakers')).toEqual(['Krossovka'])
  })

  it('the Flutter label copy matches the Dart sources exactly (read-only; drift fails this test)', () => {
    const mobile = path.resolve(__dirname, '../../../../mobile/lib/features')
    const read = (f: string) => readFileSync(path.join(mobile, f), 'utf8')
    const mapBlock = (src: string, name: string) => {
      const start = src.indexOf(`${name} = {`)
      expect(start, name).toBeGreaterThan(-1)
      return src.slice(start, src.indexOf('}', start))
    }
    const enumBlock = (src: string, name: string) => {
      const start = src.indexOf(`enum ${name} {`)
      expect(start, name).toBeGreaterThan(-1)
      return src.slice(start, src.indexOf(';', start))
    }
    const parsed = new Map<string, Set<string>>()
    const add = (block: string, re: RegExp) => {
      for (const [, id, label] of block.matchAll(re)) parsed.set(id, new Set([...(parsed.get(id) ?? []), label]))
    }
    const entry = /'([a-z_]+)':\s*'([^']+)'/g
    const option = /\w+\('([a-z_]+)',\s*'([^']+)'/g
    const wardrobe = read('wardrobe/presentation/wardrobe_labels.dart')
    for (const m of ['categories', '_subcategories', '_patterns', '_materials', '_sleeves', '_fits', '_formality']) add(mapBlock(wardrobe, m), entry)
    const options = read('onboarding/data/options.dart')
    for (const e of ['StyleOption', 'ColorOption', 'FitOption']) add(enumBlock(options, e), option)
    const occasions = [...mapBlock(read('outfits/presentation/outfit_labels.dart'), '_occasions').matchAll(entry)].filter(([, id]) => id === 'casual')
    for (const [, id, label] of occasions) parsed.set(id, new Set([...(parsed.get(id) ?? []), label]))
    parsed.delete('all') // the "Hammasi" filter tab is not a catalog id
    expect(new Set(Object.keys(MOBILE_LABELS))).toEqual(new Set(parsed.keys()))
    for (const [id, labels] of parsed) expect(new Set(MOBILE_LABELS[id]), id).toEqual(labels)
  })

  it('for every identifier with an Uzbek label: the label passes and the English id fails in the same sentence', () => {
    const flagged = CATALOG_TERMS.filter((t) => t.status === 'uzbek_label')
    expect(flagged.length).toBeGreaterThan(50)
    for (const t of flagged) {
      const english = catalogWording(`Bugun ${t.words.join(' ')} sizga juda mos keladi.`)
      expect(english.pass, t.id).toBe(false)
      expect(english.exposed[0], t.id).toEqual({ term: t.words.join(' '), labels: t.labels })
      for (const label of t.labels) expect(catalogWording(`Bugun ${label} sizga juda mos keladi.`).pass, `${t.id} → ${label}`).toBe(true)
    }
  })

  it('a word every client shows as its label is a loanword, never a violation', () => {
    expect(CATALOG_TERMS.filter((t) => t.status === 'loanword').map((t) => t.id).sort()).toEqual(['chinos', 'polo', 'smart_casual', 'tote'])
    const r = uzbekCheck('Smart-casual uslubdagi polo va chinos bilan oq krossovka kiying, bu sizga juda mos keladi.')
    expect(r.catalogWording).toEqual({ exposed: [], review: [], pass: true })
    expect(r.pass).toBe(true)
  })

  it('wording the two clients disagree on is reported for review, not penalised; the Uzbek homograph "tan" is exempt', () => {
    expect(CATALOG_TERMS.filter((t) => t.status === 'review').map((t) => t.id).sort()).toEqual([
      'black_tie', 'blazer', 'bohemian', 'casual', 'denim', 'formal', 'minimal', 'navy', 'plaid', 'regular', 'relaxed', 'rust', 'shorts', 'slim', 'streetwear', 'teal',
    ])
    // Web "Bleyzer" vs Flutter "Blazer": the English spelling is shown by one client, so it is never a violation.
    const blazer = uzbekCheck('Ofisdagi uchrashuv uchun to‘q ko‘k blazer va klassik shim bilan qora oksford kiying, bu juda mos keladi.')
    expect(blazer.catalogWording).toEqual({ exposed: [], review: ['blazer'], pass: true })
    // Both browns are canonical somewhere (web Jigarron, Flutter Jigarrang); neither is flagged.
    for (const t of ['Jigarron botinka sizga mos keladi va qulay.', 'Jigarrang botinka sizga mos keladi va qulay.']) expect(catalogWording(t)).toEqual({ exposed: [], review: [], pass: true })
    // An English id with Uzbek labels in both clients is still a violation, and every label is offered.
    expect(catalogWording('Olive windbreaker sizga mos keladi.').exposed).toEqual([
      { term: 'windbreaker', labels: ['Vetrovka', 'Shamoldan himoya kurtka'] },
      { term: 'olive', labels: ['Zaytun'] },
    ])
    const navy = uzbekCheck('Ko‘k (navy) bleyzer va klassik shim bilan qora oksford kiying, bu sizga mos keladi.')
    expect(navy.catalogWording).toEqual({ exposed: [], review: ['navy'], pass: true })
    expect(navy.pass).toBe(true)
    expect(uzbekCheck('Tan olish kerak, bu obraz sizga juda mos keladi va qulay.').pass).toBe(true)
  })
})

describe('user-visible prose', () => {
  it('correct Uzbek Latin catalog wording passes', () => {
    const r = uzbekCheck('Bugun zaytun polo va xaki chinos bilan oq krossovka kiying, bu sizga juda mos keladi.')
    expect(r.catalogWording.exposed).toEqual([])
    expect(r.pass).toBe(true)
  })

  it('English catalog terms fail when an Uzbek label exists, and the failure is attributed to the policy (bake-off)', () => {
    const text = 'Olive polo va olive windbreaker bir-biriga juda mos tushadi. Xaki chinoz va oq krossovkalar ko‘rinishni muvozanatli va qulay qiladi. Kulrang sharf esa salqin havoda yoqimli qo‘shimcha bo‘ladi.'
    const r = uzbekCheck(text)
    expect(r.catalogWording.exposed.map((e) => e.term).sort()).toEqual(['olive', 'olive', 'windbreaker'])
    // The Uzbek proxy itself is satisfied: only the explicit policy fails.
    expect(r.latin && r.uzbekAlphabet && r.uzbek && r.englishShare <= 0.05).toBe(true)
    expect(r.pass).toBe(false)
    expect(reasons('outfit', outfit('profile_strong', text))).toContain('language_policy')
    const fixed = text.replace(/Olive/g, 'Zaytun').replace('olive windbreaker', 'zaytun vetrovka')
    expect(reasons('outfit', outfit('profile_strong', fixed))).not.toContain('language_policy')
  })

  it('a single English catalog term fails even when it is a tiny share of the text (explicit policy, not a share)', () => {
    const r = uzbekCheck('Bugun zaytun polo va xaki chinos bilan oq sneakers kiying, bu sizga juda mos keladi va havoga ham to‘g‘ri tushadi, ertaga ham shunday kiyishingiz mumkin.')
    expect(r.englishShare).toBe(0)
    expect(r.catalogWording.exposed).toEqual([{ term: 'sneakers', labels: ['Krossovka'] }])
    expect(r.pass).toBe(false)
  })

  it('stylist colour-profile echo of English ids fails on the policy only (bake-off)', () => {
    const r = stylist('color_profile', 'Rang profilingizga olive, khaki, brown va beige ranglari juda mos keladi. Garderobingizdagi zaytun shorts, xaki chinos, bej nitki va jigarron botinka buyumlari bu talabga mukammal tushadi.', ['W9', 'W7', 'W5', 'W15'])
    expect(reasons('stylist', r)).toEqual(['language_policy'])
    const ok = stylist('color_profile', 'Rang profilingizga zaytun, xaki, jigarron va bej ranglari juda mos keladi. Garderobingizdagi zaytun shorts, xaki chinos, bej nitki va jigarron botinka buyumlari bu talabga mukammal tushadi.', ['W9', 'W7', 'W5', 'W15'])
    expect(reasons('stylist', ok)).not.toContain('language_policy')
  })

  it('mixed English prose fails on both the proxy and the policy', () => {
    const r = uzbekCheck('Bugun wear the white shirt and the navy trousers, bu sizga mos va yaxshi.')
    expect(r.englishShare).toBeGreaterThan(0.05)
    expect(r.catalogWording.exposed.map((e) => e.term).sort()).toEqual(['shirt', 'trousers', 'white'])
    expect(r.pass).toBe(false)
  })

  it('valid Uzbek answers keep passing (bake-off)', () => {
    const r = stylist('nonexistent_item', 'Garderobingizda qizil kostyum mavjud emas. xaki chinos va och ko‘k oksford ko‘ylak ni birlashtirib, oq krossovka kiyib ko\'rishingiz mumkin.', ['W11', 'W14', 'W3'])
    expect(r.checks.uzbek!.catalogWording.pass).toBe(true)
    expect(r.checks.uzbek!.pass).toBe(true)
  })

  it('Cyrillic leakage, Russian and Turkish never pass the Uzbek check', () => {
    expect(uzbekCheck('Bugun oq ko‘ylak va qora shim kiying, bu sizga juda mos keladi, оқ рангли.').latin).toBe(false)
    expect(uzbekCheck('Сегодня наденьте белую рубашку и чёрные брюки.').pass).toBe(false)
    expect(uzbekCheck('Segodnya nadevayte beluyu rubashku i chernye bryuki, eto ochen podkhodit.').pass).toBe(false)
    const tr = uzbekCheck('Bu gömlek ve pantolon bugün için çok uygun, beyaz ayakkabı giyin.')
    expect(tr.uzbekAlphabet).toBe(false)
    expect(tr.pass).toBe(false)
  })
})

describe('app-inserted labels vs model wording (stylist)', () => {
  const work = stylistCases().find((c) => c.id === 'work')!
  const outcome = (raw: string, shown: string): StylistOutcome => ({ kind: 'answer', firstError: null, raw, shown, refs: ['W10', 'W8', 'W14'], needsMoreInfo: false })

  it('labels the app inserted for [W…] are never judged as the model’s wording (no review noise)', () => {
    const r = scoreStylistCase(work, outcome(
      'Ofisdagi uchrashuv uchun [W10], [W8] va [W14] kiying, bu sizga juda mos keladi.',
      'Ofisdagi uchrashuv uchun ko‘k (navy) bleyzer, ko‘k (navy) shim (klasik) va qora oksford kiying, bu sizga juda mos keladi.',
    ))
    expect(r.checks.uzbek!.catalogWording).toEqual({ exposed: [], review: [], pass: true })
    expect(r.checks.uzbek!.pass).toBe(true)
  })

  it('the model’s own English wording is still caught next to an inserted label', () => {
    const r = scoreStylistCase(work, outcome(
      'Ofisdagi uchrashuv uchun olive blazer [W10] va [W8] bilan [W14] kiying, bu sizga juda mos keladi.',
      'Ofisdagi uchrashuv uchun olive blazer ko‘k (navy) bleyzer va ko‘k (navy) shim (klasik) bilan qora oksford kiying, bu sizga juda mos keladi.',
    ))
    expect(r.checks.uzbek!.catalogWording).toEqual({ exposed: [{ term: 'olive', labels: ['Zaytun'] }], review: ['blazer'], pass: false })
    expect(reasons('stylist', r)).toEqual(['language_policy'])
  })
})

describe('structured fields keep internal catalog ids', () => {
  it('vision attributes are scored as ids: an English id is correct, never a language failure', () => {
    const attributes: GarmentAttributes = {
      category: 'outerwear', subcategory: 'windbreaker', colors: ['olive', 'khaki'], pattern: 'solid', material: null, sleeveLength: null,
      fit: 'regular', style: 'casual', season: ['autumn'], gender: 'unisex', formality: 'casual',
    }
    const rawConfidence = Object.fromEntries(CONFIDENCE_KEYS.map((k) => [k, 0.9])) as Record<(typeof CONFIDENCE_KEYS)[number], number>
    const outcome: ItemOutcome = { kind: 'garment', attributes, rawConfidence, colorVerdict: 'supported' }
    const s = scoreItem({ subject: 'single_garment', category: 'outerwear', subcategory: 'windbreaker', primaryColor: 'olive' }, outcome)
    expect(s.fields).toEqual({ category: true, subcategory: true, primaryColor: true })
  })

  it('stylist references and outfit rankings are identifiers outside the prose check', () => {
    const r = stylist('casual', 'Bugun oq futbolka va jinsi shim bilan oq krossovka kiying, bu sizga qulay va juda mos keladi.', ['W1', 'W6', 'W13'])
    expect(r.checks.uzbek!.catalogWording.pass).toBe(true)
    const o = outfit('profile_none', 'Zaytun polo va xaki chinos birga juda muvozanatli ko‘rinadi. Oq krossovkalar uslubni yaxshi to‘ldiradi.')
    expect(o.checks.uzbek!.catalogWording.pass).toBe(true)
    expect(reasons('outfit', o)).not.toContain('language_policy')
  })
})

describe('the policy changes no other rule', () => {
  it('the conservative premise rule is unchanged, including the documented navy blazer/trousers false fail', () => {
    // A: recommends the denied item → fail.
    expect(premiseCorrected("Qizil kostyumingiz bilan qora oksford poyabzali [W14] yaxshi mos keladi.", premise)).toBe(false)
    // B: denial + owned alternative without the head noun → pass.
    expect(premiseCorrected("Garderobingizda qizil kostyum yo'q. Ko'k bleyzer [W10] va ko'k shim [W8] bilan qora oksford poyabzal [W14] kiying.", premise)).toBe(true)
    // C (ambiguous, documented for manual review): the owned blazer + trousers called a "kostyum" still fails.
    expect(premiseCorrected("Garderobingizda qizil kostyum yo'q. Ko'k bleyzer va shimdan iborat kostyumingizga [W10][W8] qora oksford [W14] mos keladi.", premise)).toBe(false)
    // D: denial + an invented black suit → fail (bake-off Gemini run 2).
    const gemini = stylist('nonexistent_item', 'Sizning garderobingizda qizil kostyum mavjud emas. Qora kostyum va shim uchun qora oksford poyabzalini mos kelishi mumkin.', ['W8'])
    expect(gemini.checks.premiseCorrected).toBe(false)
    expect(reasons('stylist', gemini)).toEqual(['premise'])
  })

  it('ambiguous outputs are flagged for human review without changing their verdict', () => {
    // Premise failure after a correct denial: FAIL, flagged (owned alternative or invented item: a human decides).
    const ownedAlternative = stylist('nonexistent_item', "Garderobingizda qizil kostyum yo'q. Ko'k bleyzer va shimdan iborat kostyumingizga qora oksford mos keladi.", ['W10', 'W8', 'W14'])
    expect(ownedAlternative.pass).toBe(false)
    expect(reviewReasons(ownedAlternative.checks as unknown as Record<string, unknown>)).toContain('premise_after_denial')
    const gemini = stylist('nonexistent_item', 'Sizning garderobingizda qizil kostyum mavjud emas. Qora kostyum va shim uchun qora oksford poyabzalini mos kelishi mumkin.', ['W8'])
    expect(gemini.pass).toBe(false)
    expect(reviewReasons(gemini.checks as unknown as Record<string, unknown>)).toContain('premise_after_denial')
    // A plain contradiction (no denial at all) is a FAIL that needs no review flag.
    const contradiction = stylist('nonexistent_item', 'Qizil kostyumingiz bilan qora oksford poyabzali yaxshi mos keladi.', ['W14'])
    expect(contradiction.pass).toBe(false)
    expect(contradiction.checks.premiseNeedsReview).toBeNull()
    // Ambiguous wording passes and is flagged; clean Uzbek is not flagged.
    const navy = stylist('work', 'Ofisdagi muhim uchrashuv uchun ko‘k (navy) bleyzer va klassik shim bilan qora oksford kiying, bu sizga juda mos keladi.', ['W10', 'W8', 'W14'])
    expect(reviewReasons(navy.checks as unknown as Record<string, unknown>)).toContain('language_review: navy')
    const clean = uzbekCheck('Bugun zaytun polo va xaki chinos bilan oq krossovka kiying, bu sizga juda mos keladi.')
    expect(reviewReasons({ uzbek: clean })).toEqual([])
  })

  it('a contradiction stays a premise failure, an invented item stays a grounding failure (bake-off)', () => {
    const openai = stylist('nonexistent_item', 'Sizdagi poyabzallardan qizil kostyumga eng mos va xavfsiz tanlov — qora oksford. U rasmiy ko‘rinishni toza ushlab turadi. Agar biroz kamroq rasmiy ko‘rinish xohlasangiz, kontekstda aynan kostyumga mos boshqa poyabzal yo‘q.', ['W8'])
    expect(reasons('stylist', openai)).toEqual(['premise'])
    const invented = stylist('nonexistent_item', 'Qizil kostyum garderobingizda yo‘q. Qizil galstuk bilan qora oksford kiying, bu sizga mos keladi.', ['W14'])
    expect(invented.checks.inventedGarments).toContain('galstuk')
    expect(reasons('stylist', invented)).toContain('grounding')
    expect(reasons('stylist', invented)).not.toContain('language_policy')
  })
})
