import { expect, test } from './fixtures'
import { CONSENT, PASSWORD, resetTokensFor, signUpMobile, signUpWeb, storedFilesOf, uniqueUser, upload } from './helpers'

/** Accounts and sessions: what the phone does, and what a web page does with cookies. */
test.describe('accounts', () => {
  test('mobile: sign up, who am I, refresh with rotation, sign out', async ({ api }) => {
    const s = await signUpMobile(api)
    const me = await api.get('/api/v1/auth/me', { bearer: s.accessToken })
    expect(me.status).toBe(200)
    expect((me.body.user as { email: string }).email).toBe(s.user.email)

    const refreshed = await api.post('/api/v1/auth/refresh', { mobile: true, data: { refreshToken: s.refreshToken } })
    expect(refreshed.status).toBe(200)
    const next = refreshed.body as { accessToken: string; refreshToken: string }
    expect(next.refreshToken).not.toBe(s.refreshToken)
    expect((await api.get('/api/v1/auth/me', { bearer: next.accessToken })).status).toBe(200)

    expect((await api.post('/api/v1/auth/logout', { bearer: next.accessToken, data: { refreshToken: next.refreshToken } })).status).toBe(200)
    const after = await api.get('/api/v1/auth/me', { bearer: next.accessToken })
    expect(after.status).toBe(401)
    expect((await api.post('/api/v1/auth/refresh', { mobile: true, data: { refreshToken: next.refreshToken } })).status).toBe(401)
  })

  test('mobile: sign in with the right password only; one account per address', async ({ api }) => {
    const s = await signUpMobile(api)
    const wrong = await api.post('/api/v1/auth/login', { mobile: true, data: { email: s.user.email, password: 'not-the-password-1' } })
    expect(wrong.status).toBe(401)
    expect(wrong.body.code).toBe('UNAUTHORIZED')
    const right = await api.post('/api/v1/auth/login', { mobile: true, data: { email: s.user.email, password: PASSWORD, deviceName: 'API e2e' } })
    expect(right.status).toBe(200)
    expect(typeof right.body.accessToken).toBe('string')
    const again = await api.post('/api/v1/auth/register', { mobile: true, data: { ...s.user, ...CONSENT } })
    expect(again.status).toBe(409)
    expect(again.body.code).toBe('CONFLICT')
  })

  test('web: the session lives in cookies; a write from another site is refused', async ({ api }) => {
    await signUpWeb(api)
    const cookies = await api.request.storageState()
    expect(cookies.cookies.map((c) => c.name).sort()).toEqual(['atlas_at', 'atlas_rt'])
    expect(cookies.cookies.every((c) => c.httpOnly)).toBe(true)
    expect((await api.get('/api/v1/auth/me')).status).toBe(200)

    const foreign = await api.patch('/api/v1/profile', { headers: { Origin: 'https://evil.example' }, data: { name: 'Hijacked' } })
    expect(foreign.status).toBe(403)
    expect(foreign.body.code).toBe('FORBIDDEN')

    expect((await api.post('/api/v1/auth/logout')).status).toBe(200)
    expect((await api.get('/api/v1/auth/me')).status).toBe(401)
  })

  test('legal texts, consent and the profile', async ({ api }) => {
    const s = await signUpMobile(api)
    const legal = await api.get('/api/v1/legal')
    expect(legal.status).toBe(200)
    expect(legal.body.version).toBe(CONSENT.acceptedLegalVersion)
    expect((await api.post('/api/v1/legal/consent', { bearer: s.accessToken, data: CONSENT })).status).toBe(200)

    const changed = await api.patch('/api/v1/profile', { bearer: s.accessToken, data: { name: 'Aziza', preferences: { preferredStyles: ['casual'], favoriteColors: ['navy'] } } })
    expect(changed.status).toBe(200)
    const profile = await api.get('/api/v1/profile', { bearer: s.accessToken })
    expect(profile.status).toBe(200)
    expect(profile.body.preferences).toMatchObject({ preferredStyles: ['casual'], favoriteColors: ['navy'] })
    const bad = await api.patch('/api/v1/profile', { bearer: s.accessToken, data: { preferences: { preferredStyles: ['not-a-style'] } } })
    expect(bad.status).toBe(400)
    expect(bad.body.code).toBe('VALIDATION_ERROR')
  })

  test('password reset: the e-mailed token sets a new password once and signs every session out', async ({ api }) => {
    const s = await signUpMobile(api, 'reset')
    expect((await api.post('/api/v1/auth/password/forgot', { data: { email: s.user.email } })).status).toBe(200)
    // The worker writes the mail.
    await expect.poll(() => resetTokensFor(s.user.email).length, { timeout: 15_000 }).toBe(1)
    const [token] = resetTokensFor(s.user.email)

    const NEW = 'api-e2e-New-Passw0rd!'
    expect((await api.post('/api/v1/auth/password/reset', { data: { token, password: NEW } })).status).toBe(200)
    expect((await api.get('/api/v1/auth/me', { bearer: s.accessToken })).status).toBe(401)
    const spent = await api.post('/api/v1/auth/password/reset', { data: { token, password: 'api-e2e-Other-Passw0rd!' } })
    expect(spent.status).toBe(400)
    expect(spent.body.code).toBe('RESET_TOKEN_INVALID')
    expect((await api.post('/api/v1/auth/login', { mobile: true, data: { email: s.user.email, password: PASSWORD } })).status).toBe(401)
    expect((await api.post('/api/v1/auth/login', { mobile: true, data: { email: s.user.email, password: NEW } })).status).toBe(200)

    // An unknown address: the same answer, no mail.
    const nobody = uniqueUser('nobody').email
    expect((await api.post('/api/v1/auth/password/forgot', { data: { email: nobody } })).status).toBe(200)
  })

  test('account deletion: the session ends at once and the pictures go', async ({ api }) => {
    const s = await signUpMobile(api, 'gone')
    await upload(api, s, 'shirt')
    expect(storedFilesOf(s.userId).length).toBeGreaterThan(0)
    expect((await api.delete('/api/v1/account', { bearer: s.accessToken })).status).toBe(200)
    expect((await api.get('/api/v1/auth/me', { bearer: s.accessToken })).status).toBe(401)
    expect((await api.post('/api/v1/auth/login', { mobile: true, data: { email: s.user.email, password: PASSWORD } })).status).toBe(401)
    // The worker removes the files.
    await expect.poll(() => storedFilesOf(s.userId).length, { timeout: 20_000 }).toBe(0)
  })
})
