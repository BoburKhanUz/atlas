import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from './fixtures'
import { PASSWORD, registerViaApi, uniqueUser } from './helpers'

const OUTBOX = process.env.E2E_MAIL_OUTBOX_DIR!
const NEW_PASSWORD = 'e2e-New-Passw0rd!'

/** Reset links e-mailed to `to`, oldest first (the server writes them in the background). */
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

test.describe('password reset', () => {
  test('forgot → e-mailed link → new password: every session signed out, the new password works, the link only once', async ({ page, request }) => {
    const user = uniqueUser('reset')
    await registerViaApi(request, user) // "another device", signed in

    await page.goto('/login')
    await page.getByRole('link', { name: 'Parolni unutdingizmi?' }).click()
    await expect(page).toHaveURL(/\/forgot-password$/)
    await page.getByLabel('Email').fill(user.email)
    await page.getByRole('button', { name: 'Havola yuborish' }).click()
    await expect(page.getByRole('main').getByRole('status')).toContainText('havolasi yuborildi')

    await expect.poll(() => linksFor(user.email).length).toBe(1)
    const link = linksFor(user.email)[0]
    expect(link).toMatch(/^\/reset-password\?token=[A-Za-z0-9_-]{43}$/)

    await page.goto(link)
    await page.getByLabel('Yangi parol').fill(NEW_PASSWORD)
    await page.getByLabel('Parolni takrorlang').fill(NEW_PASSWORD)
    await page.getByRole('button', { name: 'Parolni saqlash' }).click()
    await expect(page.getByRole('heading', { name: 'Parol o‘zgartirildi' })).toBeVisible()
    expect(new URL(page.url()).search).toBe('') // the spent token left the address bar

    // the other device is signed out; the old password no longer works
    const refreshed = await request.post('/api/v1/auth/refresh')
    expect(refreshed.status()).toBe(401)
    expect((await refreshed.json()).code).toBe('SESSION_REVOKED')
    expect((await request.post('/api/v1/auth/login', { data: { email: user.email, password: PASSWORD } })).status()).toBe(401)

    await page.getByRole('link', { name: 'Kirish' }).click()
    await page.getByLabel('Email').fill(user.email)
    await page.getByLabel('Parol').fill(NEW_PASSWORD)
    await page.locator('form').getByRole('button', { name: 'Kirish' }).click()
    await expect(page).toHaveURL(/\/$/)

    // the link works once
    await page.goto(link)
    await page.getByLabel('Yangi parol').fill('e2e-Third-Passw0rd!')
    await page.getByLabel('Parolni takrorlang').fill('e2e-Third-Passw0rd!')
    await page.getByRole('button', { name: 'Parolni saqlash' }).click()
    await expect(page.getByRole('main').getByRole('alert')).toContainText('Havola yaroqsiz')
    await expect(page.getByRole('link', { name: 'Yangi havola so‘rash' })).toHaveAttribute('href', '/forgot-password')
  })

  test('an unknown address gets the same answer and no e-mail; a link without a token is refused', async ({ page }) => {
    const nobody = uniqueUser('nobody').email
    await page.goto('/forgot-password')
    await page.getByLabel('Email').fill(nobody)
    await page.getByRole('button', { name: 'Havola yuborish' }).click()
    await expect(page.getByRole('main').getByRole('status')).toContainText('havolasi yuborildi')
    await page.waitForTimeout(500)
    expect(linksFor(nobody)).toEqual([])

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
