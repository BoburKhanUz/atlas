/**
 * Golden vectors for the Go port of auth and sessions (stage B2, parity
 * strength "exact": .claude/skills/lookly-testing/references/parity.md).
 *
 * Runs the real TypeScript functions on fixed and edge-case inputs and writes
 * {input, output} records. The Go tests (apps/api/internal/...) must
 * reproduce every output. Outputs contain random parts (IVs, salts, issue
 * times), so the file is generated ONCE per source commit and committed; a
 * mismatch in Go is investigated, never "regenerated away".
 *
 *   cd apps/web && bun scripts/golden-auth.ts ../api/testdata/golden/auth.json
 *
 * Every secret below is a fixed test value, used nowhere else.
 */
import { createHmac, randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const JWT_SECRET = 'golden-vector-jwt-secret-not-used-anywhere-else'
const ACTIVE_KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => i))
const OLD_KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => 255 - i))
const OTHER_KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 256))

process.env.JWT_SECRET = JWT_SECRET
delete process.env.ACCESS_TOKEN_TTL_SECONDS

const b64url = (v: string | Buffer) => Buffer.from(v).toString('base64url')

/** A compact JWT built by hand (for tokens the real signer never produces). */
function rawJwt(header: unknown, payload: unknown, secret = JWT_SECRET, alg: 'sha256' | 'sha512' | null = 'sha256'): string {
  const head = b64url(JSON.stringify(header))
  const body = b64url(typeof payload === 'string' ? payload : JSON.stringify(payload))
  const sig = alg ? createHmac(alg, secret).update(`${head}.${body}`).digest('base64url') : ''
  return `${head}.${body}.${sig}`
}

