/**
 * Regression tests for the independent audit of the real-data tooling
 * (docs/ai/tooling-audit-2026-10-10.md). Artificial fixtures only, no
 * provider, no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LLMProvider } from '@/lib/ai/providers/types'
import { precheckRubricSet, realisticStylistRubricSet, type RubricSet } from '../../../scripts/ai-eval/case-rubric'
import { RubricIdentityError } from '../../../scripts/ai-eval/eval-rubric'
import { caseSetIdentity } from '../../../scripts/ai-eval/live-accounting'
import { evaluateFixture, evaluateFixtures, FixtureOutput, OutfitFixture } from '../../../scripts/ai-eval/outfit-fixtures'
import { STYLIST_REALISTIC_VERSION, stylistRealisticCases } from '../../../scripts/ai-eval/real-data/stylist-realistic-cases'
import { runValidation } from '../../../scripts/ai-eval/real-data/validate'
import { reviewCase, summarizeReview } from '../../../scripts/ai-eval/review'
import { scoreStylistCase, ScriptedStylist } from '../../../scripts/ai-eval/stylist-eval'

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

describe('audit D: an owned item named but not recommended is not grounded', () => {
  const wardrobe = [
    { ref: 'W1', category: 'shirt', subcategory: 'tshirt', colors: ['white'] },
    { ref: 'W2', category: 'pants', subcategory: 'jeans', colors: ['blue'] },
    { ref: 'W3', category: 'shoes', subcategory: 'sneakers', colors: ['white'] },
    { ref: 'W4', category: 'pants', subcategory: 'trousers', colors: ['navy'] },
    { ref: 'W5', category: 'outerwear', subcategory: 'coat', colors: ['gray'] },
    { ref: 'W6', category: 'shirt', subcategory: 'oxford_shirt', colors: ['white'] },
    { ref: 'W7', category: 'shoes', subcategory: 'oxford_shoes', colors: ['black'] },
    { ref: 'W8', category: 'pants', subcategory: 'jeans', colors: ['black'] },
  ]
  const fx = OutfitFixture.parse({ id: 'x', tags: [], wardrobe, weather: { feelsLikeC: 20, condition: 'clear' }, occasion: 'casual', expect: { abstain: false, formal: false }, languagePolicy: 'uzbek-output-policy-v1', safety: { abstentionAllowed: false } })
  const score = (items: string[], explanation: string) => evaluateFixture(fx, FixtureOutput.parse({ case: 'x', kind: 'recommendation', items, explanation }))

  it('before the fix: "klassik shim" (owned trousers, not recommended) instead of the recommended jeans passed grounding', () => {
    const r = score(['W1', 'W2', 'W3'], 'Oq futbolka va klassik shim bilan oq krossovka kiying, bu juda qulay va mos keladi.')
    expect(r.metrics.grounding).toBe(false)
    expect(r.findings).toEqual(['grounding_explanation_names_unrecommended:trousers'])
    expect(r.pass).toBe(false)
  })

  it('an inflected label ("paltoni") is detected; the recommended items themselves are not', () => {
    expect(score(['W1', 'W2', 'W3'], 'Oq futbolka va ko‘k jinsi bilan oq krossovka kiying, kulrang paltoni esa uyda qoldiring.').findings).toContain('grounding_explanation_names_unrecommended:coat')
    const ok = score(['W1', 'W2', 'W3'], 'Oq futbolka va ko‘k jinsi bilan oq krossovkalar bugun uchun qulay tanlov bo‘ladi.')
    expect(ok.findings).toEqual([])
    expect(ok.metrics.grounding).toBe(true)
  })

  it('longest label first: the recommended "oksford ko‘ylak" is never read as the unrecommended shoe "oksford"', () => {
    const r = score(['W6', 'W2', 'W3'], 'Oq oksford ko‘ylak va ko‘k jinsi bilan oq krossovka kiying, bu juda qulay va mos keladi.')
    expect(r.findings).toEqual([])
    // The shoe label alone, when the shoes are not recommended, is caught.
    expect(score(['W6', 'W2', 'W3'], 'Oq oksford ko‘ylak va ko‘k jinsi bilan qora oksford tufli kiying, bu juda qulay va mos keladi.').findings).toContain('grounding_explanation_names_unrecommended:oxford_shoes')
  })

  it('a label shared by a recommended and an unrecommended item (two pairs of jeans) names the recommended one', () => {
    expect(score(['W1', 'W2', 'W3'], 'Oq futbolka va jinsi bilan oq krossovka kiying, bu juda qulay va mos keladi.').findings).toEqual([])
  })
})

describe('audit C: rubric identity is checked before any provider call; the false premise never passes on keywords', () => {
  const corpus = stylistRealisticCases()
  const dataset = { version: STYLIST_REALISTIC_VERSION, sha256: caseSetIdentity('', '', STYLIST_REALISTIC_VERSION, corpus).sha256 }
  const env = { GEMINI_API_KEY: 'fake-key-not-real-91', AI_EVAL_GEMINI_MODEL: 'g' }
  const opts = { root: null, purpose: 'evaluation' as const, maxCalls: 4 * 60, maxCostUsd: null, now: new Date('2026-10-10T12:00:00Z'), runId: 'run-test', appCommit: { sha: 'abc', clean: true } }

  it('precheck: a foreign set throws even with no cases; undeclared cases are listed', () => {
    const set = realisticStylistRubricSet()
    expect(precheckRubricSet(set, dataset, corpus.map((c) => c.id))).toEqual([])
    expect(() => precheckRubricSet(set, { ...dataset, sha256: 'c'.repeat(64) }, [])).toThrow(RubricIdentityError)
    const { lim_empty: _omitted, ...rest } = set.cases
    expect(precheckRubricSet({ ...set, cases: rest }, dataset, ['lim_empty', 'cas_cafe'])).toEqual([{ case: 'lim_empty', reason: expect.stringMatching(/no rubric declaration/) }])
  })

  it('validate: a rubric set for another corpus stops the run before any provider is built (before: after the first paid call)', async () => {
    let built = 0
    const foreign: RubricSet = { ...realisticStylistRubricSet(), identity: { version: STYLIST_REALISTIC_VERSION, sha256: 'd'.repeat(64) } }
    const providers = { llm: (): LLMProvider => (built++, new ScriptedStylist()) }
    await expect(runValidation(env, { ...opts, transmitConstructed: true, providers, stylistRubricSet: foreign })).rejects.toThrow(RubricIdentityError)
    expect(built).toBe(0)
    // Without provider transmission nothing is sent, so the stylist rubric is not needed and the run reports normally.
    const off = await runValidation(env, { ...opts, transmitConstructed: false, providers, stylistRubricSet: foreign })
    expect(off.stylist.live.every((l) => l.status === 'BLOCKED')).toBe(true)
    expect(built).toBe(0)
  })

  it('validate: an undeclared case is reported UNSCORABLE (automatic verdict "unscorable"), never a pass or a model failure', async () => {
    const { lim_empty: _omitted, ...rest } = realisticStylistRubricSet().cases
    const r = await runValidation(env, { ...opts, transmitConstructed: true, providers: { llm: () => new ScriptedStylist() }, stylistRubricSet: { ...realisticStylistRubricSet(), cases: rest } })
    const review = r.stylist.live[0].review!
    expect(review.unscorable).toBe(1)
    expect(review.flagged.find((f) => f.case === 'lim_empty')).toMatchObject({ automaticVerdict: 'unscorable', finalStatus: 'UNSCORABLE', unscorableReason: expect.stringMatching(/no rubric declaration/) })
    expect(r.stylist.live[0].summary!.unscorable).toBe(1)
    expect(r.blockers).toContainEqual(expect.stringMatching(/stylist gemini: 1 case\(s\) UNSCORABLE/))
  })

  it('lim_ask_missing_item: affirmations and generic denials fail even with absence keywords; only a named denial passes', () => {
    const c = corpus.find((x) => x.id === 'lim_ask_missing_item')!
    const ctx = { set: realisticStylistRubricSet(), dataset }
    const a = (t: string) => scoreStylistCase(c, { kind: 'answer', firstError: null, raw: t, shown: t, refs: [], needsMoreInfo: false }, ctx)
    for (const t of [
      "Qora kostyumingiz bilan jigarrang oksford tufli mos keladi, boshqa variant yo'q.",
      "Jigarrang oksford tufli yaxshi tanlov bo'ladi, kostyum bilan juda mos keladi.",
      "Garderobingizda qora kostyum yo'q. Uni jigarrang tufli bilan kiysangiz yaxshi bo'ladi.",
      "Qora kostyum yo'q deb o'ylamang, u jigarrang tufli bilan juda mos keladi.",
    ]) expect(a(t).pass, t).toBe(false)
    expect(a("Garderobingizda qora kostyum yo'q. Ko'k bleyzer va kulrang shim bilan jigarrang oksford tufli kiyishingiz mumkin.").pass).toBe(true)
  })
})

describe('final pre-approval review: limitations L1, L2, L5', () => {
  const wardrobe = [
    { ref: 'W1', category: 'shirt', subcategory: 'tshirt', colors: ['white'] },
    { ref: 'W2', category: 'pants', subcategory: 'jeans', colors: ['blue'] },
    { ref: 'W3', category: 'shoes', subcategory: 'sneakers', colors: ['white'] },
    { ref: 'W4', category: 'shirt', subcategory: 'polo', colors: ['olive'] },
    { ref: 'W5', category: 'outerwear', subcategory: 'blazer', colors: ['navy'] },
  ]
  const fx = OutfitFixture.parse({ id: 'x', tags: [], wardrobe, weather: { feelsLikeC: 20, condition: 'clear' }, occasion: 'casual', expect: { abstain: false, formal: false }, languagePolicy: 'uzbek-output-policy-v1', safety: { abstentionAllowed: false } })
  const score = (items: string[], explanation: string) => evaluateFixture(fx, FixtureOutput.parse({ case: 'x', kind: 'recommendation', items, explanation }))

  it('L1: a recommended item named with a colour it does not have fails grounding (before: passed)', () => {
    const r = score(['W1', 'W2', 'W3'], 'Oq futbolka va ko‘k jinsi bilan qora krossovka kiying, bu juda qulay va mos keladi.')
    expect(r.findings).toEqual(['grounding_colour_mismatch:sneakers:qora'])
    expect(r.metrics).toMatchObject({ grounding: false, structure: true, language_policy: true })
    expect(score(['W1', 'W2', 'W3'], 'Qizil futbolka va ko‘k jinsi bilan oq krossovka kiying, bu juda qulay va mos keladi.').findings).toEqual(['grounding_colour_mismatch:tshirt:qizil'])
  })

  it('L1: correct colours pass, including "X rangli", shades of one colour word and labels of both clients', () => {
    for (const t of [
      'Oq futbolka va ko‘k jinsi bilan oq krossovka kiying, bu juda qulay va mos keladi.',
      'Zaytun rangli polo va ko‘k jinsi bilan oq krossovka kiying, bu juda qulay va mos keladi.',
      'Zaytun polo, ko‘k jinsi, to‘q ko‘k blazer va oq krossovka bugun juda mos keladi.',
      'Zaytun polo, ko‘k jinsi, to‘q ko‘k bleyzer va oq krossovka bugun juda mos keladi.',
    ]) expect(score(t.includes('polo') ? ['W4', 'W2', 'W3', ...(t.includes('ko‘k bl') ? ['W5'] : [])] : ['W1', 'W2', 'W3'], t).findings, t).toEqual([])
    expect(score(['W4', 'W2', 'W3'], 'Qora rangli polo va ko‘k jinsi bilan oq krossovka kiying, bu juda qulay va mos keladi.').findings).toEqual(['grounding_colour_mismatch:polo:qora'])
  })

  it('L5: internal references are caught in any case, as the app validator does', () => {
    for (const t of ['w1 va w2 bugun uchun qulay tanlov, oq krossovka esa obrazni yengil qiladi.', 'Oq futbolka (o2 varianti) va ko‘k jinsi bilan oq krossovka juda mos keladi.', 'W1 va W2 bugun uchun qulay tanlov, oq krossovka esa obrazni yengil qiladi.']) {
      const r = score(['W1', 'W2', 'W3'], t)
      expect(r.metrics.safety, t).toBe(false)
      expect(r.findings).toContain('safety_private_or_reference_in_explanation')
    }
  })

  it('L2: a generic denial of the head noun stays FAIL but goes to human review (before: a silent FAIL)', () => {
    const corpus = stylistRealisticCases()
    const ctx = { set: realisticStylistRubricSet(), dataset: { version: STYLIST_REALISTIC_VERSION, sha256: caseSetIdentity('', '', STYLIST_REALISTIC_VERSION, corpus).sha256 } }
    const c = corpus.find((x) => x.id === 'lim_ask_missing_item')!
    const a = (t: string) => scoreStylistCase(c, { kind: 'answer', firstError: null, raw: t, shown: t, refs: [], needsMoreInfo: false }, ctx)
    const generic = a("Garderobingizda kostyum yo'q. Ko'k bleyzer va kulrang shim bilan jigarrang oksford tufli kiyishingiz mumkin.")
    expect(generic.pass).toBe(false)
    expect(generic.checks.premiseNeedsReview).toBe(true)
    expect(reviewCase(c.id, generic.pass, generic.checks as unknown as Record<string, unknown>)).toMatchObject({ automaticVerdict: 'fail', finalStatus: 'PENDING_HUMAN_REVIEW', reviewReasons: ['premise_after_denial'] })
    // A contradiction with no denial at all is a plain FAIL with no review flag.
    const contradiction = a('Qora kostyumingiz bilan jigarrang oksford tufli yaxshi mos keladi, bu sizga yarashadi.')
    expect(contradiction.checks.premiseNeedsReview).toBeNull()
    expect(reviewCase(c.id, contradiction.pass, contradiction.checks as unknown as Record<string, unknown>).finalStatus).toBe('FAIL')
    // A correct, named denial passes and needs no review.
    expect(a("Garderobingizda qora kostyum yo'q. Ko'k bleyzer va kulrang shim bilan jigarrang oksford tufli kiyishingiz mumkin.").checks.premiseNeedsReview).toBeNull()
  })

  it('L4: duplicates stop with an explicit message (never counted twice)', () => {
    expect(() => evaluateFixtures([fx], [FixtureOutput.parse({ case: 'x', kind: 'invalid' }), FixtureOutput.parse({ case: 'x', kind: 'invalid' })])).toThrow('duplicate output for fixture x (each case is scored once)')
    expect(() => summarizeReview([reviewCase('a', true, {}), reviewCase('a', true, {})])).toThrow('duplicate case a in a review summary (a case is counted once)')
  })
})
