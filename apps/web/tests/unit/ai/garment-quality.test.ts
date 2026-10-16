import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { GARMENT_MIN_SHARPNESS, isTooBlurryForAnalysis } from '@/lib/ai/garment-quality'

const W = 600, H = 800
/** A shirt-like shape with a collar line and buttons on a plain studio background. */
const shirt = (bg: string, fill: string) =>
  sharp(Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="${bg}"/>` +
      `<path d="M200 150 L110 190 L60 560 L120 575 L170 300 L170 660 L430 660 L430 300 L480 575 L540 560 L490 190 L400 150 L340 200 L300 170 L260 200 Z" fill="${fill}" stroke="#333" stroke-width="3"/>` +
      Array.from({ length: 6 }, (_, i) => `<circle cx="300" cy="${240 + i * 70}" r="7" fill="#222"/>`).join('') +
      `</svg>`,
  ))

describe('garment photo sharpness check', () => {
  it('keeps sharp photos, including a light garment on a light background', async () => {
    expect(await isTooBlurryForAnalysis(await shirt('#f2f2f2', '#9ec9ef').jpeg().toBuffer())).toBe(false)
    expect(await isTooBlurryForAnalysis(await shirt('#f5f5f5', '#fdfdfd').jpeg().toBuffer())).toBe(false)
    expect(await isTooBlurryForAnalysis(await shirt('#cfd8dc', '#1c1c1c').png().toBuffer())).toBe(false)
  })

  it('refuses strongly blurred photos and photos without any detail', async () => {
    expect(await isTooBlurryForAnalysis(await shirt('#f2f2f2', '#9ec9ef').blur(40).png().toBuffer())).toBe(true)
    expect(await isTooBlurryForAnalysis(await shirt('#f2f2f2', '#9ec9ef').blur(12).jpeg().toBuffer())).toBe(true)
    expect(await isTooBlurryForAnalysis(await sharp({ create: { width: W, height: H, channels: 3, background: '#2F5DA8' } }).jpeg().toBuffer())).toBe(true)
  })

  it('leaves undecodable input to the later steps', async () => {
    expect(await isTooBlurryForAnalysis(Buffer.from('not an image'))).toBe(false)
  })

  it('the threshold stays the calibrated value', () => {
    expect(GARMENT_MIN_SHARPNESS).toBe(20)
  })
})
