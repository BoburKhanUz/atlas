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
import { getMediaSigningSecret, getMediaUrlTtlSeconds } from '@/lib/config'
import { isValidStorageKey } from '@/lib/storage/provider'

const MEDIA_PATH_PREFIX = '/api/v1/media/'

function hmac(key: string, exp: number): string {
  return crypto
    .createHmac('sha256', getMediaSigningSecret())
    .update(`${key}\n${exp}`)
    .digest('base64url')
}

/** Build a signed URL for a storage key. `now` is injectable for tests. */
export function signMediaUrl(key: string, now: number = Date.now()): string {
  const exp = Math.floor(now / 1000) + getMediaUrlTtlSeconds()
  return `${MEDIA_PATH_PREFIX}${key}?exp=${exp}&sig=${hmac(key, exp)}`
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

/** Shape the frontend expects for an image (field names unchanged from the MVP). */
export interface PresentedImage {
  id: string
  url: string
  thumbnailUrl: string | null
  isPrimary: boolean
  width: number | null
  height: number | null
}

export function presentImage(img: {
  id: string
  storageKey: string
  thumbnailKey: string | null
  isPrimary: boolean
  width?: number | null
  height?: number | null
}): PresentedImage {
  return {
    id: img.id,
    url: signMediaUrl(img.storageKey),
    thumbnailUrl: img.thumbnailKey ? signMediaUrl(img.thumbnailKey) : null,
    isPrimary: img.isPrimary,
    width: img.width ?? null,
    height: img.height ?? null,
  }
}

/** Primary image (or first) of an item, presented. */
export function presentPrimaryImage(
  images: Parameters<typeof presentImage>[0][],
): PresentedImage | null {
  const primary = images.find((i) => i.isPrimary) ?? images[0]
  return primary ? presentImage(primary) : null
}
