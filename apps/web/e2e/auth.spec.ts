import { expect, test } from './fixtures'
import { loginViaUi, registerViaUi, uniqueUser } from './helpers'

async function logoutViaUi(page: import('@playwright/test').Page) {
  await page.goto('/profile')
  await page.getByRole('button', { name: /Tizimdan chiqish/ }).click()
  await expect(page).toHaveURL(/\/login/)
}

test.describe('auth', () => {
  test('register -> home, logout -> login, protected pages redirect, login again', async ({ page }) => {
    const user = await registerViaUi(page)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    await logoutViaUi(page)

    for (const p of ['/', '/wardrobe', '/outfits', '/profile']) {
      const res = await page.goto(p)
      expect(res?.status()).toBe(200)
      await expect(page).toHaveURL(/\/login\?next=/)
    }

    await loginViaUi(page, user)
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('navigation', { name: 'Asosiy navigatsiya' }).first()).toBeAttached()
  })

  test('unauthenticated page request is a 307 to /login?next=', async ({ request }) => {
    const res = await request.get('/wardrobe', { maxRedirects: 0 })
    expect(res.status()).toBe(307)
    expect(res.headers()['location']).toContain('/login?next=%2Fwardrobe')
  })

  test('wrong password shows an error and stays on /login', async ({ page, request }) => {
    const user = uniqueUser('wrongpw')
    expect((await request.post('/api/v1/auth/register', { data: user })).status()).toBe(201)
    await request.post('/api/v1/auth/logout')

    await loginViaUi(page, { ...user, password: 'wrong-password-for-test' })
    await expect(page).toHaveURL(/\/login/)
    // Error message rendered inline (not a toast); the form is usable again.
    await expect(page.locator('form').getByText(/\S/, { exact: false }).first()).toBeVisible()
    await expect(page.locator('form [role=alert], form .text-destructive').first()).toBeVisible()
    await expect(page.locator('form').getByRole('button', { name: 'Kirish' })).toBeEnabled()
    const cookies = await page.context().cookies()
    expect(cookies.find((c) => c.name === 'atlas_at')).toBeUndefined()
  })

  test('deep link while logged out -> login -> back to the deep link (next param)', async ({ page, request }) => {
    const user = uniqueUser('deeplink')
    expect((await request.post('/api/v1/auth/register', { data: user })).status()).toBe(201)
    await request.post('/api/v1/auth/logout')
    await page.context().clearCookies()

    await page.goto('/wardrobe')
    await expect(page).toHaveURL(/\/login\?next=%2Fwardrobe/)
    await loginViaUi(page, user, page.url())
    await expect(page).toHaveURL(/\/wardrobe$/)
    await expect(page.getByRole('heading', { name: 'Garderob', level: 1 })).toBeVisible()
  })

  test('open-redirect protection: external next param is ignored', async ({ page, request }) => {
    const user = uniqueUser('redir')
    expect((await request.post('/api/v1/auth/register', { data: user })).status()).toBe(201)
    await request.post('/api/v1/auth/logout')
    await page.context().clearCookies()
    await loginViaUi(page, user, '/login?next=https%3A%2F%2Fevil.example%2F')
    await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/)
  })

  test('logged-in user visiting /login is sent home', async ({ page }) => {
    await registerViaUi(page)
    await page.goto('/login')
    await expect(page).toHaveURL(/\/$/)
  })
})
