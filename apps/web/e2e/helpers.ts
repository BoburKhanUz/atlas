import { expect, type APIRequestContext } from '@playwright/test'
import { LEGAL_VERSION } from '../src/lib/legal/version'

export const PASSWORD = 'e2e-Passw0rd!'
/** Consent to the current legal documents, required by registration. */
export const CONSENT = { acceptedLegalVersion: LEGAL_VERSION, ageConfirmed: true }

let seq = 0
export function uniqueUser(label = 'u') {
  seq += 1
  const id = `${Date.now().toString(36)}${process.pid}${seq}${Math.random().toString(36).slice(2, 6)}`
  return { name: `E2E ${label}`, email: `e2e-${label}-${id}@example.test`, password: PASSWORD }
}

/** Register through the Go API as the phone app does (X-Atlas-Client: mobile); returns the user and its tokens. */
export async function registerViaApi(request: APIRequestContext, user = uniqueUser()) {
  const res = await request.post('/api/v1/auth/register', { headers: { 'X-Atlas-Client': 'mobile' }, data: { ...user, ...CONSENT } })
  expect(res.status(), 'register').toBe(201)
  const body = (await res.json()) as { refreshToken: string }
  return { ...user, refreshToken: body.refreshToken }
}
