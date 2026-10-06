import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { prepareVisionImage } from '@/lib/ai/providers/vision-input'

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

  it('rejects an out-of-range maxSide and undecodable input', async () => {
    await expect(prepareVisionImage(await photo(10, 10, false), 0)).rejects.toThrow(RangeError)
    await expect(prepareVisionImage(await photo(10, 10, false), 2049)).rejects.toThrow(RangeError)
    await expect(prepareVisionImage(new Uint8Array([1, 2, 3]), 512)).rejects.toThrow()
  })
})
