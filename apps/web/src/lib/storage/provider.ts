/**
 * Object storage abstraction (spec section 24).
 *
 * Images are private. They are written to a directory OUTSIDE `public/`
 * (configurable via STORAGE_LOCAL_DIR) and only served through
 * `/api/v1/media/...` with an HMAC-signed, expiring URL — see `media.ts`.
 * The database stores storage *keys*, never public URLs, so a future
 * S3/R2 driver only needs to implement `StorageProvider`.
 *
 * Every upload is stored as three variants under `users/<owner>/<uuid>`:
 *   master   `<uuid>.<jpg|png|webp>` full resolution, orientation applied,
 *            metadata (EXIF/GPS/XMP) stripped by re-encoding: JPEG q92, PNG
 *            and WebP lossless. Never served to clients — source for AI
 *            processing and future re-derivation.
 *   display  `<uuid>_display.webp`, longest side ≤ 1600 px, WebP q82 (API `url`)
 *   thumb    `<uuid>_thumb.webp`, longest side ≤ 400 px, WebP q75 (API `thumbnailUrl`)
 * Phase 2 thumbnails (`_thumb.jpg`) remain readable.
 * Spec rule: "Never store large images directly in PostgreSQL."
 */

import sharp, { type Metadata } from 'sharp'
import { promises as fs } from 'fs'
import path from 'path'
import crypto from 'crypto'
import { getLocalStorageDir } from '@/lib/config'

export interface StoredImage {
  /** Master key, e.g. `users/<userId>/<uuid>.jpg` (never served). */
  key: string
  /** 1600 px WebP display variant. */
  displayKey: string
  /** 400 px WebP thumbnail. */
  thumbnailKey: string
  /** Dimensions of the master after orientation. */
  width: number
  height: number
  /** Detected MIME type of the upload (= master format). */
  mimeType: string
  /** Size and SHA-256 (hex) of the uploaded bytes. */
  bytes: number
  sha256: string
}

export interface StorageProvider {
  /** Validate, normalise and store an image (all variants) under `users/<ownerId>/`. */
  saveImage(buffer: Buffer, ownerId: string): Promise<StoredImage>
  /** Read an object by key. Returns null when it does not exist. */
  readObject(key: string): Promise<Buffer | null>
  /** Write a derived variant for an existing master (display backfill). */
  writeObject(key: string, data: Buffer): Promise<void>
  /** Delete objects by key. Missing, empty and invalid keys are ignored. */
  deleteObjects(keys: (string | null | undefined)[]): Promise<void>
  /** Delete every object stored for an owner (account deletion). */
  deleteOwner(ownerId: string): Promise<void>
  /** Every stored key with its modification time (storage sweep). */
  listObjects(): Promise<{ key: string; modifiedAt: Date }[]>
}

/** Corrupt or undecodable bytes in an accepted format → 422 INVALID_IMAGE. */
export class InvalidImageError extends Error {}
/** HEIC/HEIF/AVIF and any other format we do not accept → 415 UNSUPPORTED_IMAGE_FORMAT. */
export class UnsupportedImageFormatError extends Error {}
/** Shortest side < 256 px or a side > 8000 px → 422 IMAGE_DIMENSIONS. */
export class ImageDimensionsError extends Error {}

export const IMAGE_MIN_SIDE = 256
export const IMAGE_MAX_SIDE = 8000
export const DISPLAY_MAX_SIDE = 1600
export const THUMB_MAX_SIDE = 400

/** Keys we generate: users/<id>/<uuid>[_thumb|_display].<ext>. Anything else is rejected. */
const KEY_PATTERN =
  /^users\/[A-Za-z0-9_-]{1,64}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(_thumb|_display)?\.(jpg|png|webp)$/
const OWNER_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

export function isValidStorageKey(key: string): boolean {
  return KEY_PATTERN.test(key)
}

export function contentTypeForKey(key: string): string {
  if (key.endsWith('.png')) return 'image/png'
  if (key.endsWith('.webp')) return 'image/webp'
  return 'image/jpeg'
}

/** The display key for a master key (same uuid). */
export function displayKeyFor(masterKey: string): string {
  return masterKey.replace(/\.(jpg|png|webp)$/, '_display.webp')
}

/** Accepted upload formats (by decoded content, never by filename) → master extension. */
const ACCEPTED_FORMATS: Record<string, { ext: 'jpg' | 'png' | 'webp'; mime: string }> = {
  jpeg: { ext: 'jpg', mime: 'image/jpeg' },
  png: { ext: 'png', mime: 'image/png' },
  webp: { ext: 'webp', mime: 'image/webp' },
}

