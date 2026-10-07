/**
 * Phase 5.2 guard: the image-quality check would notice if the app's image
 * preparation ever kept metadata (EXIF/XMP/IPTC) — simulated here by a
 * preparation that leaks it. No network, no real data.
 */
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/lib/ai/providers/vision-input', async () => ({
  prepareVisionImage: async (input: Uint8Array) => ({ image: new Uint8Array(await sharp(input).jpeg().withMetadata({ exif: { IFD0: { Copyright: 'leak' } } }).toBuffer()), mimeType: 'image/jpeg', maxSide: 1024 }),
}))

describe('image quality metadata guard', () => {
  it('flags a preparation that keeps metadata', async () => {
    const { imageQuality } = await import('../../../scripts/ai-eval/real-data/real-vision')
    const img = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#808080' } }).png().toBuffer()
    const q = await imageQuality('c1', new Uint8Array(img))
    expect(q).toMatchObject({ preparedOk: true, preparedHasMetadata: true, hadExif: false })
  })
})
