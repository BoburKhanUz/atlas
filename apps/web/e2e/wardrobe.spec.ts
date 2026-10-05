import { expect, test } from './fixtures'
import { GARMENTS, makeImage, registerViaApi, uploadAll } from './helpers'

test.describe('wardrobe', () => {
  test('upload 3, detail/back/forward/reload, edit persists with corrected badge, delete', async ({ page }) => {
    await registerViaApi(page.request)
    const ids = await uploadAll(page)
    expect(new Set(ids).size).toBe(3)

    await page.goto('/wardrobe')
    await expect(page.getByText('3 ta kiyim')).toBeVisible()
    const cards = page.locator('a[href^="/wardrobe/"]:not([href="/wardrobe/new"])')
    await expect(cards).toHaveCount(3)

    // Open detail
    await cards.first().click()
    await expect(page).toHaveURL(/\/wardrobe\/[0-9a-z-]+$/)
    const detailUrl = page.url()
    await expect(page.getByRole('heading', { name: 'AI natijalari' })).toBeVisible()

    // Reload keeps the item
    await page.reload()
    await expect(page).toHaveURL(detailUrl)
    await expect(page.getByRole('heading', { name: 'AI natijalari' })).toBeVisible()

    // Back / forward
    await page.goBack()
    await expect(page).toHaveURL(/\/wardrobe$/)
    await expect(page.getByText('3 ta kiyim')).toBeVisible()
    await page.goForward()
    await expect(page).toHaveURL(detailUrl)
    await expect(page.getByRole('heading', { name: 'AI natijalari' })).toBeVisible()

    // Edit material
    await expect(page.getByText('Tahrir qilingan')).toHaveCount(0)
    await page.getByRole('button', { name: 'Tahrirlash' }).click()
    await expect(page.getByRole('heading', { name: 'Tahrirlash' })).toBeVisible()
    // Labels are not programmatically associated; the Select trigger follows its label.
    const materialTrigger = page.locator('label', { hasText: /^Material$/ }).locator('xpath=following-sibling::*[1]')
    await materialTrigger.click()
    await page.getByRole('option', { name: 'Zamsh' }).click()
    await page.getByRole('button', { name: 'Saqlash' }).click()

    await expect(page.getByText('Tahrir qilingan')).toBeVisible()
    await expect(page.locator('dt', { hasText: 'Material' }).locator('xpath=following-sibling::div//dd[1]')).toHaveText('Zamsh')

    await page.reload()
    await expect(page.getByText('Tahrir qilingan')).toBeVisible()
    await expect(page.locator('dt', { hasText: 'Material' }).locator('xpath=following-sibling::div//dd[1]')).toHaveText('Zamsh')
    await expect(page.getByRole('heading', { name: 'Tahrir tarixi' })).toBeVisible()

    // Badge also shows on the list
    await page.goto('/wardrobe')
    await expect(page.getByText('Tahrir qilingan')).toHaveCount(1)

    // Delete via dialog from the detail page
    await page.locator('a[href^="/wardrobe/"]:not([href="/wardrobe/new"])').first().click()
    await page.getByRole('button', { name: "O'chirish" }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Bekor qilish' }).click()
    await expect(dialog).toBeHidden()
    await page.getByRole('button', { name: "O'chirish" }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: "O'chirish" }).click()
    await expect(page).toHaveURL(/\/wardrobe$/)
    await expect(page.getByText('2 ta kiyim')).toBeVisible()
    await expect(page.locator('a[href^="/wardrobe/"]:not([href="/wardrobe/new"])')).toHaveCount(2)
  })

  test('another user cannot read someone else\'s item (404)', async ({ page, playwright, baseURL }) => {
    await registerViaApi(page.request)
    const [id] = await uploadAll(page)
    const other = await playwright.request.newContext({ baseURL })
    await registerViaApi(other)
    const res = await other.get(`/api/v1/wardrobe/items/${id}`)
    expect(res.status()).toBe(404)
    await other.dispose()
  })
  // Regression: with AnimatePresence mode="wait", an upload finishing while the
  // previous panel was still animating out left "Tahlil qilinmoqda…" on screen
  // forever (the item was saved). Sweep the response time across that window.
  test('the analysis result is shown whatever the upload response time', async ({ page }) => {
    // E2E_UPLOAD_SWEEP_STEP=3 for a fine sweep when investigating
    const step = Number(process.env.E2E_UPLOAD_SWEEP_STEP ?? 15)
    test.setTimeout(240_000)
    await registerViaApi(page.request)
    const file = await makeImage(GARMENTS.shirt.name, GARMENTS.shirt.color)
    for (let delay = 0; delay <= 360; delay += step) {
      await page.unroute('**/api/v1/wardrobe/items')
      // delay the request (route.continue keeps the binary body intact; route.fetch would re-encode it)
      await page.route('**/api/v1/wardrobe/items', async (route) => {
        await new Promise((r) => setTimeout(r, delay))
        await route.continue()
      })
      await page.goto('/wardrobe/new')
      await page.waitForLoadState('networkidle')
      await page.locator('input[type=file]:not([capture])').setInputFiles(file)
      await expect(page.getByText('Tahlil tayyor'), `response delayed ${delay} ms`).toBeVisible({ timeout: 5_000 })
    }
  })
})
