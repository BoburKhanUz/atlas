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
 *
 * Go mode (E2E_GO=1, E2E_GO_BINARY=<the built `lookly` binary>): each instance
 * becomes three processes on the same database and secrets: Next.js, the Go
 * server, and e2e/go-front.mjs in front of them on the instance's port. The
 * proxy sends the operations Go already serves to Go and everything else to
 * Next.js. A test arrangement only; see docs/plan/B2.md.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100)
const SESSION_PORT = PORT + 1
const GO_MODE = process.env.E2E_GO === '1'
const GO_BINARY = process.env.E2E_GO_BINARY
if (GO_MODE && !GO_BINARY) {
  throw new Error('E2E_GO=1 needs E2E_GO_BINARY (cd apps/api && go build -o <path> ./cmd/lookly)')
}
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
// Reset e-mails are written here as files; the specs read them (set once by
// the runner, inherited by its workers).
const MAIL_OUTBOX_DIR = (process.env.E2E_MAIL_OUTBOX_DIR ||= mkdtempSync(path.join(tmpdir(), 'atlas-e2e-mail-')))

const baseEnv = {
  HOSTNAME: '127.0.0.1',
  DATABASE_URL,
  JWT_SECRET,
  MEDIA_SIGNING_SECRET,
  SESSION_ENC_KEY,
  STORAGE_LOCAL_DIR,
  WEATHER_PROVIDER: 'mock',
  // Production build with mock AI: no paid provider in tests. The flag is the
  // explicit acknowledgement the production config requires (src/lib/ai/config.ts).
  AI_LLM_PROVIDER: 'mock',
  // Deterministic mock vision: the e2e flows rely on its file-name hints.
  AI_VISION_PROVIDER: 'mock',
  AI_ALLOW_MOCK_IN_PRODUCTION: '1',
  // Playwright starts the server with the shell environment merged in, so the
  // per-feature routes, the provider allowlist and the provider keys are pinned
  // empty (= unset) as well: no shell value can route an e2e run to a real provider.
  AI_STYLIST_PROVIDER: '',
  AI_STYLIST_MODEL: '',
  AI_OUTFIT_PROVIDER: '',
  AI_OUTFIT_MODEL: '',
  AI_APPROVED_PROVIDERS: '',
  GEMINI_API_KEY: '',
  OPENAI_API_KEY: '',
  // Phase 5.0: production defaults every AI feature OFF; e2e turns them on explicitly (mock providers).
  AI_STYLIST_ENABLED: 'true',
  AI_VISION_ENABLED: 'true',
  AI_OUTFIT_AI_ENABLED: 'true',
  AI_ROLLOUT_PERCENT: '100',
  // E-mail is never sent from an e2e run: files only, whatever SMTP_* the shell holds.
  MAIL_TRANSPORT: 'outbox',
  MAIL_ALLOW_OUTBOX_IN_PRODUCTION: '1',
  MAIL_OUTBOX_DIR,
  NODE_ENV: 'production',
  COOKIE_SECURE: '0', // plain http
  NEXT_TELEMETRY_DISABLED: '1',
}

interface WebServer {
  command: string
  url: string
  reuseExistingServer: boolean
  timeout: number
  env: Record<string, string>
  stdout: 'ignore'
  stderr: 'pipe'
}

const server = (port: number, extra: Record<string, string> = {}): WebServer => ({
  command: 'node .next/standalone/server.js',
  url: `http://127.0.0.1:${port}/api/health`,
  reuseExistingServer: !process.env.CI,
  timeout: 90_000,
  env: { ...baseEnv, PORT: String(port), ...extra },
  stdout: 'ignore',
  stderr: 'pipe',
})

/** One instance in Go mode: Next.js on port + 10, Go on port + 20, the proxy on port. */
const goInstance = (port: number, extra: Record<string, string> = {}): WebServer[] => [
  server(port + 10, extra),
  {
    command: `"${GO_BINARY}" serve`,
    url: `http://127.0.0.1:${port + 20}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      LOOKLY_ENV: 'test',
      LOOKLY_HTTP_ADDR: `127.0.0.1:${port + 20}`,
      LOOKLY_LOG_LEVEL: 'warn',
      DATABASE_URL: DATABASE_URL!,
      JWT_SECRET,
      MEDIA_SIGNING_SECRET,
      SESSION_ENC_KEY,
      COOKIE_SECURE: '0', // plain http
      ...extra,
    },
    stdout: 'ignore',
    stderr: 'pipe',
  },
  {
    command: 'node e2e/go-front.mjs',
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 90_000,
    env: { FRONT_PORT: String(port), NEXT_PORT: String(port + 10), GO_PORT: String(port + 20) },
    stdout: 'ignore',
    stderr: 'pipe',
  },
]

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
      // go-mode.spec.ts checks the Go-mode arrangement itself and runs only in it.
      testIgnore: GO_MODE ? /session(-[\w-]+)?\.spec\.ts/ : /(session(-[\w-]+)?|go-mode)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${PORT}` },
    },
    {
      name: 'session',
      testMatch: /session(-[\w-]+)?\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${SESSION_PORT}` },
    },
  ],
  webServer: GO_MODE
    ? [...goInstance(PORT), ...goInstance(SESSION_PORT, { ACCESS_TOKEN_TTL_SECONDS: '10' })]
    : [server(PORT), server(SESSION_PORT, { ACCESS_TOKEN_TTL_SECONDS: '10' })],
})
