import { expect, test, type Page } from '@playwright/test'
import { registerViaApi } from './helpers'

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812, bottom: true },
  { name: 'tablet', width: 768, height: 1024, bottom: false },
  { name: 'desktop', width: 1280, height: 800, bottom: false },
]
const LINKS = [
  { label: 'Garderob', path: '/wardrobe' },
  { label: 'AI Stilist', path: '/stylist' },
  { label: 'Outfitlar', path: '/outfits' },
  { label: 'Profil', path: '/profile' },
  { label: 'Bosh sahifa', path: '/' },
]

const overflow = (page: Page) =>
  page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))

for (const vp of VIEWPORTS) {
  test.describe(`${vp.name} ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } })

    test('correct nav is visible, links route, no horizontal overflow', async ({ page }) => {
      await registerViaApi(page.request)
      await page.goto('/')
      const navs = page.getByRole('navigation', { name: 'Asosiy navigatsiya' })
      // Exactly one nav is visible (the other is display:none -> excluded from the a11y tree).
      await expect(navs).toHaveCount(1)
      const nav = navs.first()
      await expect(nav).toBeVisible()
      const box = (await nav.boundingBox())!
      if (vp.bottom) {
        expect(box.y + box.height).toBeGreaterThan(vp.height - 120) // pinned to the bottom
        expect(box.width).toBeGreaterThan(vp.width * 0.8)
      } else {
        expect(box.x).toBeLessThan(40) // left rail / sidebar
        expect(box.height).toBeGreaterThan(vp.height * 0.3)
      }

      for (const l of LINKS) {
        await page.getByRole('navigation', { name: 'Asosiy navigatsiya' }).getByRole('link', { name: l.label }).click()
        await expect(page).toHaveURL(new RegExp(`${l.path === '/' ? '/$' : l.path + '$'}`))
        const { sw, iw } = await overflow(page)
        expect(sw, `scrollWidth on ${l.path}`).toBeLessThanOrEqual(iw)
      }
      for (const p of ['/wardrobe/new', '/profile/color-analysis']) {
        await page.goto(p)
        const { sw, iw } = await overflow(page)
        expect(sw, `scrollWidth on ${p}`).toBeLessThanOrEqual(iw)
      }
      // Sub-screens: bottom nav hidden on mobile, sidebar stays >=768.
      await page.goto('/wardrobe/new')
      await expect(page.getByRole('navigation', { name: 'Asosiy navigatsiya' })).toHaveCount(vp.bottom ? 0 : 1)
    })

    test('login page: no overflow', async ({ page }) => {
      await page.goto('/login')
      const { sw, iw } = await overflow(page)
      expect(sw).toBeLessThanOrEqual(iw)
    })
  })
}

test.describe('document-level a11y', () => {
  test('viewport meta does not disable zoom', async ({ page }) => {
    await page.goto('/login')
    const content = await page.locator('meta[name=viewport]').getAttribute('content')
    expect(content).toBeTruthy()
    expect(content).not.toMatch(/user-scalable\s*=\s*(no|0)/i)
    expect(content).not.toMatch(/maximum-scale\s*=\s*1(\.0)?\b/i)
    expect(content).toMatch(/width=device-width/)
  })

  test('unknown route shows the not-found page (404)', async ({ page }) => {
    await registerViaApi(page.request)
    const res = await page.goto('/this-route-does-not-exist')
    expect(res?.status()).toBe(404)
    await expect(page.getByText('Sahifa topilmadi')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Bosh sahifaga qaytish' })).toBeVisible()
  })

  test('unknown route while logged out redirects to login (documented behaviour)', async ({ request }) => {
    const res = await request.get('/this-route-does-not-exist', { maxRedirects: 0 })
    expect(res.status()).toBe(307)
  })

  test('unknown item id inside the app shows a not-found state', async ({ page }) => {
    await registerViaApi(page.request)
    await page.goto('/wardrobe/not-a-real-item-id')
    await expect(page.getByText(/Kiyim topilmadi|Sahifa topilmadi/)).toBeVisible()
  })

  test('keyboard: first Tab hits the skip link, activating it focuses main content', async ({ page }) => {
    await registerViaApi(page.request)
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await page.keyboard.press('Tab')
    const skip = page.getByRole('link', { name: "Asosiy kontentga o'tish" })
    await expect(skip).toBeFocused()
    await expect(skip).toBeVisible() // revealed on focus
    await page.keyboard.press('Enter')
    await expect(page.locator('#main-content')).toBeFocused()
    await expect(page).toHaveURL(/#main-content$/)
  })
})
