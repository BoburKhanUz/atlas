/**
 * Helpers for database integration tests: disposable `itest_*` databases on
 * the server named by ATLAS_ITEST_PG* (see vitest.integration.config.ts),
 * real `prisma migrate deploy` runs against copies of the migrations folder,
 * and schema/data dumps for before/after comparisons.
 */
import { execFileSync, spawn, type ChildProcess } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

export const PG = {
  host: process.env.ATLAS_ITEST_PGHOST ?? '',
  port: process.env.ATLAS_ITEST_PGPORT ?? '5432',
  user: process.env.ATLAS_ITEST_PGUSER ?? 'postgres',
  /** Optional (CI service container); psql/pg_dump receive it as PGPASSWORD. */
  password: process.env.ATLAS_ITEST_PGPASSWORD ?? '',
}
if (PG.password) process.env.PGPASSWORD = PG.password
export const enabled = PG.host !== ''

/** Database used by the app's own `db` client in integration tests (see global-setup.ts). */
export const APP_DB = 'itest_app'

const WEB = path.resolve(__dirname, '../..')
const MIGRATIONS = path.join(WEB, 'prisma/migrations')
const PRISMA = path.join(WEB, 'node_modules/.bin/prisma')

export const MIGRATION_NAMES = fs
  .readdirSync(MIGRATIONS)
  .filter((n) => fs.statSync(path.join(MIGRATIONS, n)).isDirectory())
  .sort()

function checkName(db: string) {
  if (!/^itest_[a-z0-9_]+$/.test(db)) throw new Error(`refusing to touch non-test database "${db}"`)
}

export function dbUrl(db: string) {
  checkName(db)
  const host = PG.host.startsWith('/') ? `localhost:${PG.port}` : `${PG.host}:${PG.port}`
  const socket = PG.host.startsWith('/') ? `&host=${encodeURIComponent(PG.host)}` : ''
  const auth = PG.password ? `${PG.user}:${encodeURIComponent(PG.password)}` : PG.user
  return `postgresql://${auth}@${host}/${db}?schema=public${socket}`
}

function psqlArgs(db: string) {
  return ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-h', PG.host, '-p', PG.port, '-U', PG.user, '-d', db]
}

/** Run SQL; returns unaligned, tuples-only output. */
export function sql(db: string, query: string): string {
  if (db !== 'postgres') checkName(db)
  return execFileSync('psql', [...psqlArgs(db), '-At', '-f', '-'], { input: query, encoding: 'utf8' }).trim()
}

/** Run a query and return its rows as objects. */
export function rows<T = Record<string, unknown>>(db: string, query: string): T[] {
  const out = sql(db, `SELECT coalesce(json_agg(q), '[]') FROM (${query}) q`)
  return JSON.parse(out) as T[]
}

export function createDb(db: string, template?: string) {
  checkName(db)
  if (template) checkName(template)
  sql('postgres', `DROP DATABASE IF EXISTS ${db} WITH (FORCE)`)
  sql('postgres', `CREATE DATABASE ${db}${template ? ` TEMPLATE ${template}` : ''}`)
}

export function dropDb(db: string) {
  checkName(db)
  sql('postgres', `DROP DATABASE IF EXISTS ${db} WITH (FORCE)`)
}

/**
 * A private copy of the schema + the first `count` migrations (all when
 * omitted). `edit` may rewrite a migration's SQL (failure injection).
 */
export function migrationsDir(count = MIGRATION_NAMES.length, edit?: (name: string, sql: string) => string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-itest-'))
  fs.copyFileSync(path.join(WEB, 'prisma/schema.prisma'), path.join(dir, 'schema.prisma'))
  fs.mkdirSync(path.join(dir, 'migrations'))
  fs.copyFileSync(path.join(MIGRATIONS, 'migration_lock.toml'), path.join(dir, 'migrations/migration_lock.toml'))
  for (const name of MIGRATION_NAMES.slice(0, count)) {
    fs.mkdirSync(path.join(dir, 'migrations', name))
    const text = fs.readFileSync(path.join(MIGRATIONS, name, 'migration.sql'), 'utf8')
    fs.writeFileSync(path.join(dir, 'migrations', name, 'migration.sql'), edit ? edit(name, text) : text)
  }
  return dir
}

export interface PrismaRun {
  code: number
  output: string
}

function prismaArgs(dir: string, args: string[]) {
  // `migrate diff` takes its sources explicitly and rejects --schema
  return args[1] === 'diff' ? args : [...args, '--schema', path.join(dir, 'schema.prisma')]
}

