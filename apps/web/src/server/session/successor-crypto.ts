/**
 * Encryption of the successor refresh token stored on a rotated session
 * (`Session.successorTokenEnc`), so a grace replay can return the SAME
 * successor token without the plaintext ever being stored.
 *
 * AES-256-GCM, 96-bit random IV. The additional authenticated data binds the
 * value to its two rows (`<rotatedSessionId>|<successorSessionId>`): a value
 * copied onto another row fails to decrypt. Format:
 *   v1.<keyId>.<iv>.<ciphertext>.<tag>   (base64url parts; keyId = 8 hex chars of sha256(key))
 */
import crypto from 'crypto'
import type { SessionEncKeys } from '@/lib/config'

const VERSION = 'v1'

function keyId(key: Buffer): string {
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 8)
}

export function successorAad(rotatedSessionId: string, successorSessionId: string): string {
  return `${rotatedSessionId}|${successorSessionId}`
}

export function encryptSuccessor(token: string, aad: string, keys: SessionEncKeys): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', keys.active, iv)
  cipher.setAAD(Buffer.from(aad, 'utf8'))
  const ct = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [VERSION, keyId(keys.active), iv.toString('base64url'), ct.toString('base64url'), tag.toString('base64url')].join('.')
}

/** The plaintext, or null when the value is malformed, tampered, bound to other rows, or no key matches. */
export function decryptSuccessor(value: string, aad: string, keys: SessionEncKeys): string | null {
  const parts = value.split('.')
  if (parts.length !== 5 || parts[0] !== VERSION) return null
  const [, id, ivB64, ctB64, tagB64] = parts
  const candidates = [keys.active, ...keys.decryptOnly]
  const ordered = [...candidates.filter((k) => keyId(k) === id), ...candidates.filter((k) => keyId(k) !== id)]
  for (const key of ordered) {
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64url'))
      decipher.setAAD(Buffer.from(aad, 'utf8'))
      decipher.setAuthTag(Buffer.from(tagB64, 'base64url'))
      return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64url')), decipher.final()]).toString('utf8')
    } catch {
      // wrong key or tampered — try the next key
    }
  }
  return null
}
