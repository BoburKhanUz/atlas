import { describe, expect, it } from 'vitest'
import { contractViolation } from '../../api-e2e/contract'

/** The API journey suite's contract check (api-e2e/contract.ts) finds what is wrong. */
describe('contractViolation', () => {
  const me = { consentRequired: false, user: { id: 'u1', email: 'a@example.test', name: 'A', createdAt: '2026-11-28T10:00:00.000Z' } }
  const err = (code: string) => ({ error: 'x', code, requestId: 'r1' })

  it('a documented answer with the right body passes', () => {
    expect(contractViolation('GET', '/api/v1/legal', 404, 'application/json', err('NOT_FOUND'))).toMatch(/not a documented answer/)
    expect(contractViolation('GET', '/api/v1/auth/me', 401, 'application/json', err('UNAUTHORIZED'))).toBeNull()
    expect(contractViolation('GET', '/api/v1/auth/me', 200, 'application/json', me)).toBeNull()
  })

  it('an operation the contract does not have', () => {
    expect(contractViolation('GET', '/api/v1/nothing', 200, 'application/json', {})).toMatch(/not an operation/)
    expect(contractViolation('PUT', '/api/v1/auth/me', 200, 'application/json', {})).toMatch(/not an operation/)
  })

  it('a status the operation does not document', () => {
    expect(contractViolation('GET', '/api/v1/auth/me', 418, 'application/json', err('INTERNAL'))).toMatch(/418 is not a documented answer/)
  })

  it('an error code the status does not list', () => {
    expect(contractViolation('GET', '/api/v1/auth/me', 401, 'application/json', err('NOT_FOUND'))).toMatch(/error code NOT_FOUND is not listed/)
  })

  it('a body that does not match the schema, or is not JSON', () => {
    expect(contractViolation('GET', '/api/v1/auth/me', 401, 'application/json', { error: 'x' })).toMatch(/must have required property/)
    expect(contractViolation('GET', '/api/v1/auth/me', 200, 'application/json', { ...me, extra: 1 })).toMatch(/additional properties/)
    expect(contractViolation('GET', '/api/v1/auth/me', 401, 'text/plain', undefined)).toMatch(/not JSON/)
    expect(contractViolation('GET', '/api/v1/auth/me', 200, 'application/json', { ...me, user: { ...me.user, createdAt: 'yesterday' } })).toMatch(/format/)
  })

  it('path parameters match one segment, a media key any', () => {
    expect(contractViolation('GET', '/api/v1/outfits/abc', 404, 'application/json', err('NOT_FOUND'))).toBeNull()
    expect(contractViolation('GET', '/api/v1/outfits/abc/def', 404, 'application/json', err('NOT_FOUND'))).toMatch(/not an operation/)
    expect(contractViolation('GET', '/api/v1/media/users/u1/a.webp', 404, 'application/json', err('NOT_FOUND'))).toBeNull()
  })
})