/** `prisma migrate deploy` (or another migrate command) as a child process. */
export function prismaSpawn(db: string, dir: string, args = ['migrate', 'deploy']): { child: ChildProcess; done: Promise<PrismaRun> } {
  const child = spawn(PRISMA, prismaArgs(dir, args), {
    cwd: WEB,
    env: { ...process.env, DATABASE_URL: dbUrl(db), PRISMA_HIDE_UPDATE_MESSAGE: '1' },
  })
  let output = ''
  child.stdout?.on('data', (d) => (output += d))
  child.stderr?.on('data', (d) => (output += d))
  const done = new Promise<PrismaRun>((resolve) => child.on('close', (code) => resolve({ code: code ?? -1, output })))
  return { child, done }
}

export function prisma(db: string, dir: string, args = ['migrate', 'deploy']): Promise<PrismaRun> {
  return prismaSpawn(db, dir, args).done
}

const NOISE = /^(--|SET |SELECT pg_catalog\.set_config|\\restrict |\\unrestrict )/

function pgDump(db: string, extra: string[]) {
  checkName(db)
  const out = execFileSync('pg_dump', ['-h', PG.host, '-p', PG.port, '-U', PG.user, '--no-owner', '--no-privileges', ...extra, db], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
  return out
    .split('\n')
    .filter((l) => !NOISE.test(l) && l.trim() !== '')
    .join('\n')
}

/** Schema (with _prisma_migrations' DDL) and data (without its rows). */
export function snapshot(db: string) {
  return {
    schema: pgDump(db, ['--schema-only']),
    data: pgDump(db, ['--data-only', '--exclude-table-data=_prisma_migrations']),
  }
}

export function migrationRows(db: string) {
  return rows<{ migration_name: string; finished: boolean; rolled_back: boolean; steps: number; has_logs: boolean }>(
    db,
    `SELECT migration_name, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back,
            applied_steps_count AS steps, logs IS NOT NULL AS has_logs
       FROM _prisma_migrations ORDER BY started_at, migration_name`,
  )
}

export function rmDir(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true })
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function waitFor(check: () => boolean, what: string, timeoutMs = 30_000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (check()) return
    await sleep(50)
  }
  throw new Error(`timed out waiting for ${what}`)
}

/** An interactive psql session (stdin-driven) for concurrency tests. */
export function psqlSession(db: string, appName: string) {
  checkName(db)
  const child = spawn('psql', [...psqlArgs(db), '-At'], { env: { ...process.env, PGAPPNAME: appName } })
  let output = ''
  child.stdout.on('data', (d) => (output += d))
  child.stderr.on('data', (d) => (output += d))
  const done = new Promise<number>((resolve) => child.on('close', (code) => resolve(code ?? -1)))
  return {
    send: (text: string) => child.stdin.write(text + '\n'),
    end: () => child.stdin.end(),
    output: () => output,
    done,
  }
}

/** Seed users u1..uN (ids `u1`…). */
export function seedUsers(db: string, n: number) {
  sql(
    db,
    `INSERT INTO "User" ("id","email","passwordHash","updatedAt")
     SELECT 'u' || i, 'u' || i || '@test.local', 'x', now() FROM generate_series(1, ${n}) i`,
  )
}

/**
 * Test clock: replace public.atlas_now() in a TEST database with a version that
 * returns the value in atlas_test_clock when set (falls back to the real
 * expression otherwise). Production code is unchanged — it always calls
 * atlas_now(); only this disposable database answers differently.
 */
export function installTestClock(db: string) {
  sql(
    db,
    `CREATE TABLE IF NOT EXISTS atlas_test_clock (id int PRIMARY KEY CHECK (id = 1), t timestamp(3));
     INSERT INTO atlas_test_clock VALUES (1, NULL) ON CONFLICT (id) DO NOTHING;
     CREATE OR REPLACE FUNCTION public.atlas_now() RETURNS timestamp(3) LANGUAGE sql STABLE AS $$
       SELECT coalesce((SELECT t FROM atlas_test_clock WHERE id = 1),
                       date_trunc('milliseconds', now() AT TIME ZONE 'UTC')::timestamp(3)) $$;`,
  )
}

const iso = (d: Date) => d.toISOString().replace('T', ' ').replace('Z', '')

/** Set (or clear with null) the test clock of a database. */
export function setClock(db: string, at: Date | null) {
  sql(db, `UPDATE atlas_test_clock SET t = ${at ? `TIMESTAMP '${iso(at)}'` : 'NULL'} WHERE id = 1`)
}

export { iso as sqlTimestamp }

/** A timestamp as PostgreSQL prints timestamp(3)::text (fraction without trailing zeros). */
export function pgText(d: Date) {
  return iso(d).replace(/\.?0+$/, '')
}
