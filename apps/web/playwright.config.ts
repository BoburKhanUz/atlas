import { defineConfig, devices } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * The browser suite of the website (the landing page, the legal pages, the
 * page an e-mailed reset link opens), arranged as in production: the web app's
 * production build (`node .next/standalone/server.js`) for the pages, the Go
 * server and its worker on a migrated PostgreSQL for the API, and
 * e2e/go-front.mjs in front, sending /api/ to Go as Caddy does.
 *
 *   E2E_GO_BINARY=<the built lookly> E2E_DATABASE_URL=... npx playwright test   (or e2e/run-local.sh)
 */
const BINARY = process.env.E2E_GO_BINARY
const DATABASE_URL = process.env.E2E_DATABASE_URL
if (!BINARY) throw new Error('E2E_GO_BINARY is not set (cd apps/api && go build -tags nodynamic -o <path> ./cmd/lookly)')
if (!DATABASE_URL) throw new Error('E2E_DATABASE_URL is not set (a migrated PostgreSQL 16; see e2e/run-local.sh)')

const PORT = Number(process.env.E2E_PORT ?? 3100)
// Reset e-mails are written here as files; the specs read them (set once by the runner, inherited by its workers).
const MAIL_OUTBOX_DIR = (process.env.E2E_MAIL_OUTBOX_DIR ||= mkdtempSync(path.join(tmpdir(), 'lookly-e2e-mail-')))
const go = {
  LOOKLY_ENV: 'test',
  LOOKLY_LOG_LEVEL: 'warn',
  DATABASE_URL,
  JWT_SECRET: process.env.JWT_SECRET || randomBytes(32).toString('hex'),
  MEDIA_SIGNING_SECRET: process.env.MEDIA_SIGNING_SECRET || randomBytes(32).toString('hex'),
  SESSION_ENC_KEY: process.env.SESSION_ENC_KEY || randomBytes(32).toString('base64'),
  STORAGE_LOCAL_DIR: process.env.STORAGE_LOCAL_DIR || mkdtempSync(path.join(tmpdir(), 'lookly-e2e-storage-')),
  // E-mail is never sent from an e2e run: files only, whatever SMTP_* the shell holds.
  MAIL_TRANSPORT: 'outbox',
  MAIL_OUTBOX_DIR,
  COOKIE_SECURE: '0', // plain http
  WEATHER_PROVIDER: 'mock',
  OPENAI_API_KEY: '',
  GEMINI_API_KEY: '',
}

const quiet = { reuseExistingServer: !process.env.CI, stdout: 'ignore' as const, stderr: 'pipe' as const }

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
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure', locale: 'uz-UZ' },
  projects: [{ name: 'site', use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${PORT}` } }],
  webServer: [
    {
      command: 'node .next/standalone/server.js',
      url: `http://127.0.0.1:${PORT + 10}/`,
      timeout: 90_000,
      env: { HOSTNAME: '127.0.0.1', PORT: String(PORT + 10), NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' },
      ...quiet,
    },
    { command: `"${BINARY}" serve`, url: `http://127.0.0.1:${PORT + 20}/api/health`, timeout: 60_000, env: { ...go, LOOKLY_HTTP_ADDR: `127.0.0.1:${PORT + 20}` }, ...quiet },
    { command: 'node e2e/go-worker.mjs', url: `http://127.0.0.1:${PORT + 30}/`, timeout: 60_000, env: { ...go, GO_BINARY: BINARY, WORKER_PORT: String(PORT + 30) }, ...quiet },
    {
      command: 'node e2e/go-front.mjs',
      url: `http://127.0.0.1:${PORT}/api/health`,
      timeout: 90_000,
      env: { FRONT_PORT: String(PORT), NEXT_PORT: String(PORT + 10), GO_PORT: String(PORT + 20) },
      ...quiet,
    },
  ],
})
