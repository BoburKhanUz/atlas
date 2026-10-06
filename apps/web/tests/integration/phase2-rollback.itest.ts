/**
 * RB-01..07 + CUT-04: rollback and roll-forward against the REAL Phase 2 build
 * (RB-07: legacy session lifetime across the cutover).
 *
 * Needs a built Phase 2 copy (PHASE2_DIR=<…/apps/web of the Phase 2 snapshot,
 * after `bun install && bun run build`) and this app built (`bun run build`).
 * Skipped otherwise. Both builds run as production servers on their own ports
 * against disposable `itest_rb_*` databases and temporary storage; all traffic
 * is real HTTP. The down script is run exactly as documented
 * (`psql --single-transaction -v ON_ERROR_STOP=1 -f …`).
 */
import crypto from 'crypto'
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'child_process'
import { existsSync, promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { legacyAbsoluteExpiresAt, preflightFamilies } from '@/server/session/maintenance'
import { PG, createDb, dbUrl, dropDb, enabled, installTestClock, migrationRows, rows, setClock, snapshot, sql } from './pg'

const PHASE2_DIR = process.env.PHASE2_DIR ?? ''
const NEW_DIR = path.resolve(__dirname, '../..')
const ROLLBACK_DIR = path.resolve(NEW_DIR, '../../docs/database/rollback')
const DOWN_SQL = path.join(ROLLBACK_DIR, 'down-session-families.sql')
// Applied after session_families by the new build; reversed first (Phase 4.0).
const DOWN_AI_USAGE = path.join(ROLLBACK_DIR, 'down-ai-usage.sql')
const runnable = enabled && !!PHASE2_DIR && existsSync(path.join(PHASE2_DIR, '.next/standalone/server.js')) && existsSync(path.join(NEW_DIR, '.next/standalone/server.js'))

const SECRETS = {
  JWT_SECRET: crypto.randomBytes(48).toString('base64'),
  MEDIA_SIGNING_SECRET: crypto.randomBytes(48).toString('base64'),
  SESSION_ENC_KEY: crypto.randomBytes(32).toString('base64'),
}
const PORTS = { phase2: 3211, next: 3212 }
const log: string[] = []
const note = (line: string) => log.push(line)

// ─── processes ────────────────────────────────────────────────────────────────

function migrate(dir: string, db: string) {
  const r = spawnSync(path.join(dir, 'node_modules/.bin/prisma'), ['migrate', 'deploy'], {
    cwd: dir,
    env: { ...process.env, DATABASE_URL: dbUrl(db), PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    encoding: 'utf8',
  })
  return { code: r.status ?? -1, output: `${r.stdout}${r.stderr}` }
}

interface Server {
  base: string
  stop(): Promise<void>
  output(): string
}

async function startServer(which: 'phase2' | 'next', db: string, storage: string): Promise<Server> {
  const dir = which === 'phase2' ? PHASE2_DIR : NEW_DIR
  const port = PORTS[which]
  let out = ''
  const child: ChildProcess = spawn('node', ['.next/standalone/server.js'], {
    cwd: dir,
    env: {
      ...process.env,
      ...SECRETS,
      NODE_ENV: 'production',
      // the new build fails closed without a real AI provider (Phase 4.0); Phase 2 ignores these
      AI_LLM_PROVIDER: 'mock',
      AI_ALLOW_MOCK_IN_PRODUCTION: '1',
      HOSTNAME: '127.0.0.1',
      PORT: String(port),
      DATABASE_URL: dbUrl(db),
      STORAGE_LOCAL_DIR: storage,
      COOKIE_SECURE: '0',
      WEATHER_PROVIDER: 'mock',
      LOG_LEVEL: 'warn',
      NEXT_TELEMETRY_DISABLED: '1',
    },
  })
  child.stdout?.on('data', (d) => (out += d))
  child.stderr?.on('data', (d) => (out += d))
  const base = `http://127.0.0.1:${port}`
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) break
    } catch {
      /* not up yet */
    }
    if (child.exitCode !== null) throw new Error(`${which} exited:\n${out}`)
    await new Promise((r) => setTimeout(r, 200))
  }
  return {
    base,
    output: () => out,
    stop: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null) return resolve()
        child.once('exit', () => resolve())
        child.kill('SIGTERM')
      }),
  }
}

/** Drops the AI quota table first, as docs/database/cutover.md says (rollback past Phase 4.0). */
function downAiUsage(db: string) {
  const r = downScript(db, DOWN_AI_USAGE)
  expect(r.code, r.output).toBe(0)
}

