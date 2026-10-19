import { expect, test } from './fixtures'
import { e2eSql, registerViaUi } from './helpers'

/** The user's only consent predates LEGAL_CONSENT_MIN_VERSION, as after a change that needs new consent. */
function outdateConsent(email: string) {
  e2eSql(`UPDATE "LegalConsent" SET "version" = '2020-01-01.1' WHERE "userId" = (SELECT "id" FROM "User" WHERE "email" = '${email}')`)
}

async function acceptOnConsentPage(page: import('@playwright/test').Page) {
  await page.getByLabel('18 yoshdan kattaman').check()
  await page.locator('#legalAccepted').check()
  await page.getByRole('button', { name: 'Qabul qilaman' }).click()
}

test.describe('re-consent after the legal texts change', () => {
  test.beforeEach(() => test.skip(!process.env.E2E_DATABASE_URL, 'needs E2E_DATABASE_URL'))

  test('the app sends the user to /consent first; accepting returns to the app', async ({ page }) => {
    const user = await registerViaUi(page)
    outdateConsent(user.email)
    await page.goto('/wardrobe')
    await expect(page).toHaveURL(/\/consent$/)
    await expect(page.getByRole('heading', { name: 'Hujjatlar yangilandi' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Huquqiy hujjatlar' }).getByRole('link', { name: 'Maxfiylik siyosati' })).toHaveAttribute('href', '/privacy')

    await page.getByRole('button', { name: 'Qabul qilaman' }).click()
    await expect(page.locator('form').getByRole('alert')).toContainText('18 yosh')
    await acceptOnConsentPage(page)
    await expect(page).toHaveURL(/\/$/)
    await page.goto('/wardrobe')
    await expect(page).toHaveURL(/\/wardrobe$/)
  })

  test('an open page whose request is refused with CONSENT_REQUIRED goes to /consent and comes back', async ({ page }) => {
    const user = await registerViaUi(page)
    await page.goto('/wardrobe')
    await expect(page).toHaveURL(/\/wardrobe$/)
    outdateConsent(user.email)
    // A client-side navigation keeps the layout: the new page's API call meets the refusal.
    await page.getByRole('link', { name: 'Obrazlar' }).first().click()
    await expect(page).toHaveURL(/\/consent\?next=%2Foutfits/)
    await acceptOnConsentPage(page)
    await expect(page).toHaveURL(/\/outfits$/)
  })

  test('declining: the account can be deleted from /consent', async ({ page, request }) => {
    const user = await registerViaUi(page)
    outdateConsent(user.email)
    await page.goto('/')
    await expect(page).toHaveURL(/\/consent$/)
    await page.getByRole('button', { name: 'Rozi emasman — hisobni o‘chirish' }).click()
    const dialog = page.getByRole('alertdialog')
    await dialog.getByLabel(/Tasdiqlash uchun/).fill("O'CHIRISH")
    await dialog.getByRole('button', { name: 'Hisobni o‘chirish' }).click()
    await expect(page).toHaveURL(/\/login/)
    const login = await request.post('/api/v1/auth/login', { data: { email: user.email, password: user.password } })
    expect(login.status()).toBe(401)
  })
})
