/** KEY-01: SESSION_ENC_KEY validation (the server refuses to start on a bad key). */
import crypto from 'crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { ConfigError, assertServerConfig, getSessionEncKeys } from '@/lib/config'

const env = process.env as Record<string, string | undefined>
const saved = { key: env.SESSION_ENC_KEY, dec: env.SESSION_ENC_DECRYPT_KEYS, jwt: env.JWT_SECRET }
afterEach(() => {
  env.SESSION_ENC_KEY = saved.key
  env.JWT_SECRET = saved.jwt
  if (saved.dec === undefined) delete env.SESSION_ENC_DECRYPT_KEYS
  else env.SESSION_ENC_DECRYPT_KEYS = saved.dec
})

const b64 = (n: number) => crypto.randomBytes(n).toString('base64')

describe('SESSION_ENC_KEY', () => {
  it('accepts 32 random bytes in base64 and up to two decrypt-only keys', () => {
    env.SESSION_ENC_KEY = b64(32)
    env.SESSION_ENC_DECRYPT_KEYS = `${b64(32)}, ${b64(32)}`
    const keys = getSessionEncKeys()
    expect(keys.active).toHaveLength(32)
    expect(keys.decryptOnly).toHaveLength(2)
    expect(() => assertServerConfig()).not.toThrow()
  })

  it('refuses missing, wrong-length, non-base64 and reused keys', () => {
    const bad: Array<[string | undefined, string | undefined]> = [
      [undefined, undefined],
      ['', undefined],
      [b64(16), undefined],
      [b64(48), undefined],
      ['not base64 at all!', undefined],
      [b64(32), `${b64(32)},${b64(32)},${b64(32)}`],
      [b64(32), b64(31)],
    ]
    for (const [key, dec] of bad) {
      if (key === undefined) delete env.SESSION_ENC_KEY
      else env.SESSION_ENC_KEY = key
      if (dec === undefined) delete env.SESSION_ENC_DECRYPT_KEYS
      else env.SESSION_ENC_DECRYPT_KEYS = dec
      expect(() => getSessionEncKeys(), `key=${key} dec=${dec}`).toThrow(ConfigError)
      expect(() => assertServerConfig()).toThrow(ConfigError)
    }
    // equal to another secret
    const shared = b64(32)
    env.SESSION_ENC_KEY = shared
    delete env.SESSION_ENC_DECRYPT_KEYS
    env.JWT_SECRET = shared
    expect(() => getSessionEncKeys()).toThrow(/independent of JWT_SECRET/)
  })
})
