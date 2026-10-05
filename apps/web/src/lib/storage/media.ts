/**
 * Signed, expiring media URLs for private images.
 *
 * Browsers load images with plain <img src>, which cannot carry the bearer
 * token, so API responses hand out short-lived HMAC-signed URLs instead:
 *
 *   /api/v1/media/<storage key>?exp=<unix seconds>&sig=<base64url HMAC>
 *
 * Anyone holding the URL can fetch the image until `exp` — the same model as
 * an S3/R2 presigned URL, which this maps onto when that driver is added.
 */

import crypto from 'crypto'
import { getMediaSigningSecret, getMediaUrlTtlSeconds, getPublicBaseUrl } from '@/lib/config'
import { isValidStorageKey } from '@/lib/storage/provider'

const MEDIA_PATH_PREFIX = '/api/v1/media/'

function hmac(key: string, exp: number): string {
  return crypto
    .createHmac('sha256', getMediaSigningSecret())
    .update(`${key}\n${exp}`)
    .digest('base64url')
}

/**
 * Build a signed URL for a storage key. Absolute (PUBLIC_BASE_URL + path)
 * when PUBLIC_BASE_URL is set, otherwise relative. `now` is injectable for tests.
 */
export function signMedia(key: string, now: number = Date.now()): { url: string; expiresAt: Date } {
  const exp = Math.floor(now / 1000) + getMediaUrlTtlSeconds()
  const path = `${MEDIA_PATH_PREFIX}${key}?exp=${exp}&sig=${hmac(key, exp)}`
  return { url: `${getPublicBaseUrl() ?? ''}${path}`, expiresAt: new Date(exp * 1000) }
}

export function signMediaUrl(key: string, now: number = Date.now()): string {
  return signMedia(key, now).url
}

/** Constant-time signature + expiry check. */
export function verifyMediaSignature(
  key: string,
  exp: string | null,
  sig: string | null,
  now: number = Date.now(),
): boolean {
  if (!exp || !sig || !isValidStorageKey(key)) return false
  if (!/^\d{1,12}$/.test(exp)) return false
  const expNum = Number(exp)
  if (expNum < Math.floor(now / 1000)) return false
  const expected = Buffer.from(hmac(key, expNum))
  const given = Buffer.from(sig)
  return expected.length === given.length && crypto.timingSafeEqual(expected, given)
}

/**
 * Shape the clients get for an image (MVP field names kept). `url` is the
 * 1600 px display variant — the master is never handed out, except for
 * images uploaded before display variants existed (until the backfill ran).
 * Clients cache by `id` + variant; URLs change on every response.
 */
export interface PresentedImage {
  id: string
  url: string
  thumbnailUrl: string | null
  /** When `url` and `thumbnailUrl` stop working (ISO 8601). */
  urlExpiresAt: string
  isPrimary: boolean
  /** Dimensions of the original image. */
  width: number | null
  height: number | null
}

export interface ImageRecord {
  id: string
  storageKey: string
  displayKey?: string | null
  thumbnailKey: string | null
  isPrimary: boolean
  width?: number | null
  height?: number | null
}

export function presentImage(img: ImageRecord): PresentedImage {
  const main = signMedia(img.displayKey ?? img.storageKey)
  return {
    id: img.id,
    url: main.url,
    thumbnailUrl: img.thumbnailKey ? signMedia(img.thumbnailKey).url : null,
    urlExpiresAt: main.expiresAt.toISOString(),
    isPrimary: img.isPrimary,
    width: img.width ?? null,
    height: img.height ?? null,
  }
}

/** Primary image (or first) of an item, presented. */
export function presentPrimaryImage(images: ImageRecord[]): PresentedImage | null {
  const primary = images.find((i) => i.isPrimary) ?? images[0]
  return primary ? presentImage(primary) : null
}
