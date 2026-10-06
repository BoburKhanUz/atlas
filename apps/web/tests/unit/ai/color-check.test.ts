import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { COLORS } from '@/lib/ai/catalog'
import {
  COLOR_FAMILIES,
  CONFLICT_MAX_CONFIDENCE,
  CONFLICT_SHARE,
  centerColorShares,
  crossCheckPrimaryColor,
  judgeColor,
  SUPPORTED_SHARE,
  WEAK_SUPPORT_MAX_CONFIDENCE,
} from '@/lib/ai/color-check'

const solid = (hex: string) => sharp({ create: { width: 400, height: 400, channels: 3, background: hex } }).jpeg().toBuffer()
/** A centre square of one colour on a background of another (the background covers the outer 30% each side). */
async function framed(center: string, background: string) {
  const inner = await sharp({ create: { width: 160, height: 160, channels: 3, background: center } }).png().toBuffer()
  return sharp({ create: { width: 400, height: 400, channels: 3, background } }).composite([{ input: inner, left: 120, top: 120 }]).jpeg().toBuffer()
}

describe('colour families', () => {
  it('cover every catalog colour, and each family contains the colour itself', () => {
    for (const c of COLORS) {
      expect(COLOR_FAMILIES[c.id], c.id).toBeDefined()
      expect(COLOR_FAMILIES[c.id]).toContain(c.id)
      for (const member of COLOR_FAMILIES[c.id]) expect(COLORS.some((x) => x.id === member), member).toBe(true)
    }
  })
})

describe('judgeColor thresholds', () => {
  const shares = (entries: Record<string, number>) => new Map(Object.entries(entries))
  it('supported, weak, conflict, no colour', () => {
    expect(judgeColor('navy', shares({ navy: 0.1, blue: SUPPORTED_SHARE }))).toMatchObject({ verdict: 'supported', confidenceCap: null })
    expect(judgeColor('navy', shares({ blue: 0.08, red: 0.92 }))).toMatchObject({ verdict: 'weak', confidenceCap: WEAK_SUPPORT_MAX_CONFIDENCE })
    expect(judgeColor('navy', shares({ red: 1 - CONFLICT_SHARE / 2, navy: CONFLICT_SHARE / 2 }))).toMatchObject({ verdict: 'conflict', confidenceCap: CONFLICT_MAX_CONFIDENCE })
    expect(judgeColor(undefined, shares({ red: 1 }))).toMatchObject({ verdict: 'no_color', confidenceCap: null })
    expect(CONFLICT_MAX_CONFIDENCE).toBeLessThan(0.4) // shown as low → reviewed
  })
})

describe('pixel evidence', () => {
  it('a red garment photographed as red supports "red"', async () => {
    expect((await crossCheckPrimaryColor(new Uint8Array(await solid('#B91C1C')), ['red'])).verdict).toBe('supported')
  })

  it('a navy claim on a clearly red garment is a conflict (confidence lowered, colour kept)', async () => {
    const check = await crossCheckPrimaryColor(new Uint8Array(await solid('#B91C1C')), ['navy', 'red'])
    expect(check.verdict).toBe('conflict')
    expect(check.confidenceCap).toBe(CONFLICT_MAX_CONFIDENCE)
  })

  it('only the centre counts: a white background does not outvote a navy garment', async () => {
    const image = new Uint8Array(await framed('#1E2A4A', '#FFFFFF'))
    const shares = await centerColorShares(image)
    expect((shares.get('navy') ?? 0) + (shares.get('black') ?? 0)).toBeGreaterThan(0.4)
    expect((await crossCheckPrimaryColor(image, ['navy'])).verdict).toBe('supported')
  })

  it('no colours from the model → no check, no cap', async () => {
    expect(await crossCheckPrimaryColor(new Uint8Array(await solid('#B91C1C')), [])).toEqual({ verdict: 'no_color', support: 0, confidenceCap: null })
  })
})
