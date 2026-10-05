import crypto from 'crypto'
import { describe, expect, it } from 'vitest'
import { decryptSuccessor, encryptSuccessor, successorAad } from '@/server/session/successor-crypto'

const k = () => crypto.randomBytes(32)

describe('successor token encryption', () => {
  const token = 'tok_' + crypto.randomBytes(32).toString('base64url')
  const aad = successorAad('sessA', 'sessB')

  it('round-trips and never contains the plaintext', () => {
    const keys = { active: k(), decryptOnly: [] }
    const enc = encryptSuccessor(token, aad, keys)
    expect(enc).toMatch(/^v1\.[0-9a-f]{8}\.[\w-]+\.[\w-]+\.[\w-]+$/)
    expect(enc).not.toContain(token)
    expect(decryptSuccessor(enc, aad, keys)).toBe(token)
    expect(encryptSuccessor(token, aad, keys)).not.toBe(enc) // random IV
  })

  it('is bound to its two rows (AAD) and detects tampering', () => {
    const keys = { active: k(), decryptOnly: [] }
    const enc = encryptSuccessor(token, aad, keys)
    expect(decryptSuccessor(enc, successorAad('sessA', 'sessC'), keys)).toBeNull()
    expect(decryptSuccessor(enc, successorAad('sessX', 'sessB'), keys)).toBeNull()
    const parts = enc.split('.')
    parts[3] = Buffer.from('x' + Buffer.from(parts[3], 'base64url').toString('latin1').slice(1), 'latin1').toString('base64url')
    expect(decryptSuccessor(parts.join('.'), aad, keys)).toBeNull()
    expect(decryptSuccessor('garbage', aad, keys)).toBeNull()
    expect(decryptSuccessor('v2.' + enc.slice(3), aad, keys)).toBeNull()
  })

  it('staged rotation: decrypt-only keys decrypt, unknown keys fail closed', () => {
    const k1 = k()
    const k2 = k()
    const byK1 = encryptSuccessor(token, aad, { active: k1, decryptOnly: [] })
    expect(decryptSuccessor(byK1, aad, { active: k2, decryptOnly: [k1] })).toBe(token)
    expect(decryptSuccessor(byK1, aad, { active: k2, decryptOnly: [] })).toBeNull()
  })
})