async function main() {
  const out = process.argv[2]
  if (!out) throw new Error('usage: bun scripts/golden-auth.ts <output.json>')

  const auth = await import('@/lib/auth')
  const { classifyRefresh, GRACE_WINDOW_MS } = await import('@/server/session/classify')
  const crypto = await import('@/server/session/successor-crypto')

  const nowSeconds = Math.floor(Date.now() / 1000)
  const FUTURE = 4102444800 // 2100-01-01
  const PAST = 978307200 // 2001-01-01
  const ISS = 'ai-fashion-stylist'
  const good = { sub: 'user_1', email: 'a@test.local', iss: ISS, iat: nowSeconds, exp: FUTURE }

  // ── token hashes ───────────────────────────────────────────────────────────
  const tokenHashes = ['', 'a', 'refresh-token', 'Zm9v_-bar', 'ўзбек', randomBytes(32).toString('base64url')].map((token) => ({
    token,
    sha256: auth.hashToken(token),
  }))

  // ── Authorization header ───────────────────────────────────────────────────
  const bearer = [
    null,
    '',
    'Bearer abc',
    'bearer abc',
    'BEARER   abc  ',
    'Bearer\tabc',
    'Bearer',
    'Bearer ',
    'Bearerabc',
    'Basic abc',
    ' Bearer abc',
    'Bearer a b c',
    'Bearer abc',
    'Token abc',
  ].map((header) => ({ header, token: auth.bearerToken(header) }))

  // ── JWT: what the real signer produces ─────────────────────────────────────
  const signed: unknown[] = []
  for (const input of [
    { payload: { sub: 'user_1', email: 'a@test.local', sid: 'sess_1' }, expiresAtMs: FUTURE * 1000 },
    { payload: { sub: 'cm1abc', email: 'aziza+test@example.uz' }, expiresAtMs: FUTURE * 1000 + 999 }, // floored to seconds
    { payload: { sub: 'u', email: 'o\'neil"quote@test.local', sid: 's' }, expiresAtMs: (FUTURE + 60) * 1000 },
    // Characters where JSON encoders differ (HTML characters, U+2028, control characters, non-ASCII).
    { payload: { sub: 'u2', email: 'a<b>&c\u2028\u0007\b\\ў@test.local' }, expiresAtMs: (FUTURE + 60) * 1000 },
  ]) {
    const token = await auth.signAccessToken(input.payload, { expiresAt: new Date(input.expiresAtMs) })
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as { iat: number; exp: number }
    signed.push({ ...input, iat: claims.iat, exp: claims.exp, token })
  }

  // ── JWT: what the real verifier accepts and refuses ────────────────────────
  const H = { alg: 'HS256' }
  const cases: Array<{ name: string; token: string }> = [
    { name: 'valid', token: rawJwt(H, good) },
    { name: 'valid with sid', token: rawJwt(H, { ...good, sid: 'sess_9' }) },
    { name: 'valid with typ header', token: rawJwt({ alg: 'HS256', typ: 'JWT' }, good) },
    { name: 'sid is not a string (dropped)', token: rawJwt(H, { ...good, sid: 42 }) },
    { name: 'extra claims ignored', token: rawJwt(H, { ...good, role: 'admin' }) },
    { name: 'fractional exp', token: rawJwt(H, { ...good, exp: FUTURE + 0.5 }) },
    { name: 'iat in the future', token: rawJwt(H, { ...good, iat: FUTURE - 10 }) },
    { name: 'no iat', token: rawJwt(H, { sub: good.sub, email: good.email, iss: ISS, exp: FUTURE }) },
    { name: 'expired', token: rawJwt(H, { ...good, exp: PAST }) },
    { name: 'no exp', token: rawJwt(H, { sub: good.sub, email: good.email, iss: ISS, iat: nowSeconds }) },
    { name: 'exp is a string', token: rawJwt(H, { ...good, exp: String(FUTURE) }) },
    { name: 'iat is a string', token: rawJwt(H, { ...good, iat: String(nowSeconds) }) },
    { name: 'nbf in the future', token: rawJwt(H, { ...good, nbf: FUTURE - 10 }) },
    { name: 'nbf in the past', token: rawJwt(H, { ...good, nbf: PAST }) },
    { name: 'nbf is a string', token: rawJwt(H, { ...good, nbf: String(PAST) }) },
    { name: 'wrong issuer', token: rawJwt(H, { ...good, iss: 'someone-else' }) },
    { name: 'no issuer', token: rawJwt(H, { sub: good.sub, email: good.email, iat: nowSeconds, exp: FUTURE }) },
    { name: 'issuer as an array', token: rawJwt(H, { ...good, iss: [ISS] }) },
    { name: 'no sub', token: rawJwt(H, { email: good.email, iss: ISS, iat: nowSeconds, exp: FUTURE }) },
    { name: 'sub is a number', token: rawJwt(H, { ...good, sub: 7 }) },
    { name: 'empty sub', token: rawJwt(H, { ...good, sub: '' }) },
    { name: 'no email', token: rawJwt(H, { sub: good.sub, iss: ISS, iat: nowSeconds, exp: FUTURE }) },
    { name: 'claim names in another case', token: rawJwt(H, { Sub: good.sub, Email: good.email, Iss: ISS, Exp: FUTURE }) },
    { name: 'alg none, no signature', token: rawJwt({ alg: 'none' }, good, JWT_SECRET, null) },
    { name: 'alg none, signed anyway', token: rawJwt({ alg: 'none' }, good) },
    { name: 'alg HS512', token: rawJwt({ alg: 'HS512' }, good, JWT_SECRET, 'sha512') },
    { name: 'alg hs256 lower case', token: rawJwt({ alg: 'hs256' }, good) },
    { name: 'alg missing', token: rawJwt({ typ: 'JWT' }, good) },
    { name: 'crit header', token: rawJwt({ alg: 'HS256', crit: ['exp'] }, good) },
    { name: 'wrong secret', token: rawJwt(H, good, 'another-secret-another-secret-another') },
    { name: 'payload is not an object', token: rawJwt(H, '"just a string"') },
    { name: 'payload is not JSON', token: rawJwt(H, '{not json') },
    { name: 'empty', token: '' },
    { name: 'not a token', token: 'not.a.token' },
    { name: 'two parts', token: rawJwt(H, good).split('.').slice(0, 2).join('.') },
    { name: 'four parts', token: `${rawJwt(H, good)}.extra` },
    { name: 'trailing space', token: `${rawJwt(H, good)} ` },
    { name: 'padded signature', token: `${rawJwt(H, good)}=` },
    { name: 'exp is null', token: rawJwt(H, { ...good, exp: null }) },
    { name: 'iat is null', token: rawJwt(H, { ...good, iat: null }) },
    { name: 'nbf is null', token: rawJwt(H, { ...good, nbf: null }) },
    { name: 'iat is true', token: rawJwt(H, { ...good, iat: true }) },
    { name: 'sub is null', token: rawJwt(H, { ...good, sub: null }) },
    { name: 'email is null', token: rawJwt(H, { ...good, email: null }) },
    { name: 'iss is null', token: rawJwt(H, { ...good, iss: null }) },
    { name: 'sid is null (dropped)', token: rawJwt(H, { ...good, sid: null }) },
    { name: 'payload is an array', token: rawJwt(H, '[]') },
    { name: 'payload is null', token: rawJwt(H, 'null') },
    { name: 'header is not an object', token: rawJwt('HS256', good) },
    { name: 'alg is null', token: rawJwt({ alg: null }, good) },
    {
      name: 'duplicate claim, the last one counts',
      token: rawJwt(H, `{"sub":"user_2","email":"a@test.local","iss":"${ISS}","exp":${FUTURE},"sub":"user_1"}`),
    },
    { name: 'white space around the payload', token: rawJwt(H, ` ${JSON.stringify(good)}\n`) },
  ]
  // A valid token with its payload swapped (signature no longer matches).
  const [gh, , gs] = rawJwt(H, good).split('.')
  cases.push({ name: 'tampered payload', token: `${gh}.${b64url(JSON.stringify({ ...good, sub: 'user_2' }))}.${gs}` })

  const verify: unknown[] = []
  for (const c of cases) verify.push({ ...c, payload: await auth.verifyAccessTokenOrNull(c.token) })

  // ── successor ciphertexts ──────────────────────────────────────────────────
  const keys = { active: ACTIVE_KEY, decryptOnly: [OLD_KEY] }
  const successor: unknown[] = []
  for (const [token, rotatedId, successorId] of [
    ['refresh-token-1', 'sess_a', 'sess_b'],
    [randomBytes(32).toString('base64url'), 'cm0000000000000000000001', 'cm0000000000000000000002'],
    ['', 'a', 'b'],
    ['ўзбекча матн', 'x|y', 'z'],
  ]) {
    const aad = crypto.successorAad(rotatedId, successorId)
    successor.push({ token, rotatedId, successorId, aad, value: crypto.encryptSuccessor(token, aad, keys) })
  }
  const aad = crypto.successorAad('sess_a', 'sess_b')
  const sample = crypto.encryptSuccessor('refresh-token-1', aad, keys)
  const withOld = crypto.encryptSuccessor('made-with-the-old-key', aad, { active: OLD_KEY, decryptOnly: [] })
  const withOther = crypto.encryptSuccessor('made-with-an-unknown-key', aad, { active: OTHER_KEY, decryptOnly: [] })
  const parts = sample.split('.')
  const flip = (s: string) => (s[0] === 'A' ? 'B' : 'A') + s.slice(1)
  const decrypt = [
    { name: 'active key', value: sample, aad },
    { name: 'decrypt-only key', value: withOld, aad },
    { name: 'unknown key', value: withOther, aad },
    { name: 'other rows (aad)', value: sample, aad: crypto.successorAad('sess_a', 'sess_c') },
    { name: 'tampered ciphertext', value: [parts[0], parts[1], parts[2], flip(parts[3]), parts[4]].join('.') },
    { name: 'tampered tag', value: [parts[0], parts[1], parts[2], parts[3], flip(parts[4])].join('.') },
    { name: 'tampered iv', value: [parts[0], parts[1], flip(parts[2]), parts[3], parts[4]].join('.') },
    { name: 'key id of another key, right key present', value: ['v1', '00000000', parts[2], parts[3], parts[4]].join('.') },
    { name: 'version v2', value: ['v2', ...parts.slice(1)].join('.') },
    { name: 'four parts', value: parts.slice(0, 4).join('.') },
    { name: 'six parts', value: `${sample}.x` },
    { name: 'empty', value: '' },
    { name: 'short tag', value: [parts[0], parts[1], parts[2], parts[3], parts[4].slice(0, 8)].join('.') },
  ].map((c) => ({ name: c.name, value: c.value, aad: c.aad ?? aad, plaintext: crypto.decryptSuccessor(c.value, c.aad ?? aad, keys) }))

  // ── refresh classification (every boundary) ───────────────────────────────
  const T = Date.UTC(2026, 10, 1, 12, 0, 0)
  const at = (ms: number | null) => (ms === null ? null : new Date(T + ms))
  const DAY = 86_400_000
  const classify: unknown[] = []
  const familyStates = [
    { revokedAt: null, absoluteExpiresAt: 30 * DAY, clientType: 'web' },
    { revokedAt: -1000, absoluteExpiresAt: 30 * DAY, clientType: 'web' },
    { revokedAt: null, absoluteExpiresAt: 0, clientType: 'web' }, // exactly at the limit
    { revokedAt: null, absoluteExpiresAt: 1, clientType: 'web' }, // 1 ms before the limit
    { revokedAt: null, absoluteExpiresAt: -1, clientType: 'web' },
    { revokedAt: null, absoluteExpiresAt: 30 * DAY, clientType: 'mobile' },
  ]
  const sessionStates = [
    { revokedAt: null, replacedById: null, expiresAt: DAY, rotatedAt: null, rotatedAtSource: null },
    { revokedAt: null, replacedById: null, expiresAt: 0, rotatedAt: null, rotatedAtSource: null },
    { revokedAt: null, replacedById: null, expiresAt: 1, rotatedAt: null, rotatedAtSource: null },
    { revokedAt: -5000, replacedById: null, expiresAt: DAY, rotatedAt: null, rotatedAtSource: null },
    ...[0, 1, GRACE_WINDOW_MS - 1, GRACE_WINDOW_MS, GRACE_WINDOW_MS + 1, DAY].map((ago) => ({
      revokedAt: -ago,
      replacedById: 'next',
      expiresAt: DAY,
      rotatedAt: -ago,
      rotatedAtSource: 'db',
    })),
    { revokedAt: -10, replacedById: 'next', expiresAt: DAY, rotatedAt: -10, rotatedAtSource: 'legacy' },
    { revokedAt: -10, replacedById: 'next', expiresAt: DAY, rotatedAt: null, rotatedAtSource: 'db' },
    { revokedAt: -10, replacedById: 'next', expiresAt: DAY, rotatedAt: -10, rotatedAtSource: null },
    { revokedAt: -10, replacedById: 'next', expiresAt: -DAY, rotatedAt: -10, rotatedAtSource: 'db' },
  ]
  const cutovers = [null, -GRACE_WINDOW_MS, -GRACE_WINDOW_MS - 1, -DAY]
  for (const f of familyStates) {
    for (const s of sessionStates) {
      for (const clientType of ['web', 'mobile'] as const) {
        for (const cut of cutovers) {
          const input = {
            t: new Date(T),
            family: { revokedAt: at(f.revokedAt), absoluteExpiresAt: new Date(T + f.absoluteExpiresAt), clientType: f.clientType },
            session: {
              revokedAt: at(s.revokedAt),
              replacedById: s.replacedById,
              expiresAt: new Date(T + s.expiresAt),
              rotatedAt: at(s.rotatedAt),
              rotatedAtSource: s.rotatedAtSource,
            },
            clientType,
            legacyCutoverAt: at(cut),
          }
          classify.push({ input, decision: classifyRefresh(input) })
        }
      }
    }
  }

  // ── cookie Max-Age (src/lib/session.ts secondsBetween) ─────────────────────
  const secondsBetween = (from: number, to: number) => Math.max(0, Math.ceil((to - from) / 1000))
  const cookieMaxAge = [
    [0, 0],
    [0, 1],
    [0, 999],
    [0, 1000],
    [0, 1001],
    [500, 900_000],
    [1000, 0],
    [123, 2_592_000_123],
  ].map(([fromMs, toMs]) => ({ fromMs, toMs, seconds: secondsBetween(fromMs, toMs) }))

  // ── passwords (bcryptjs, cost 10) ──────────────────────────────────────────
  const b72 = 'p'.repeat(72)
  const bcrypt: unknown[] = []
  for (const password of ['parol1234', 'Tошкент2026!', '', b72, `${b72}X`, `${'ў'.repeat(36)}`, `${'ў'.repeat(36)}tail`, 'a'.repeat(200)]) {
    const hash = await auth.hashPassword(password)
    const candidates = [password, `${password}x`, password.slice(0, -1), `${b72}Y`, b72, 'wrong']
    const matches: unknown[] = []
    for (const candidate of [...new Set(candidates)]) matches.push({ candidate, ok: await auth.verifyPassword(candidate, hash) })
    bcrypt.push({ password, bytes: Buffer.byteLength(password, 'utf8'), hash, matches })
  }

  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const doc = {
    generatedBy: 'apps/web/scripts/golden-auth.ts',
    sourceCommit,
    note: 'Test vectors. Every secret here is a fixed test value used nowhere else.',
    generatedAtSeconds: nowSeconds,
    issuer: ISS,
    jwtSecret: JWT_SECRET,
    sessionKeys: { active: ACTIVE_KEY.toString('base64'), decryptOnly: [OLD_KEY.toString('base64')] },
    graceWindowMs: GRACE_WINDOW_MS,
    tokenHashes,
    bearer,
    jwt: { signed, verify },
    successor: { encrypted: successor, decrypt },
    classify,
    cookieMaxAge,
    bcrypt,
  }
  writeFileSync(out, `${JSON.stringify(doc, null, 1)}\n`)
  console.log(`wrote ${out}: ${verify.length} JWT cases, ${classify.length} classifications, ${bcrypt.length} passwords`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
