/**
 * The frozen case setups (scripts/ai-eval/case-setups.ts): stored with each
 * message text once and read back whole; a case whose request is not frozen
 * is refused with the command that freezes it.
 */
import { describe, expect, it } from 'vitest'
import { outfitSetupOf, pack, stylistSetupOf, unpack, type CaseSetups } from '../../scripts/ai-eval/case-setups'
import { outfitCases } from '../../scripts/ai-eval/outfit-cases'
import type { OutfitSetup, StylistSetup } from '../../scripts/ai-eval/protocol'
import { stylistCases } from '../../scripts/ai-eval/stylist-cases'

const stylist = (content: string): StylistSetup => ({ refs: ['W1'], messages: [{ role: 'system', content: 'rules' }, { role: 'user', content }], schema: { name: 's', schema: {} } })

describe('case setups', () => {
  it('are stored with each text once and read back whole', () => {
    const outfit = { candidates: [], weatherProvided: false, profileSent: false, profileStrength: null, problem: 'empty_wardrobe', fallbackExplanation: null, messages: [{ role: 'system', content: 'rules' }], schema: { name: 'o', schema: {} } } satisfies OutfitSetup
    const setups: CaseSetups = { stylist: { a: stylist('one'), b: stylist('two') }, outfit: { c: outfit } }
    const packed = pack(setups)
    expect(packed.texts).toEqual(['rules', 'one', 'two'])
    expect(unpack(JSON.parse(JSON.stringify(packed)))).toEqual(setups)
    expect(() => unpack({ ...packed, texts: ['rules'] })).toThrow(/names text 1/)
  })

  it('a case whose request is not frozen is refused, with the command', () => {
    const changed = { ...stylistCases()[0], message: 'Boshqa savol' }
    expect(() => stylistSetupOf(changed)).toThrow(/no stylist setup for case .*case-setups\.ts/)
    expect(() => outfitSetupOf({ ...outfitCases()[0], topN: 1 })).toThrow(/no outfit setup/)
    // A renamed copy asks the same: it has the same setup.
    expect(stylistSetupOf({ ...stylistCases()[0], id: 'copy', tags: [] })).toEqual(stylistSetupOf(stylistCases()[0]))
  })
})
