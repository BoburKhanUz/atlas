import { expect, test } from './fixtures'

/**
 * The landing page (docs/plan/W0.md): public, built to the approved mockup, with the
 * store badges in their "Tez kunda" state until the admin panel sets the links.
 */
const LANDING = '/'

test.describe('landing page', () => {
  test('a visitor sees every section without signing in', async ({ page }) => {
    const res = await page.goto(LANDING)
    expect(res?.status()).toBe(200)
    await expect(page).toHaveURL(LANDING)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Shaxsiy AI stilistingiz')
    for (const title of [
      'Lookly nimalar qila oladi',
      'Qanday ishlaydi',
      'Ma’lumotlaringiz himoyada',
      'Lookly bilan har kuni chiroyli kiyining',
      'Ko‘p beriladigan savollar',
    ]) {
      await expect(page.getByRole('heading', { level: 2, name: title })).toBeVisible()
    }
    for (const feature of ['Raqamli garderob', 'Har kunga obraz', 'AI stilist', 'Rang profilingiz']) {
      await expect(page.getByRole('heading', { level: 3, name: feature })).toBeVisible()
    }
    // No web version of the app (ADR 0012).
    await expect(page.getByText('Brauzerda ochish')).toHaveCount(0)
    await expect(page).toHaveTitle(/Lookly/)
  })

  test('while no store link is set, the badges say "Tez kunda" and link nowhere', async ({ page }) => {
    await page.goto(LANDING)
    // Two places (hero, banner) × two stores.
    await expect(page.getByText('Tez kunda')).toHaveCount(4)
    await expect(page.getByRole('img', { name: 'Google Play orqali oling' })).toHaveCount(2)
    // The badges' own words: Apple gives none in Uzbek.
    await expect(page.getByRole('img', { name: 'Download on the App Store' })).toHaveCount(2)
    await expect(page.locator('a[href*="play.google.com"], a[href*="apps.apple.com"]')).toHaveCount(0)
  })

  test('the header leads to the sections, the footer to the legal pages', async ({ page }) => {
    await page.goto(LANDING)
    const nav = page.getByRole('navigation', { name: 'Bo‘limlar' })
    await nav.getByRole('link', { name: 'Savollar' }).click()
    await expect(page).toHaveURL(`${LANDING}#savollar`)
    await page.getByRole('link', { name: 'Ilovani yuklab olish' }).first().click()
    await expect(page).toHaveURL(`${LANDING}#yuklab-olish`)

    for (const [name, path] of [['Maxfiylik siyosati', '/privacy'], ['Foydalanish shartlari', '/terms']]) {
      await page.goto(LANDING)
      await page.getByRole('contentinfo').getByRole('link', { name }).click()
      await expect(page).toHaveURL(path)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    }
  })

  test('an answer opens and closes', async ({ page }) => {
    await page.goto(LANDING)
    const answer = page.getByText('Ha, hozir Lookly bepul.', { exact: false })
    await expect(answer).toBeHidden()
    await page.getByText('Lookly bepulmi?').click()
    await expect(answer).toBeVisible()
    await page.getByText('Lookly bepulmi?').click()
    await expect(answer).toBeHidden()
  })

  test('at phone width nothing scrolls sideways, and the menu opens', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 })
    await page.goto(LANDING)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    // The section links sit behind the menu button on a phone.
    await expect(page.getByRole('navigation', { name: 'Bo‘limlar' })).toBeHidden()
    await page.locator('summary', { hasText: 'Menyu' }).click()
    const menu = page.getByRole('navigation', { name: 'Menyu' })
    await menu.getByRole('link', { name: 'Qanday ishlaydi' }).click()
    await expect(page).toHaveURL(`${LANDING}#qanday-ishlaydi`)
  })
})
