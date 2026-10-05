/**
 * Object storage abstraction (spec section 24).
 *
 * Images are private. They are written to a directory OUTSIDE `public/`
 * (configurable via STORAGE_LOCAL_DIR) and only served through
 * `/api/v1/media/...` with an HMAC-signed, expiring URL — see `media.ts`.
 * The database stores storage *keys*, never public URLs, so a future
 * S3/R2 driver only needs to implement `StorageProvider`.
 *
 * We always generate a thumbnail (max 400×400, JPEG q=80) alongside the
 * original. Spec rule: "Never store large images directly in PostgreSQL."
 */

import sharp from 'sharp'
import { promises as fs } from 'fs'
import path from 'path'
import crypto from 'crypto'
import { getLocalStorageDir } from '@/lib/config'

export interface StoredImage {
  /** Storage key of the original, e.g. `users/<userId>/<uuid>.jpg`. */
  key: string
  /** Storage key of the 400×400 JPEG thumbnail. */
  thumbnailKey: string
  width: number
  height: number
}

export interface StorageProvider {
  /** Validate, normalise and store an image under `users/<ownerId>/`. */
  saveImage(buffer: Buffer, ownerId: string): Promise<StoredImage>
  /** Read an object by key. Returns null when it does not exist. */
  readObject(key: string): Promise<Buffer | null>
  /** Delete objects by key. Missing objects are ignored. */
  deleteObjects(keys: string[]): Promise<void>
  /** Delete every object stored for an owner (account deletion). */
  deleteOwner(ownerId: string): Promise<void>
}

/** Thrown when the uploaded bytes are not a supported, decodable image. */
export class InvalidImageError extends Error {}

/** Keys we generate: users/<id>/<uuid>[_thumb].<ext>. Anything else is rejected. */
const KEY_PATTERN = /^users\/[A-Za-z0-9_-]{1,64}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(_thumb)?\.(jpg|png|webp)$/
const OWNER_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

export function isValidStorageKey(key: string): boolean {
  return KEY_PATTERN.test(key)
}

export function contentTypeForKey(key: string): string {
  if (key.endsWith('.png')) return 'image/png'
  if (key.endsWith('.webp')) return 'image/webp'
  return 'image/jpeg'
}

/** Formats kept in their own format (by detected content, not by filename); re-encoded to strip metadata. */
const PASSTHROUGH_FORMATS: Record<string, 'jpg' | 'png' | 'webp'> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
}
/** Formats we accept but convert to JPEG for browser compatibility. */
const CONVERTED_FORMATS = new Set(['heif'])

const MAX_INPUT_PIXELS = 40_000_000 // ~40 MP — guards against decompression bombs

class LocalStorageProvider implements StorageProvider {
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    if (!isValidStorageKey(key)) throw new Error('Invalid storage key')
    const full = path.resolve(this.root, key)
    if (!full.startsWith(this.root + path.sep)) throw new Error('Invalid storage key')
    return full
  }

  async saveImage(buffer: Buffer, ownerId: string): Promise<StoredImage> {
    if (!OWNER_PATTERN.test(ownerId)) throw new Error('Invalid owner id')

    // Decode the actual bytes — never trust the filename or client MIME type.
    let metadata: sharp.Metadata
    try {
      metadata = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS }).metadata()
    } catch {
      throw new InvalidImageError('Not a decodable image')
    }
    const format = metadata.format ?? ''
    const passthroughExt = PASSTHROUGH_FORMATS[format]
    if (!passthroughExt && !CONVERTED_FORMATS.has(format)) {
      throw new InvalidImageError(`Unsupported image format: ${format || 'unknown'}`)
    }

    const id = crypto.randomUUID()
    const ext = passthroughExt ?? 'jpg'
    const key = `users/${ownerId}/${id}.${ext}`
    const thumbnailKey = `users/${ownerId}/${id}_thumb.jpg`

    await fs.mkdir(path.join(this.root, 'users', ownerId), { recursive: true })

    try {
      await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS })
        .rotate() // respect EXIF orientation
        .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toFile(this.resolve(thumbnailKey))

      // Re-encode every original: .rotate() applies EXIF orientation and
      // sharp drops metadata (EXIF/GPS, XMP) by default — never withMetadata().
      const original = sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS }).rotate()
      if (ext === 'png') await original.png().toFile(this.resolve(key))
      else if (ext === 'webp') await original.webp({ quality: 88 }).toFile(this.resolve(key))
      else await original.jpeg({ quality: 88 }).toFile(this.resolve(key))
    } catch (err) {
      await this.deleteObjects([key, thumbnailKey])
      if (err instanceof InvalidImageError) throw err
      throw new InvalidImageError('Image could not be processed')
    }

    return {
      key,
      thumbnailKey,
      width: metadata.width ?? 0,
      height: metadata.height ?? 0,
    }
  }

  async readObject(key: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(this.resolve(key))
    } catch {
      return null
    }
  }

  async deleteObjects(keys: string[]): Promise<void> {
    await Promise.all(
      keys.filter(isValidStorageKey).map((k) => fs.unlink(this.resolve(k)).catch(() => {})),
    )
  }

  async deleteOwner(ownerId: string): Promise<void> {
    if (!OWNER_PATTERN.test(ownerId)) throw new Error('Invalid owner id')
    await fs.rm(path.join(this.root, 'users', ownerId), { recursive: true, force: true })
  }
}

let _provider: StorageProvider | null = null

export function getStorageProvider(): StorageProvider {
  if (_provider) return _provider
  const driver = (process.env.STORAGE_DRIVER || 'local').toLowerCase()
  if (driver !== 'local') {
    // Future: 's3' (Cloudflare R2 / MinIO) — implement StorageProvider.
    throw new Error(`STORAGE_DRIVER="${driver}" is not implemented yet; use "local"`)
  }
  _provider = new LocalStorageProvider(getLocalStorageDir())
  return _provider
}

/** Allow tests to inject a fake provider. */
export function setStorageProviderForTesting(p: StorageProvider | null) {
  _provider = p
}

/**
 * Cheap pre-check on the upload envelope (size + declared type). The real
 * content check is the decode in `saveImage`.
 * Spec section 28: "image upload validation / maximum image size / MIME type"
 */
export function validateImageFile(file: { name: string; type: string; size: number }): string | null {
  const MAX_SIZE = 8 * 1024 * 1024
  const ALLOWED = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
  if (!ALLOWED.includes(file.type.toLowerCase())) {
    return 'Faqat JPG, PNG, WEBP yoki HEIC formatlari qo\'llab-quvvatlanadi'
  }
  if (file.size > MAX_SIZE) {
    return 'Rasm hajmi 8 MB dan oshmasligi kerak'
  }
  return null
}
