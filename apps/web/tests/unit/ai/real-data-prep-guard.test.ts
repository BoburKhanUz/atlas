/**
 * Phase 5.2 guard: the image-quality check reports what the server's image
 * preparation says of the metadata of the picture it prepared (Go checks the
 * prepared JPEG: apps/api/internal/evaluation/metadata_test.go). A
 * preparation that kept metadata is flagged, here with a pipeline that says
 * so. No network, no real data.
 */
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import type { GoPipeline } from '../../../scripts/ai-eval/go-pipeline'
import { imageQuality } from '../../../scripts/ai-eval/real-data/real-vision'

const preparing = (picture: unknown) => ({ run: async () => ({ outcome: null, setup: { picture, schema: { name: 'g', schema: {} } } }) }) as unknown as GoPipeline

describe('image quality metadata guard', () => {
  it("flags a preparation that keeps metadata, and one that failed", async () => {
    const img = new Uint8Array(await sharp({ create: { width: 32, height: 32, channels: 3, background: '#808080' } }).png().toBuffer())
    expect(await imageQuality('c1', img, preparing({ mimeType: 'image/jpeg', width: 32, height: 32, metadata: true }))).toMatchObject({ preparedOk: true, preparedHasMetadata: true, hadExif: false })
    expect(await imageQuality('c1', img, preparing({ mimeType: 'image/jpeg', width: 32, height: 32, metadata: false }))).toMatchObject({ preparedOk: true, preparedHasMetadata: false })
    expect(await imageQuality('c1', img, preparing(null))).toMatchObject({ preparedOk: false, preparedHasMetadata: false })
  })
})
