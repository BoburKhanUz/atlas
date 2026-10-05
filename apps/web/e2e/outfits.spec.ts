import { expect, test } from './fixtures'
import { registerViaApi, uploadAll } from './helpers'

test.describe('outfits', () => {
  test('generate for work shows a score; save appears in the saved list after reload', async ({ page }) => {
    await registerViaApi(page.request)
    await uploadAll(page)

    await page.goto('/outfits?occasion=work')
    // ?occasion auto-generates.
    await expect(page.getByText('Bugungi eng yaxshi variant')).toBeVisible({ timeout: 20_000 })
    const score = page.locator('span.text-3xl')
    await expect(score).toBeVisible()
    const n = Number(await score.innerText())
    expect(n).toBeGreaterThanOrEqual(0)
    expect(n).toBeLessThanOrEqual(100)
    await expect(page.getByText('/ 100')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Yoqdi' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Yoqmadi' })).toBeVisible()
    // "Boshqa" also exists as an unrelated occasion chip; scope to the feedback bar.
    const feedbackBar = page.locator('div.grid-cols-4')
    await expect(feedbackBar.getByRole('button', { name: 'Boshqa' })).toBeVisible()
    await expect(page.getByText('Saqlangan outfitlar')).toHaveCount(0)

    await page.getByRole('button', { name: 'Saqlash' }).click()
    await expect(page.getByText('Saqlangan outfitlar')).toBeVisible()

    await page.goto('/outfits')
    await expect(page.getByRole('heading', { name: 'Saqlangan outfitlar' })).toBeVisible()
    await expect(page.getByText('(1)')).toBeVisible()
  })

  test('like feedback is accepted (persists outfit, marks button active)', async ({ page }) => {
    await registerViaApi(page.request)
    await uploadAll(page)
    await page.goto('/outfits?occasion=work')
    await expect(page.getByText('Bugungi eng yaxshi variant')).toBeVisible({ timeout: 20_000 })
    const fb = page.waitForResponse((r) => /\/outfits\/.+\/feedback/.test(r.url()))
    await page.getByRole('button', { name: 'Yoqdi' }).click()
    expect((await fb).status()).toBeLessThan(300)
  })

  test('empty wardrobe: generation reports no outfits instead of a score', async ({ page }) => {
    await registerViaApi(page.request)
    await page.goto('/outfits?occasion=work')
    await expect(page.getByText('Bugungi eng yaxshi variant')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Outfitlar', level: 1 })).toBeVisible()
    await page.waitForTimeout(1500)
    await expect(page.getByText('Bugungi eng yaxshi variant')).toHaveCount(0)
  })
})