/** ISO-BMFF brands of HEIC/HEIF/AVIF files (iPhone photos): rejected with 415, even if undecodable. */
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1', 'avif', 'avis'])

export function isHeifContainer(buffer: Buffer): boolean {
  return buffer.length >= 12 && buffer.toString('latin1', 4, 8) === 'ftyp' && HEIF_BRANDS.has(buffer.toString('latin1', 8, 12))
}

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
    if (isHeifContainer(buffer)) throw new UnsupportedImageFormatError('HEIC/HEIF/AVIF is not accepted; convert to JPEG')

    // Decode the actual bytes — never trust the filename or client MIME type.
    let metadata: Metadata
    try {
      metadata = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS }).metadata()
    } catch {
      throw new InvalidImageError('Not a decodable image')
    }
    const accepted = ACCEPTED_FORMATS[metadata.format ?? '']
    if (!accepted) throw new UnsupportedImageFormatError(`Unsupported image format: ${metadata.format || 'unknown'}`)

    // EXIF orientations 5–8 swap width and height.
    const swap = (metadata.orientation ?? 1) >= 5
    const width = (swap ? metadata.height : metadata.width) ?? 0
    const height = (swap ? metadata.width : metadata.height) ?? 0
    if (Math.min(width, height) < IMAGE_MIN_SIDE || Math.max(width, height) > IMAGE_MAX_SIDE) {
      throw new ImageDimensionsError(`Image is ${width}×${height}`)
    }

    const id = crypto.randomUUID()
    const base = `users/${ownerId}/${id}`
    const key = `${base}.${accepted.ext}`
    const displayKey = `${base}_display.webp`
    const thumbnailKey = `${base}_thumb.webp`

    await fs.mkdir(path.join(this.root, 'users', ownerId), { recursive: true })

    // .rotate() applies EXIF orientation; sharp drops metadata (EXIF/GPS, XMP,
    // ICC) by default — never call withMetadata().
    const source = () => sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS }).rotate()
    try {
      const master = source()
      if (accepted.ext === 'png') await master.png().toFile(this.resolve(key))
      else if (accepted.ext === 'webp') await master.webp({ lossless: true }).toFile(this.resolve(key))
      else await master.jpeg({ quality: 92 }).toFile(this.resolve(key))
      await source()
        .resize(DISPLAY_MAX_SIDE, DISPLAY_MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toFile(this.resolve(displayKey))
      await source()
        .resize(THUMB_MAX_SIDE, THUMB_MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 75 })
        .toFile(this.resolve(thumbnailKey))
    } catch {
      await this.deleteObjects([key, displayKey, thumbnailKey])
      throw new InvalidImageError('Image could not be processed')
    }

    return {
      key,
      displayKey,
      thumbnailKey,
      width,
      height,
      mimeType: accepted.mime,
      bytes: buffer.length,
      sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    }
  }

  async writeObject(key: string, data: Buffer): Promise<void> {
    const full = this.resolve(key)
    await fs.mkdir(path.dirname(full), { recursive: true })
    await fs.writeFile(full, data)
  }

  async listObjects(): Promise<{ key: string; modifiedAt: Date }[]> {
    const out: { key: string; modifiedAt: Date }[] = []
    const usersDir = path.join(this.root, 'users')
    const owners = await fs.readdir(usersDir).catch(() => [] as string[])
    for (const owner of owners) {
      const files = await fs.readdir(path.join(usersDir, owner)).catch(() => [] as string[])
      for (const file of files) {
        const key = `users/${owner}/${file}`
        const stat = await fs.stat(path.join(usersDir, owner, file)).catch(() => null)
        if (stat?.isFile()) out.push({ key, modifiedAt: stat.mtime })
      }
    }
    return out
  }

  async readObject(key: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(this.resolve(key))
    } catch {
      return null
    }
  }

  async deleteObjects(keys: (string | null | undefined)[]): Promise<void> {
    await Promise.all(
      keys
        .filter((k): k is string => !!k && isValidStorageKey(k))
        .map((k) => fs.unlink(this.resolve(k)).catch(() => {})),
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

/** Declared types we accept. HEIC/HEIF/AVIF must be converted by the client (mobile: JPEG ~2048 px, q≈85). */
const DECLARED_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp'])
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024

/**
 * Cheap pre-check on the upload envelope (declared type + size). The real
 * content check is the decode in `saveImage`.
 * Spec section 28: "image upload validation / maximum image size / MIME type"
 */
export function checkImageEnvelope(file: { type: string; size: number }): 'unsupported_type' | 'too_large' | null {
  if (!DECLARED_TYPES.has(file.type.toLowerCase())) return 'unsupported_type'
  if (file.size > MAX_IMAGE_BYTES) return 'too_large'
  return null
}
