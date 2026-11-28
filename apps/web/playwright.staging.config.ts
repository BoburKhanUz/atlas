import { defineConfig, devices } from '@playwright/test'
import { smokeMode } from './e2e/smoke/smoke-mode'

/**
 * Phase 5.0 staging smoke against an already deployed target (no webServer,
 * no database access): only e2e/smoke/. See docs/ai/staging.md.
 *
 *   STAGING_BASE_URL=https://staging.example bunx playwright test -c playwright.staging.config.ts
 *
 * Mock mode by default. A real provider needs STAGING_SMOKE_PROVIDER=real AND
 * STAGING_SMOKE_REAL_PROVIDER_OPT_IN=1, and is refused under CI. The smoke
 * holds no provider key; nothing is printed beyond the test report.
 */
const baseURL = process.env.STAGING_BASE_URL?.trim()
if (!baseURL) throw new Error('STAGING_BASE_URL is not set (see docs/ai/staging.md)')
if (!/^https?:\/\//.test(baseURL)) throw new Error('STAGING_BASE_URL must be an http(s) URL')
smokeMode(process.env) // validate the mode before any request

export default defineConfig({
  testDir: './e2e/smoke',
  outputDir: './test-results/staging',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 300_000,
  expect: { timeout: 30_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-staging' }]],
  use: { ...devices['Desktop Chrome'], baseURL, trace: 'off', screenshot: 'off', locale: 'uz-UZ' },
})
