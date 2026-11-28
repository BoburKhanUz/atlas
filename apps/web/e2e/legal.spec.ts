import { LEGAL_VERSION } from '../src/lib/legal/version'
import { expect, test } from './fixtures'

test.describe('legal pages', () => {
  for (const [path, title] of [['/privacy', /Maxfiylik/], ['/terms', /Foydalanish shartlari/]] as const) {
    test(`${path} shows its document and version without signing in`, async ({ page }) => {
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(title)
      await expect(page.getByRole('main')).toContainText(LEGAL_VERSION)
    })
  }
})