function downScript(db: string, file = DOWN_SQL, singleTransaction = true) {
  const args = [...(singleTransaction ? ['--single-transaction'] : []), '-X', '-v', 'ON_ERROR_STOP=1', '-h', PG.host, '-p', PG.port, '-U', PG.user, '-d', db, '-f', file]
  const r = spawnSync('psql', args, { encoding: 'utf8' })
  return { code: r.status ?? -1, output: `${r.stdout}${r.stderr}` }
}

// ─── a tiny browser: cookie jar + JSON / multipart helpers ───────────────────

class Client {
  cookies = new Map<string, string>()
  constructor(
    public base: string,
    public bearer?: string,
  ) {}
  on(base: string) {
    this.base = base
    return this
  }
  private absorb(res: Response) {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';')
      const i = pair.indexOf('=')
      const name = pair.slice(0, i).trim()
      const value = pair.slice(i + 1)
      if (attrs.some((a) => /max-age=0/i.test(a.trim())) || value === '') this.cookies.delete(name)
      else this.cookies.set(name, value)
    }
  }
  headers(extra: Record<string, string> = {}) {
    const h: Record<string, string> = { ...extra }
    if (this.cookies.size) h.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ')
    if (this.bearer) h.authorization = `Bearer ${this.bearer}`
    return h
  }
  async req(method: string, p: string, body?: unknown, extra: Record<string, string> = {}) {
    const res = await fetch(this.base + p, {
      method,
      redirect: 'manual',
      headers: this.headers({ ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...extra }),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    this.absorb(res)
    const text = await res.text()
    let json: Record<string, unknown> = {}
    try {
      json = JSON.parse(text)
    } catch {
      /* binary */
    }
    return { status: res.status, json, res }
  }
  async upload(file: Buffer, name: string, extra: Record<string, string> = {}) {
    const form = new FormData()
    form.append('file', new File([new Uint8Array(file)], name, { type: 'image/jpeg' }))
    const encoded = new Response(form)
    const body = Buffer.from(await encoded.arrayBuffer())
    const res = await fetch(this.base + '/api/v1/wardrobe/items', {
      method: 'POST',
      headers: this.headers({ 'content-type': encoded.headers.get('content-type')!, 'content-length': String(body.length), ...extra }),
      body,
    })
    this.absorb(res)
    return { status: res.status, json: (await res.json()) as Record<string, any> }
  }
  async getBinary(url: string) {
    const res = await fetch(new URL(url, this.base))
    return { status: res.status, type: res.headers.get('content-type'), bytes: Buffer.from(await res.arrayBuffer()) }
  }
}

const photo = (color: string) => sharp({ create: { width: 900, height: 1200, channels: 3, background: color } }).jpeg().toBuffer()
const email = (tag: string) => `rb_${tag}_${crypto.randomBytes(3).toString('hex')}@test.local`
const PASSWORD = 'rollback-password-1'
const hash = (t: string) => crypto.createHash('sha256').update(t).digest('hex')

async function account(c: Client, tag: string, headers: Record<string, string> = {}) {
  const e = email(tag)
  const r = await c.req('POST', '/api/v1/auth/register', { email: e, password: PASSWORD }, headers)
  expect(r.status, `${tag} register: ${JSON.stringify(r.json)}`).toBe(201)
  return { email: e, json: r.json }
}

async function fileExists(storage: string, key: string) {
  return existsSync(path.join(storage, key))
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe.skipIf(!runnable)('Phase 2 rollback and roll-forward (real builds)', () => {
  const dbs = ['itest_rb_cut', 'itest_rb_b', 'itest_rb_c', 'itest_rb_atom', 'itest_rb_ref', 'itest_rb_full', 'itest_rb_ref2', 'itest_rb_lt']
  const storages: string[] = []
  const mkStorage = async () => {
    const d = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-rb-'))
    storages.push(d)
    return d
  }
  let rb03: { code: number; output: string } | null = null

  beforeAll(() => {
    for (const db of dbs) createDb(db)
  })
  afterAll(async () => {
    console.log(['── rollback test notes ──', ...log].join('\n'))
    if (!process.env.ATLAS_ITEST_KEEP) {
      for (const db of dbs) dropDb(db)
      for (const s of storages) await fs.rm(s, { recursive: true, force: true })
    }
  })

  it('CUT-04: the Phase 2 build after the cutover (no rollback) cannot create sessions; media and other routes keep working', async () => {
    const db = 'itest_rb_cut'
    const storage = await mkStorage()
    expect(migrate(PHASE2_DIR, db).code).toBe(0)
    let p2 = await startServer('phase2', db, storage)
    const user = new Client(p2.base)
    await account(user, 'cut')
    const up = await user.upload(await photo('#335577'), 'shirt.jpg')
    expect(up.status).toBe(201)
    await p2.stop()
    const m = migrate(NEW_DIR, db)
    expect(m.code, m.output).toBe(0)

    p2 = await startServer('phase2', db, storage) // operator error: old build started after the cutover
    try {
      const fresh = new Client(p2.base)
      const reg = await fresh.req('POST', '/api/v1/auth/register', { email: email('cut2'), password: PASSWORD })
      const login = await fresh.req('POST', '/api/v1/auth/login', { email: (await rows<{ email: string }>(db, `SELECT "email" FROM "User" LIMIT 1`))[0].email, password: PASSWORD })
      const refresh = await user.on(p2.base).req('POST', '/api/v1/auth/refresh')
      note(`CUT-04 phase2-after-cutover: register ${reg.status} ${reg.json.code ?? ''}, login ${login.status} ${login.json.code ?? ''}, refresh ${refresh.status} ${refresh.json.code ?? ''}`)
      expect(login.status).toBe(500) // session insert violates familyId NOT NULL → fail closed
      expect(refresh.status).toBe(500) // rotation insert fails, whole transaction rolled back
      expect(sql(db, `SELECT count(*) FROM "Session" WHERE "familyId" IS NULL`)).toBe('0')
      // the user row from the failed register exists (Phase 2 creates it before the session), but no session
      expect(reg.status).toBe(500)
      // media and other routes work with the existing (stateless) access token
      const list = await user.req('GET', '/api/v1/wardrobe/items')
      expect(list.status).toBe(200)
      const img = await user.getBinary((list.json.items as any[])[0].primaryImage.url)
      expect(img.status).toBe(200)
    } finally {
      await p2.stop()
    }
  })

  it('RB-01 (R-B) + RB-03: migrated, no new-build traffic → down script → the real Phase 2 build works fully', async () => {
    const db = 'itest_rb_b'
    const storage = await mkStorage()
    expect(migrate(PHASE2_DIR, db).code).toBe(0)
    let p2 = await startServer('phase2', db, storage)
    const a = new Client(p2.base)
    await account(a, 'b')
    expect((await a.req('POST', '/api/v1/auth/refresh')).status).toBe(200)
    const up = await a.upload(await photo('#aa3333'), 'shirt.jpg')
    expect(up.status).toBe(201)
    await p2.stop()

    const m = migrate(NEW_DIR, db)
    expect(m.code, m.output).toBe(0)
    expect(sql(db, `SELECT count(*) FROM "Session" WHERE "familyId" IS NULL`)).toBe('0')

    downAiUsage(db)
    const before = snapshot(db)
    const down = downScript(db)
    expect(down.code, down.output).toBe(0)
    // exactly the session_families schema is gone; media + idempotency stay
    expect(migrationRows(db).map((r) => r.migration_name)).toEqual([
      '20261004000000_init', '20261005000000_sessions', '20261006000100_media_variants', '20261006000200_idempotency_keys',
    ])
    const ref = 'itest_rb_ref'
    expect(migrate(PHASE2_DIR, ref).code).toBe(0)
    // reference: Phase 2 schema + the two additive migrations, applied by the new build's files
    for (const name of ['20261006000100_media_variants', '20261006000200_idempotency_keys']) {
      execFileSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-h', PG.host, '-p', PG.port, '-U', PG.user, '-d', ref, '-f', path.join(NEW_DIR, 'prisma/migrations', name, 'migration.sql')])
    }
    const strip = (s: string) => s.split('\n').filter((l) => !/_prisma_migrations/.test(l)).join('\n')
    expect(strip(snapshot(db).schema)).toBe(strip(snapshot(ref).schema))
    expect(before.data).not.toBe(snapshot(db).data) // families were carried down and dropped

    // RB-03: the Phase 2 build's own migrate deploy against this database
    rb03 = migrate(PHASE2_DIR, db)
    note(`RB-03 phase2 'prisma migrate deploy' after down-session-families: exit ${rb03.code}\n${rb03.output.trim()}`)

    p2 = await startServer('phase2', db, storage)
    try {
      a.on(p2.base)
      expect((await a.req('POST', '/api/v1/auth/refresh')).status).toBe(200) // existing session continues
      expect((await a.req('GET', '/api/v1/auth/me')).status).toBe(200)
      const b = new Client(p2.base)
      await account(b, 'b2')
      const login = await new Client(p2.base).req('POST', '/api/v1/auth/login', { email: (await rows<{ email: string }>(db, `SELECT "email" FROM "User" ORDER BY "createdAt" LIMIT 1`))[0].email, password: PASSWORD })
      expect(login.status).toBe(200)
      const up2 = await b.upload(await photo('#33aa33'), 'pants.jpg')
      expect(up2.status).toBe(201)
      const list = await a.req('GET', '/api/v1/wardrobe/items')
      const item = (list.json.items as any[])[0]
      expect((await a.getBinary(item.primaryImage.url)).status).toBe(200)
      expect((await a.req('PATCH', `/api/v1/wardrobe/items/${item.id}`, { category: 'shirt' })).status).toBe(200)
      expect((await a.req('DELETE', `/api/v1/wardrobe/items/${item.id}`)).status).toBe(200)
      expect((await b.req('DELETE', '/api/v1/account')).status).toBe(200)
      expect(sql(db, `SELECT count(*) FROM "User" WHERE "email" LIKE 'rb_b2_%'`)).toBe('0')
    } finally {
      await p2.stop()
    }
  })

  it('RB-02 (R-C) → RB-04 roll forward: after new-build traffic, Phase 2 keeps web sessions, rejects ended/mobile ones; roll forward re-adopts everything; the sweep removes leftovers', async () => {
    const db = 'itest_rb_c'
    const storage = await mkStorage()
    expect(migrate(PHASE2_DIR, db).code).toBe(0)
    let p2 = await startServer('phase2', db, storage)
    const p = new Client(p2.base) // Phase 2-era user
    await account(p, 'p')
    expect((await p.req('POST', '/api/v1/auth/refresh')).status).toBe(200)
    expect((await p.upload(await photo('#123456'), 'shirt.jpg')).status).toBe(201)
    await p2.stop()

    expect(migrate(NEW_DIR, db).code).toBe(0)
    const nb = await startServer('next', db, storage)
    const w = new Client(nb.base) // web
    const mob = new Client(nb.base) // mobile
    const out = new Client(nb.base) // logged out
    const reused = new Client(nb.base) // family revoked for reuse
    const expired = new Client(nb.base) // family past its absolute limit
    const leaver = new Client(nb.base) // deletes the account under Phase 2 (cascade check)
    let mobileTokens: Record<string, string>
    let reusedOld = ''
    let loggedOutRt = ''
    let displayKey = ''
    try {
      expect((await p.on(nb.base).req('POST', '/api/v1/auth/refresh')).status).toBe(200) // legacy live tail rotates
      await account(w, 'w')
      expect((await w.req('POST', '/api/v1/auth/refresh')).status).toBe(200)
      const up = await w.upload(await photo('#654321'), 'jeans.jpg', { 'idempotency-key': 'rollback-test-key-1' })
      expect(up.status).toBe(201)
      expect((await w.upload(await photo('#654321'), 'jeans.jpg', { 'idempotency-key': 'rollback-test-key-1' })).status).toBe(201)
      displayKey = sql(db, `SELECT "displayKey" FROM "WardrobeImage" WHERE "wardrobeItemId" = '${up.json.item.id}'`)
      expect(await fileExists(storage, displayKey)).toBe(true)

      const mreg = await account(mob, 'm', { 'x-atlas-client': 'mobile' })
      mobileTokens = mreg.json as Record<string, string>
      await account(out, 'l')
      loggedOutRt = out.cookies.get('atlas_rt')!
      expect((await out.req('POST', '/api/v1/auth/logout')).status).toBe(200)
      await account(reused, 'r')
      reusedOld = reused.cookies.get('atlas_rt')!
      expect((await reused.req('POST', '/api/v1/auth/refresh')).status).toBe(200)
      sql(db, `UPDATE "Session" SET "rotatedAt" = "rotatedAt" - interval '2 minutes' WHERE "tokenHash" = '${hash(reusedOld)}'`)
      const attack = new Client(nb.base)
      attack.cookies.set('atlas_rt', reusedOld)
      expect((await attack.req('POST', '/api/v1/auth/refresh')).json.code).toBe('REFRESH_REUSED')
      await account(leaver, 'x')
      expect((await leaver.upload(await photo('#999999'), 'bag.jpg', { 'idempotency-key': 'rollback-test-key-2' })).status).toBe(201)
      await account(expired, 'e')
      const expRt = expired.cookies.get('atlas_rt')!
      sql(db, `UPDATE "SessionFamily" SET "absoluteExpiresAt" = (now() AT TIME ZONE 'UTC') - interval '1 minute' WHERE "id" = (SELECT "familyId" FROM "Session" WHERE "tokenHash" = '${hash(expRt)}')`)
    } finally {
      await nb.stop()
    }

    // ── rollback R-C ──
    downAiUsage(db)
    const down = downScript(db)
    expect(down.code, down.output).toBe(0)
    if (rb03 && rb03.code === 0) expect(migrate(PHASE2_DIR, db).code).toBe(0)
    p2 = await startServer('phase2', db, storage)
    try {
      for (const c of [w, mob, out, reused, expired, p, leaver]) c.on(p2.base)
      expect((await w.req('POST', '/api/v1/auth/refresh')).status).toBe(200) // web session keeps working
      expect((await p.req('POST', '/api/v1/auth/refresh')).status).toBe(200) // Phase 2-era user too
      const old = new Client(p2.base)
      old.cookies.set('atlas_rt', reusedOld)
      expect((await old.req('POST', '/api/v1/auth/refresh')).status).toBe(401) // reused token
      expect((await reused.req('POST', '/api/v1/auth/refresh')).status).toBe(401) // the family's newest token too
      expect((await expired.req('POST', '/api/v1/auth/refresh')).status).toBe(401) // past the absolute limit (expiresAt capped)
      const loggedOut = new Client(p2.base)
      loggedOut.cookies.set('atlas_rt', loggedOutRt)
      expect((await loggedOut.req('POST', '/api/v1/auth/refresh')).status).toBe(401) // logged out under the new build
      const mobAsCookie = new Client(p2.base)
      mobAsCookie.cookies.set('atlas_rt', mobileTokens!.refreshToken)
      expect((await mobAsCookie.req('POST', '/api/v1/auth/refresh')).status).toBe(401) // mobile sessions revoked
      const mobBearer = await new Client(p2.base, mobileTokens!.accessToken).req('GET', '/api/v1/auth/me')
      note(`RB-02: a mobile access token issued by the new build is accepted by Phase 2 until it expires: GET /auth/me → ${mobBearer.status} (documented ≤ 15 min limitation)`)

      // images: Phase 2 serves the master as url; the WebP thumbnail is readable
      const items = (await w.req('GET', '/api/v1/wardrobe/items')).json.items as any[]
      expect(items).toHaveLength(1)
      const img = await w.getBinary(items[0].primaryImage.url)
      expect(img.status).toBe(200)
      expect(img.type).toBe('image/jpeg')
      expect((await w.getBinary(items[0].primaryImage.thumbnailUrl)).type).toBe('image/webp')
      // deleting the item under Phase 2 leaves the display variant behind (cleaned by the sweep)
      expect((await w.req('DELETE', `/api/v1/wardrobe/items/${items[0].id}`)).status).toBe(200)
      expect(await fileExists(storage, displayKey)).toBe(true)
      // a new Phase 2 login + rotation (rows without a family, adopted at roll-forward)
      const p2user = new Client(p2.base)
      await account(p2user, 'p2era')
      expect((await p2user.req('POST', '/api/v1/auth/refresh')).status).toBe(200)
      // account deletion under Phase 2 cascades through the new tables and removes the storage directory
      const leaverId = sql(db, `SELECT "id" FROM "User" WHERE "email" LIKE 'rb_x_%'`)
      expect(sql(db, `SELECT count(*) FROM "IdempotencyKey" WHERE "userId" = '${leaverId}'`)).toBe('1')
      expect((await leaver.req('DELETE', '/api/v1/account')).status).toBe(200)
      expect(sql(db, `SELECT count(*) FROM "IdempotencyKey" WHERE "userId" = '${leaverId}'`)).toBe('0')
      expect(existsSync(path.join(storage, 'users', leaverId))).toBe(false)
    } finally {
      await p2.stop()
    }

    // ── RB-04 roll forward ──
    const f = migrate(NEW_DIR, db)
    expect(f.code, f.output).toBe(0)
    // only session_families and ai_usage were applied again; media + idempotency kept their original rows
    expect(migrationRows(db).map((r) => `${r.migration_name}:${r.finished}`)).toEqual([
      '20261004000000_init:true', '20261005000000_sessions:true', '20261006000100_media_variants:true',
      '20261006000200_idempotency_keys:true', '20261006000300_session_families:true', '20261007000000_ai_usage:true',
    ])
    expect(sql(db, `SELECT count(*) FROM "Session" WHERE "familyId" IS NULL`)).toBe('0')
    expect(Number(sql(db, `SELECT count(*) FROM "Session" WHERE "rotatedAtSource" = 'legacy'`))).toBeGreaterThan(0)
    const nb2 = await startServer('next', db, storage)
    try {
      const p2user = rows<{ email: string }>(db, `SELECT "email" FROM "User" WHERE "email" LIKE 'rb_p2era_%'`)[0]
      expect(p2user).toBeDefined()
      expect((await p.on(nb2.base).req('POST', '/api/v1/auth/refresh')).status).toBe(200) // re-adopted chain, live tail rotates
      const relog = await new Client(nb2.base).req('POST', '/api/v1/auth/login', { email: p2user.email, password: PASSWORD })
      expect(relog.status).toBe(200)
    } finally {
      await nb2.stop()
    }
    // storage sweep (dry run, then apply) removes the display file Phase 2 left behind
    const sweep = (apply: boolean) =>
      spawnSync('bun', ['scripts/storage-sweep.ts', '--json', '--min-age-minutes=0', ...(apply ? ['--apply'] : [])], {
        cwd: NEW_DIR,
        env: { ...process.env, DATABASE_URL: dbUrl(db), STORAGE_LOCAL_DIR: storage },
        encoding: 'utf8',
      })
    const dry = sweep(false)
    expect(dry.status, dry.stderr).toBe(0)
    expect(JSON.parse(dry.stdout).orphans).toContain(displayKey)
    expect(await fileExists(storage, displayKey)).toBe(true)
    const applied = sweep(true)
    expect(applied.status, applied.stderr).toBe(0)
    expect(await fileExists(storage, displayKey)).toBe(false)
    note(`RB-04 sweep: ${JSON.stringify({ ...JSON.parse(applied.stdout), orphans: JSON.parse(applied.stdout).orphans.length })}`)
  })

  it('RB-06: optional full reversal (idempotency, then media) returns exactly the Phase 2 schema; the scripts refuse the wrong order', async () => {
    const db = 'itest_rb_full'
    const storage = await mkStorage()
    expect(migrate(PHASE2_DIR, db).code).toBe(0)
    expect(migrate(NEW_DIR, db).code).toBe(0)
    const idem = path.join(ROLLBACK_DIR, 'down-idempotency-keys.sql')
    const media = path.join(ROLLBACK_DIR, 'down-media-variants.sql')
    // wrong order: later migrations still applied → refused, nothing changed
    const before = snapshot(db)
    for (const f of [DOWN_SQL, idem, media]) {
      const r = downScript(db, f)
      expect(r.code).not.toBe(0)
      expect(r.output).toMatch(/later migrations are applied/)
    }
    expect(snapshot(db)).toEqual(before)
    // right order
    for (const f of [DOWN_AI_USAGE, DOWN_SQL, idem, media]) {
      const r = downScript(db, f)
      expect(r.code, `${path.basename(f)}: ${r.output}`).toBe(0)
    }
    // the AI usage script refuses a second run (nothing to reverse)
    const again = downScript(db, DOWN_AI_USAGE)
    expect(again.code).not.toBe(0)
    expect(again.output).toMatch(/is not applied/)
    const ref = 'itest_rb_ref2'
    expect(migrate(PHASE2_DIR, ref).code).toBe(0)
    expect(snapshot(db).schema).toBe(snapshot(ref).schema)
    expect(migrationRows(db).map((r) => r.migration_name)).toEqual(['20261004000000_init', '20261005000000_sessions'])
    // the Phase 2 build sees nothing pending and works
    const r = migrate(PHASE2_DIR, db)
    expect(r.code).toBe(0)
    expect(r.output).toMatch(/No pending migrations to apply/)
    const p2 = await startServer('phase2', db, storage)
    try {
      const c = new Client(p2.base)
      await account(c, 'full')
      expect((await c.req('POST', '/api/v1/auth/refresh')).status).toBe(200)
      expect((await c.upload(await photo('#777777'), 'shirt.jpg')).status).toBe(201)
    } finally {
      await p2.stop()
    }
    // and roll forward again from there
    const f = migrate(NEW_DIR, db)
    expect(f.code, f.output).toBe(0)
    expect(sql(db, `SELECT count(*) FROM "Session" WHERE "familyId" IS NULL`)).toBe('0')
  })

  it('RB-07: legacy lifetime with the real builds — old Phase 2 chain gets cutover + 30 d, recent keeps start + 90 d; expiry, R-C rollback and roll forward', async () => {
    const db = 'itest_rb_lt'
    const DAY = 24 * 3600 * 1000
    const msq = (q: string) => Number(sql(db, `SELECT (extract(epoch FROM (${q})) * 1000)::bigint`))
    const maxAge = (r: { res: Response }) => {
      const c = r.res.headers.getSetCookie().find((l) => l.startsWith('atlas_rt='))
      return c ? Number(/max-age=(\d+)/i.exec(c)![1]) : null
    }
    const storage = await mkStorage()
    expect(migrate(PHASE2_DIR, db).code).toBe(0)
    let p2 = await startServer('phase2', db, storage)
    const oldU = new Client(p2.base)
    const newU = new Client(p2.base)
    // midU is only used at future test-clock times: its rows must not be rotated
    // by the Phase 2 build afterwards (real-time rows after future ones would be
    // a time inversion, which the roll forward correctly treats as an anomaly)
    const midU = new Client(p2.base)
    const oldAcc = await account(oldU, 'ltold')
    const newAcc = await account(newU, 'ltnew')
    await account(midU, 'ltmid')
    for (const c of [oldU, newU, midU]) expect((await c.req('POST', '/api/v1/auth/refresh')).status).toBe(200) // real Phase 2 chains of two rows
    await p2.stop()
    const uid = (e: string) => sql(db, `SELECT "id" FROM "User" WHERE "email" = '${e}'`)
    const [oldId, newId] = [uid(oldAcc.email), uid(newAcc.email)]
    // the Phase 2 build cannot produce a 200-day-old login: age that chain's rows
    sql(db, `UPDATE "Session" SET "createdAt" = "createdAt" - interval '200 days' WHERE "userId" = '${oldId}'`)
    const startOf = (id: string) => msq(`SELECT min("createdAt") FROM "Session" WHERE "userId" = '${id}'`)
    const [oldStart, newStart] = [startOf(oldId), startOf(newId)]

    const pf = new PrismaClient({ datasourceUrl: dbUrl(db) })
    try {
      const report = await preflightFamilies(pf)
      expect(report.legacyLifetime).toMatchObject({ transition: 1, fromChainStart: 2 })
    } finally {
      await pf.$disconnect()
    }

    const m = migrate(NEW_DIR, db)
    expect(m.code, m.output).toBe(0)
    const C = msq(`SELECT "value" FROM "SystemMarker" WHERE "key" = 'legacyCutoverAt'`)
    const absOf = (id: string) => msq(`SELECT max("absoluteExpiresAt") FROM "SessionFamily" WHERE "userId" = '${id}'`)
    expect(absOf(oldId)).toBe(C + 30 * DAY)
    expect(absOf(newId)).toBe(newStart + 90 * DAY)
    expect(absOf(oldId)).toBe(legacyAbsoluteExpiresAt(new Date(oldStart), new Date(C)).getTime())
    note(`RB-07 cutover ${new Date(C).toISOString()}: old chain (start ${new Date(oldStart).toISOString()}) limit ${new Date(absOf(oldId)).toISOString()}; recent chain limit ${new Date(absOf(newId)).toISOString()}`)

    installTestClock(db) // production atlas_now() replaced in this disposable database only
    const nb = await startServer('next', db, storage)
    try {
      oldU.on(nb.base)
      newU.on(nb.base)
      const r1 = await oldU.req('POST', '/api/v1/auth/refresh')
      expect(r1.status).toBe(200) // not logged out at the cutover
      const oldMax = maxAge(r1)!
      expect(oldMax).toBeLessThanOrEqual(30 * 86400)
      expect(oldMax).toBeGreaterThan(30 * 86400 - 600) // ≈ C + 30 d − now
      expect((await oldU.req('GET', '/api/v1/auth/me')).status).toBe(200)
      const r2 = await newU.req('POST', '/api/v1/auth/refresh')
      expect(r2.status).toBe(200)
      expect(maxAge(r2)).toBe(30 * 86400) // refresh TTL; its limit (start + 90 d) is later
      expect((await midU.on(nb.base).req('POST', '/api/v1/auth/refresh')).status).toBe(200)

      setClock(db, new Date(C + 30 * DAY - 1000))
      expect((await oldU.req('POST', '/api/v1/auth/refresh')).status).toBe(200) // last second of the transition
      setClock(db, new Date(C + 30 * DAY))
      const exp = await oldU.req('POST', '/api/v1/auth/refresh')
      expect([exp.status, exp.json.code]).toEqual([401, 'SESSION_EXPIRED'])
      expect(oldU.cookies.has('atlas_rt')).toBe(false) // terminal: cookies cleared
      expect(sql(db, `SELECT "revokeReason" FROM "SessionFamily" WHERE "userId" = '${oldId}' ORDER BY "createdAt" LIMIT 1`)).toBe('expired')
      expect((await midU.req('POST', '/api/v1/auth/refresh')).status).toBe(200) // recent chain (refreshed after the cutover) unaffected at C + 30 d
      setClock(db, null)
      // sign in again: a normal 90-day family
      const relog = await new Client(nb.base).req('POST', '/api/v1/auth/login', { email: oldAcc.email, password: PASSWORD }, { 'x-atlas-client': 'mobile' })
      expect(relog.status).toBe(200)
      expect(Date.parse(relog.json.sessionExpiresAt as string) - Date.parse(relog.json.accessTokenExpiresAt as string)).toBeGreaterThan(89 * DAY)
    } finally {
      await nb.stop()
    }

    // ── R-C rollback: the expired family stays dead under Phase 2, the recent one keeps working ──
    downAiUsage(db)
    const down = downScript(db)
    expect(down.code, down.output).toBe(0)
    p2 = await startServer('phase2', db, storage)
    try {
      expect((await new Client(p2.base).req('POST', '/api/v1/auth/login', { email: oldAcc.email, password: PASSWORD })).status).toBe(200)
      expect((await newU.on(p2.base).req('POST', '/api/v1/auth/refresh')).status).toBe(200)
      expect(sql(db, `SELECT count(*) FROM "Session" WHERE "userId" = '${oldId}' AND "revokedAt" IS NULL AND "createdAt" < TIMESTAMP '${new Date(C).toISOString().replace('T', ' ').replace('Z', '')}'`)).toBe('0')
    } finally {
      await p2.stop()
    }

    // ── roll forward: a new cutover, the same bounded rule ──
    const f = migrate(NEW_DIR, db)
    expect(f.code, f.output).toBe(0)
    const C2 = msq(`SELECT "value" FROM "SystemMarker" WHERE "key" = 'legacyCutoverAt'`)
    expect(C2).toBeGreaterThan(C)
    const fams = rows<{ created: string; abs: string }>(
      db,
      `SELECT (extract(epoch FROM "createdAt") * 1000)::bigint::text AS created, (extract(epoch FROM "absoluteExpiresAt") * 1000)::bigint::text AS abs FROM "SessionFamily"`,
    )
    for (const fam of fams) {
      expect(Number(fam.abs)).toBe(legacyAbsoluteExpiresAt(new Date(Number(fam.created)), new Date(C2)).getTime())
      expect(Number(fam.abs)).toBeLessThanOrEqual(C2 + 90 * DAY)
    }
    expect(sql(db, `SELECT count(*) FROM "SessionFamily" WHERE "userId" = '${oldId}' AND "revokedAt" IS NULL AND "createdAt" < TIMESTAMP '${new Date(C).toISOString().replace('T', ' ').replace('Z', '')}'`)).toBe('0')
    const nb2 = await startServer('next', db, storage)
    try {
      expect((await newU.on(nb2.base).req('POST', '/api/v1/auth/refresh')).status).toBe(200)
    } finally {
      await nb2.stop()
    }
  })

  it('RB-05: the down script is atomic and guarded', async () => {
    const db = 'itest_rb_atom'
    expect(migrate(PHASE2_DIR, db).code).toBe(0)
    sql(db, `INSERT INTO "User" ("id","email","passwordHash","updatedAt") VALUES ('u1','u1@test.local','x', now());
             INSERT INTO "Session" ("id","userId","tokenHash","expiresAt") VALUES ('s1','u1','h1', now() + interval '1 day')`)
    expect(migrate(NEW_DIR, db).code).toBe(0)
    downAiUsage(db)
    const before = snapshot(db)
    const beforeRows = migrationRows(db)

    // injected failure just before the end
    const text = await fs.readFile(DOWN_SQL, 'utf8')
    const broken = path.join(os.tmpdir(), `down-broken-${process.pid}.sql`)
    await fs.writeFile(broken, text.replace('DELETE FROM "_prisma_migrations"', 'SELECT 1/0;\nDELETE FROM "_prisma_migrations"'))
    const r1 = downScript(db, broken)
    expect(r1.code).not.toBe(0)
    expect(r1.output).toMatch(/division by zero/)
    expect(snapshot(db)).toEqual(before)
    expect(migrationRows(db)).toEqual(beforeRows)

    // without --single-transaction the LOCK refuses to run and nothing changes
    const r2 = downScript(db, DOWN_SQL, false)
    expect(r2.code).not.toBe(0)
    expect(r2.output).toMatch(/LOCK TABLE can only be used in transaction blocks/)
    expect(snapshot(db)).toEqual(before)

    // applied once: fine; a second run refuses
    expect(downScript(db).code).toBe(0)
    const again = downScript(db)
    expect(again.code).not.toBe(0)
    expect(again.output).toMatch(/session_families is not applied/)
    await fs.rm(broken, { force: true })
  })
})
