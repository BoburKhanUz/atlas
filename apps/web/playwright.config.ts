import { defineConfig, devices } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * E2E against the PRODUCTION build (`node .next/standalone/server.js`).
 * Prerequisites (done by e2e/run-local.sh or the CI job): `bun run build`, a
 * migrated Postgres reachable via E2E_DATABASE_URL.
 *
 * Two server instances share one database:
 *   - main    (port E2E_PORT,   default access TTL)            -> every spec except session.spec
 *   - session (port E2E_PORT+1, ACCESS_TOKEN_TTL_SECONDS=10)   -> session.spec only, so that the
 *     "access token really expires" test can wait out a 10s TTL (the app's minimum)
 *     without making the other specs flaky.
 * Secrets are random per run unless supplied via env. Nothing is printed.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100)
const SESSION_PORT = PORT + 1
const secret = (name: string) => process.env[name] || randomBytes(32).toString('hex')

const DATABASE_URL = process.env.E2E_DATABASE_URL
if (!DATABASE_URL) {
  throw new Error('E2E_DATABASE_URL is not set (see e2e/run-local.sh)')
}

const JWT_SECRET = secret('JWT_SECRET')
const MEDIA_SIGNING_SECRET = secret('MEDIA_SIGNING_SECRET')
// exactly 32 random bytes, base64
const SESSION_ENC_KEY = process.env.SESSION_ENC_KEY || randomBytes(32).toString('base64')
const STORAGE_LOCAL_DIR = process.env.STORAGE_LOCAL_DIR || mkdtempSync(path.join(tmpdir(), 'atlas-e2e-storage-'))

const baseEnv = {
  HOSTNAME: '127.0.0.1',
  DATABASE_URL,
  JWT_SECRET,
  MEDIA_SIGNING_SECRET,
  SESSION_ENC_KEY,
  STORAGE_LOCAL_DIR,
  WEATHER_PROVIDER: 'mock',
  NODE_ENV: 'production',
  COOKIE_SECURE: '0', // plain http
  NEXT_TELEMETRY_DISABLED: '1',
}

const server = (port: number, extra: Record<string, string> = {}) => ({
  command: 'node .next/standalone/server.js',
  url: `http://127.0.0.1:${port}/api/health`,
  reuseExistingServer: !process.env.CI,
  timeout: 90_000,
  env: { ...baseEnv, PORT: String(port), ...extra },
  stdout: 'ignore' as const,
  stderr: 'pipe' as const,
})

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: false,
  workers: Number(process.env.E2E_WORKERS ?? 2),
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'uz-UZ',
  },
  projects: [
    {
      name: 'main',
      testIgnore: /session(-[\w-]+)?\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${PORT}` },
    },
    {
      name: 'session',
      testMatch: /session(-[\w-]+)?\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${SESSION_PORT}` },
    },
  ],
  webServer: [server(PORT), server(SESSION_PORT, { ACCESS_TOKEN_TTL_SECONDS: '10' })],
})
