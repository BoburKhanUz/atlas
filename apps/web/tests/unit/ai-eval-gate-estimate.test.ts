/**
 * An attempt Go asks about is estimated from what it sends
 * (live-accounting.ts estimateAsked): the picture's size and settings as the
 * in-process estimate reads them from the bytes.
 */
import { describe, expect, it } from 'vitest'
import { estimateAsked } from '../../scripts/ai-eval/live-accounting'
import type { GateAsk } from '../../scripts/ai-eval/protocol'

const picture = (over: Partial<NonNullable<GateAsk['vision']>> = {}): GateAsk => ({
  feature: 'clothing_analysis', provider: 'openai', model: 'gpt-5.4-mini',
  vision: { mimeType: 'image/jpeg', width: 512, height: 384, maxSide: 512, instruction: 'what', schema: { name: 'g', schema: {} }, maxOutputTokens: 300, options: { openaiDetail: 'high' }, ...over },
})

describe('the estimate of an asked picture', () => {
  it('reads the size and the detail setting', () => {
    expect(estimateAsked(picture())).toMatchObject({ ok: true, tokens: { outputTokens: 300 } })
    expect(estimateAsked(picture({ options: { openaiDetail: 'low' } }))).toMatchObject({ ok: false, reason: expect.stringMatching(/documented bound/) })
  })

  it('a size Go could not read (either side 0) has no estimate', () => {
    for (const size of [{ width: 0, height: 384 }, { width: 512, height: 0 }]) expect(estimateAsked(picture(size))).toEqual({ ok: false, reason: 'image dimensions unreadable' })
  })

  it('no output limit, another provider: no estimate', () => {
    expect(estimateAsked(picture({ maxOutputTokens: null }))).toMatchObject({ ok: false, reason: /output-token limit/ })
    expect(estimateAsked({ ...picture(), provider: 'gemini' })).toMatchObject({ ok: false, reason: /gemini/ })
  })
})
