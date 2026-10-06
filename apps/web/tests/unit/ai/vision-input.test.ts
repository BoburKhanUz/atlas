import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { MAX_VISION_BYTES, prepareVisionImage } from '@/lib/ai/providers/vision-input'

async function photo(width: number, height: number, withExif: boolean) {
  const img = sharp({ create: { width, height, channels: 3, background: '#336699' } }).jpeg()
  if (withExif) {
    return img
      .withMetadata({ orientation: 6 })
      .withExifMerge({ IFD0: { Make: 'TestCam', Copyright: 'SECRET-OWNER' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '41/1 18/1 0/1' } })
      .toBuffer()
  }
  return img.toBuffer()
}

describe('prepareVisionImage: what may leave the server', () => {
  it('rotates upright (EXIF orientation 6), fits inside maxSide, JPEG without any metadata', async () => {
    const input = await photo(2000, 1000, true)
    const before = await sharp(input).metadata()
    expect(before.orientation).toBe(6)
    expect(before.exif).toBeDefined()

    const out = await prepareVisionImage(input, 1024)
    expect(out.mimeType).toBe('image/jpeg')
    expect(out.maxSide).toBe(1024)
    const meta = await sharp(out.image).metadata()
    expect(meta.format).toBe('jpeg')
    // 2000×1000 rotated 90° → 1000×2000, then fit inside 1024 → 512×1024
    expect([meta.width, meta.height]).toEqual([512, 1024])
    expect(meta.exif).toBeUndefined()
    expect(meta.orientation).toBeUndefined()
    expect(Buffer.from(out.image).includes(Buffer.from('SECRET-OWNER'))).toBe(false)
    expect(Buffer.from(out.image).includes(Buffer.from('TestCam'))).toBe(false)
  })

  it('never enlarges small images', async () => {
    const meta = await sharp((await prepareVisionImage(await photo(300, 200, false), 1024)).image).metadata()
    expect([meta.width, meta.height]).toEqual([300, 200])
  })

  it('flattens transparency onto white (not the JPEG default black)', async () => {
    const transparent = await sharp({ create: { width: 300, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer()
    const out = await prepareVisionImage(transparent, 512)
    const { data } = await sharp(out.image).raw().toBuffer({ resolveWithObject: true })
    const mean = data.reduce((a, b) => a + b, 0) / data.length
    expect(mean).toBeGreaterThan(245)
    const webp = await sharp({ create: { width: 300, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).webp().toBuffer()
    const { data: w } = await sharp((await prepareVisionImage(webp, 512)).image).raw().toBuffer({ resolveWithObject: true })
    expect(w.reduce((a, b) => a + b, 0) / w.length).toBeGreaterThan(245)
  })

  it('the 768 px evaluation configuration also works, and output stays far below the byte limit', async () => {
    const big = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: '#884422' } }).jpeg().toBuffer()
    const out = await prepareVisionImage(big, 768)
    const meta = await sharp(out.image).metadata()
    expect([meta.width, meta.height]).toEqual([768, 576])
    expect(out.image.byteLength).toBeLessThan(MAX_VISION_BYTES)
  })

  it('rejects an out-of-range maxSide and undecodable input', async () => {
    await expect(prepareVisionImage(await photo(10, 10, false), 0)).rejects.toThrow(RangeError)
    await expect(prepareVisionImage(await photo(10, 10, false), 2049)).rejects.toThrow(RangeError)
    await expect(prepareVisionImage(new Uint8Array([1, 2, 3]), 512)).rejects.toThrow()
  })
})
