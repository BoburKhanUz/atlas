import crypto from 'crypto'
import path from 'path'
import { defineConfig } from 'vitest/config'
import { APP_DB, dbUrl, enabled } from './tests/integration/pg'

// Database integration tests (migrations, session protocol). They create and
// drop their own `itest_*` databases on a disposable PostgreSQL server named
// by ATLAS_ITEST_PGHOST / ATLAS_ITEST_PGPORT / ATLAS_ITEST_PGUSER and are
// skipped when those are not set. Never point them at a real database.
const random = (n: number) => crypto.randomBytes(n).toString('base64')

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.itest.ts'],
    globalSetup: ['tests/integration/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 180_000,
    env: {
      // the app's `db` client (src/lib/db.ts) points at the shared app database
      DATABASE_URL: enabled ? dbUrl(APP_DB) : 'postgresql://unused@localhost:1/unused',
      // test-only secrets, random per run
      JWT_SECRET: random(48),
      MEDIA_SIGNING_SECRET: random(48),
      SESSION_ENC_KEY: random(32),
      LOG_LEVEL: 'error',
    },
  },
})
