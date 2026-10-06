/**
 * Vision input rules shared by every adapter, plus the one place that turns
 * an uploaded image into what may leave the server: decoded, rotated upright,
 * re-encoded as JPEG without EXIF/GPS metadata, longest side ≤ maxSide.
 */
import sharp from 'sharp'
import { AiProviderError } from './errors'
import type { VisionImageMimeType, VisionRequest } from './types'

/** Largest image side any adapter accepts. */
export const MAX_VISION_SIDE = 2048
/** Largest prepared image sent inline (base64 grows it by a third). */
export const MAX_VISION_BYTES = 4 * 1024 * 1024
const MIME_TYPES: ReadonlySet<string> = new Set<VisionImageMimeType>(['image/jpeg', 'image/png', 'image/webp'])
/** Same decompression-bomb guard as the storage layer. */
const MAX_INPUT_PIXELS = 40_000_000

/** Rejects requests the adapters must never send (programming errors, not provider failures). */
export function assertVisionRequest(provider: string, req: VisionRequest): void {
  const problem =
    !MIME_TYPES.has(req.mimeType) ? 'unsupported image type'
    : req.image.byteLength === 0 ? 'empty image'
    : req.image.byteLength > MAX_VISION_BYTES ? 'image too large'
    : !Number.isInteger(req.maxSide) || req.maxSide < 1 || req.maxSide > MAX_VISION_SIDE ? 'maxSide out of range'
    : !req.instruction.trim() ? 'missing instruction'
    : null
  if (problem) throw new AiProviderError('invalid_request', provider, { detail: problem })
}

export interface PreparedVisionImage {
  image: Uint8Array
  mimeType: 'image/jpeg'
  maxSide: number
}

/** Decodes, rotates, strips metadata and downsizes an image for a provider. */
export async function prepareVisionImage(input: Uint8Array, maxSide: number): Promise<PreparedVisionImage> {
  if (!Number.isInteger(maxSide) || maxSide < 1 || maxSide > MAX_VISION_SIDE) {
    throw new RangeError(`maxSide must be an integer in 1..${MAX_VISION_SIDE}`)
  }
  const image = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer()
  return { image: new Uint8Array(image), mimeType: 'image/jpeg', maxSide }
}

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')
}
