/**
 * case-setups.json is Go's setup of every kept case, as `lookly eval` makes
 * it today, and nothing else (docs/plan/B7.md, B7.4d). Regenerate with
 * `LOOKLY_BINARY=<built lookly> bun scripts/ai-eval/case-setups.ts`.
 */
import { describe, expect, it } from 'vitest'
import { collectSetups, frozenSetups, keptOutfitCases, keptStylistCases, outfitSetupOf, requestKey, stylistSetupOf } from '../../scripts/ai-eval/case-setups'
import { GoPipeline, outfitRequest, stylistRequest } from '../../scripts/ai-eval/go-pipeline'

if (!process.env.LOOKLY_BINARY) throw new Error('LOOKLY_BINARY is not set: build apps/api (go build -tags nodynamic -o <path> ./cmd/lookly) and point it there')

describe('the frozen case setups', () => {
  it("are Go's, case by case, and nothing else", async () => {
    const go = new GoPipeline({ args: ['--provider=mock'] })
    let now
    try {
      now = await collectSetups(go)
    } finally {
      await go.close()
    }
    for (const c of keptStylistCases()) expect(stylistSetupOf(c), c.id).toEqual(now.stylist[requestKey(stylistRequest(c))])
    for (const c of keptOutfitCases()) expect(outfitSetupOf(c), c.id).toEqual(now.outfit[requestKey(outfitRequest(c))])
    expect(Object.keys(frozenSetups().stylist).sort()).toEqual(Object.keys(now.stylist).sort())
    expect(Object.keys(frozenSetups().outfit).sort()).toEqual(Object.keys(now.outfit).sort())
    expect(Object.keys(now.stylist).length).toBeGreaterThan(70)
  }, 120_000)
})
