import { defineConfig } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PINNED_AI_ENV } from './e2e/ai-env'

/**
 * The API journey suite (docs/plan/B7.md, B7.2): the Go server and its worker on
 * a migrated PostgreSQL (E2E_DATABASE_URL), driven over HTTP the way the mobile
 * app and the web pages drive it; every answer is checked against
 * docs/api/openapi.json (api-e2e/contract.ts).
 *
 *   E2E_GO_BINARY=<the built lookly> E2E_DATABASE_URL=... npx playwright test -c playwright.api.config.ts
 */
const BINARY = process.env.E2E_GO_BINARY
const DATABASE_URL = process.env.E2E_DATABASE_URL
if (!BINARY) throw new Error('E2E_GO_BINARY is not set (cd apps/api && go build -tags nodynamic -o <path> ./cmd/lookly)')
if (!DATABASE_URL) throw new Error('E2E_DATABASE_URL is not set (a migrated PostgreSQL 16)')

const PORT = Number(process.env.E2E_API_PORT ?? 3200)
// Shared with the specs (the outbox, the stored images): Playwright's workers inherit the runner's environment.
process.env.E2E_API_OUTBOX ??= mkdtempSync(path.join(tmpdir(), 'lookly-api-outbox-'))
process.env.E2E_API_STORAGE ??= mkdtempSync(path.join(tmpdir(), 'lookly-api-storage-'))
const env = {
  LOOKLY_ENV: 'test',
  LOOKLY_LOG_LEVEL: 'warn',
  DATABASE_URL,
  JWT_SECRET: process.env.JWT_SECRET ?? randomBytes(32).toString('hex'),
  MEDIA_SIGNING_SECRET: process.env.MEDIA_SIGNING_SECRET ?? randomBytes(32).toString('hex'),
  SESSION_ENC_KEY: process.env.SESSION_ENC_KEY ?? randomBytes(32).toString('base64'),
  STORAGE_LOCAL_DIR: process.env.E2E_API_STORAGE,
  MAIL_TRANSPORT: 'outbox',
  MAIL_OUTBOX_DIR: process.env.E2E_API_OUTBOX,
  COOKIE_SECURE: '0',
  WEATHER_PROVIDER: 'mock',
  ...PINNED_AI_ENV,
}

export default defineConfig({
  testDir: './api-e2e',
  outputDir: './test-results-api',
  fullyParallel: true,
  workers: Number(process.env.E2E_WORKERS ?? 4),
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 45_000,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${PORT}` },
  webServer: [
    {
      command: `"${BINARY}" serve`,
      url: `http://127.0.0.1:${PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { ...env, LOOKLY_HTTP_ADDR: `127.0.0.1:${PORT}` },
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'node e2e/go-worker.mjs',
      url: `http://127.0.0.1:${PORT + 30}/`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { ...env, GO_BINARY: BINARY, WORKER_PORT: String(PORT + 30) },
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
})
