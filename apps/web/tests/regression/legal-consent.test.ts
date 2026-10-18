/**
 * Registration records consent to the current legal documents (privacy policy
 * and terms of use) together with the 18+ confirmation, in the same
 * transaction as the account; GET /api/v1/legal serves the documents.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const tx = vi.hoisted(() => ({
  user: { create: vi.fn() },
  userProfile: { create: vi.fn() },
  userPreferences: { create: vi.fn() },
  legalConsent: { create: vi.fn() },
}))
const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  legalConsent: { findFirst: vi.fn(), create: vi.fn() },
  $transaction: vi.fn(),
}))
vi.mock('@/lib/db', () => ({ db }))
vi.mock('@/lib/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/session')>()),
  createSession: vi.fn(async () => ({
    accessToken: 'access',
    refreshToken: 'refresh',
    accessTokenExpiresAt: new Date(0),
    refreshTokenExpiresAt: new Date(0),
    sessionExpiresAt: new Date(0),
  })),
}))

import { POST as register } from '@/app/api/v1/auth/register/route'
import { GET as legal } from '@/app/api/v1/legal/route'
import { POST as acceptLegal } from '@/app/api/v1/legal/consent/route'
import { LEGAL_DOCUMENTS } from '@/lib/legal/documents'
import { LEGAL_DRAFT, LEGAL_EFFECTIVE_DATE, LEGAL_VERSION } from '@/lib/legal/version'
import { resetRateLimits } from '@/lib/rate-limit'
import { LegalResponse } from '@/server/schemas/responses'
import { authHeader, jsonRequest, TEST_USER } from '../helpers'

const MOBILE = { 'x-atlas-client': 'mobile' }
const body = (extra: Record<string, unknown> = {}) => ({
  email: 'new@example.com',
  password: 'password123',
  acceptedLegalVersion: LEGAL_VERSION,
  ageConfirmed: true,
  ...extra,
})

beforeEach(() => {
  vi.clearAllMocks()
  resetRateLimits()
  db.user.findUnique.mockResolvedValue(null)
  db.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx))
  tx.user.create.mockResolvedValue({ id: 'u1', email: 'new@example.com', name: null })
})

describe('GET /api/v1/legal', () => {
  it('serves both documents with the current version, without a session', async () => {
    const res = await legal(new NextRequest('http://localhost/api/v1/legal'), undefined)
    expect(res.status).toBe(200)
    const json = LegalResponse.parse(await res.json())
    expect(json).toMatchObject({ version: LEGAL_VERSION, effectiveDate: LEGAL_EFFECTIVE_DATE, draft: LEGAL_DRAFT })
    expect(json.documents.map((d) => d.id)).toEqual(['privacy', 'terms'])
  })
})

describe('registration consent', () => {
  it('stores the accepted version and the 18+ confirmation with the new account', async () => {
    const res = await register(jsonRequest('/api/v1/auth/register', body(), MOBILE))
    expect(res.status).toBe(201)
    expect(tx.legalConsent.create).toHaveBeenCalledWith({ data: { userId: 'u1', version: LEGAL_VERSION, ageConfirmed: true } })
  })

  it.each([
    ['no consent fields (an older client)', { acceptedLegalVersion: undefined, ageConfirmed: undefined }, 'acceptedLegalVersion', /rozilik bering/],
    ['18+ not confirmed', { ageConfirmed: false }, 'ageConfirmed', /18 yosh/],
    ['an outdated document version', { acceptedLegalVersion: '2020-01-01' }, 'acceptedLegalVersion', /yangilangan/],
    ['an over-long version string', { acceptedLegalVersion: 'x'.repeat(41) }, 'acceptedLegalVersion', /yangilangan/],
  ])('%s → 400 VALIDATION_ERROR in Uzbek, no account created', async (_name, extra, path, message) => {
    const res = await register(jsonRequest('/api/v1/auth/register', body(extra), MOBILE))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.code).toBe('VALIDATION_ERROR')
    expect(json.error).toMatch(message)
    expect(json.details[0].path).toBe(path)
    expect(db.$transaction).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/legal/consent (accepting changed texts)', () => {
  const accept = async (json: unknown) => acceptLegal(jsonRequest('/api/v1/legal/consent', json, await authHeader()))

  it('records the current version and the 18+ confirmation once', async () => {
    db.user.findUnique.mockResolvedValue({ id: TEST_USER.sub })
    db.legalConsent.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'lc1' })
    expect((await accept({ acceptedLegalVersion: LEGAL_VERSION, ageConfirmed: true })).status).toBe(200)
    expect((await accept({ acceptedLegalVersion: LEGAL_VERSION, ageConfirmed: true })).status).toBe(200)
    expect(db.legalConsent.create).toHaveBeenCalledTimes(1)
    expect(db.legalConsent.create).toHaveBeenCalledWith({ data: { userId: TEST_USER.sub, version: LEGAL_VERSION, ageConfirmed: true } })
  })

  it.each([
    ['nothing accepted', {}, /Davom etish uchun/],
    ['an outdated version', { acceptedLegalVersion: '2020-01-01.1', ageConfirmed: true }, /yangilangan/],
    ['18+ not confirmed', { acceptedLegalVersion: LEGAL_VERSION, ageConfirmed: false }, /18 yosh/],
  ])('%s → 400 VALIDATION_ERROR in Uzbek, nothing recorded', async (_name, json, message) => {
    const res = await accept(json)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect([body.code, body.error]).toEqual(['VALIDATION_ERROR', expect.stringMatching(message)])
    expect(db.legalConsent.create).not.toHaveBeenCalled()
  })

  it('a deleted account (token still valid) is signed out, not recorded', async () => {
    db.user.findUnique.mockResolvedValue(null)
    const res = await accept({ acceptedLegalVersion: LEGAL_VERSION, ageConfirmed: true })
    expect([res.status, (await res.json()).code]).toEqual([401, 'UNAUTHORIZED'])
    expect(db.legalConsent.create).not.toHaveBeenCalled()
  })
})

describe('legal documents', () => {
  it('every section has a heading and non-empty paragraphs', () => {
    for (const doc of LEGAL_DOCUMENTS) {
      expect(doc.sections.length).toBeGreaterThan(0)
      for (const s of doc.sections) {
        expect(s.heading.trim()).not.toBe('')
        expect(s.paragraphs.length).toBeGreaterThan(0)
        for (const p of s.paragraphs) expect(p.trim()).not.toBe('')
      }
    }
  })

  it('the version starts with the effective date and is marked while the texts are a draft', () => {
    expect(LEGAL_VERSION.startsWith(LEGAL_EFFECTIVE_DATE)).toBe(true)
    expect(LEGAL_VERSION.endsWith('-draft')).toBe(LEGAL_DRAFT)
  })

  it('final (non-draft) texts keep no [placeholder] for counsel to fill', () => {
    const placeholders = JSON.stringify(LEGAL_DOCUMENTS).match(/\[[^\]]+\]/g) ?? []
    if (LEGAL_DRAFT) expect(placeholders.length).toBeGreaterThan(0)
    else expect(placeholders).toEqual([])
  })

  it('both documents state the 18+ rule', () => {
    for (const doc of LEGAL_DOCUMENTS) expect(JSON.stringify(doc)).toMatch(/18 yosh/)
  })
})
