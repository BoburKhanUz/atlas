import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from './fixtures'
import { PASSWORD, registerViaApi, uniqueUser } from './helpers'

const OUTBOX = process.env.E2E_MAIL_OUTBOX_DIR!
const NEW_PASSWORD = 'e2e-New-Passw0rd!'
const MOBILE = { 'X-Atlas-Client': 'mobile' }

/** Reset links e-mailed to `to`, oldest first (the Go worker writes them in the background). */
function linksFor(to: string): string[] {
  return readdirSync(OUTBOX)
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(OUTBOX, f), 'utf8')) as { to: string; text: string })
    .filter((m) => m.to === to)
    .map((m) => {
      const url = new URL(m.text.match(/https?:\/\/\S+/)![0])
      return `${url.pathname}${url.search}`
    })
}

test.describe('the page an e-mailed reset link opens', () => {
  test('the phone asks for a link; the page sets the new password once: every session signed out, the new password works', async ({ page, request }) => {
    const user = await registerViaApi(request, uniqueUser('reset')) // signed in on the phone
    expect((await request.post('/api/v1/auth/password/forgot', { data: { email: user.email } })).status()).toBe(200)

    await expect.poll(() => linksFor(user.email).length, { timeout: 15_000 }).toBe(1)
    const link = linksFor(user.email)[0]
    expect(link).toMatch(/^\/reset-password\?token=[A-Za-z0-9_-]{43}$/)

    await page.goto(link)
    await page.getByLabel('Yangi parol').fill(NEW_PASSWORD)
    await page.getByLabel('Parolni takrorlang').fill(NEW_PASSWORD)
    await page.getByRole('button', { name: 'Parolni saqlash' }).click()
    await expect(page.getByRole('heading', { name: 'Parol o‘zgartirildi' })).toBeVisible()
    await expect(page.getByRole('main').getByRole('status')).toContainText('Lookly ilovasida')
    expect(new URL(page.url()).search).toBe('') // the spent token left the address bar

    // the phone is signed out; the old password no longer works, the new one does
    const refreshed = await request.post('/api/v1/auth/refresh', { headers: MOBILE, data: { refreshToken: user.refreshToken } })
    expect(refreshed.status()).toBe(401)
    expect((await request.post('/api/v1/auth/login', { headers: MOBILE, data: { email: user.email, password: PASSWORD } })).status()).toBe(401)
    expect((await request.post('/api/v1/auth/login', { headers: MOBILE, data: { email: user.email, password: NEW_PASSWORD } })).status()).toBe(200)

    // the link works once
    await page.goto(link)
    await page.getByLabel('Yangi parol').fill('e2e-Third-Passw0rd!')
    await page.getByLabel('Parolni takrorlang').fill('e2e-Third-Passw0rd!')
    await page.getByRole('button', { name: 'Parolni saqlash' }).click()
    await expect(page.getByRole('main').getByRole('alert')).toContainText('Havola yaroqsiz')
    await expect(page.getByRole('link', { name: 'Bosh sahifaga' })).toHaveAttribute('href', '/')
  })

  test('a link without a token is refused', async ({ page }) => {
    await page.goto('/reset-password')
    await expect(page.getByRole('main').getByRole('alert')).toContainText('Havola yaroqsiz')
  })

  test('mismatched passwords are caught before any request', async ({ page }) => {
    await page.goto('/reset-password?token=not-a-real-token')
    await page.getByLabel('Yangi parol').fill(NEW_PASSWORD)
    await page.getByLabel('Parolni takrorlang').fill(`${NEW_PASSWORD}x`)
    await page.getByRole('button', { name: 'Parolni saqlash' }).click()
    await expect(page.getByRole('main').getByRole('alert')).toHaveText('Parollar bir xil emas.')
  })
})
