/**
 * Golden vectors for the Go port of signed media links (stage B4, parity
 * strength "exact": a link one server signs must open on the other).
 *
 * Runs the real signMedia and verifyMediaSignature with a fixed test secret
 * (used nowhere else) and fixed clocks.
 *
 *   cd apps/web && bun scripts/golden-media.ts ../api/testdata/golden/media.json
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const out = process.argv[2]
if (!out) throw new Error('usage: bun scripts/golden-media.ts <output.json>')

const SECRET = 'golden-media-secret-golden-media-secret-0123'
process.env.MEDIA_SIGNING_SECRET = SECRET
const { signMedia, verifyMediaSignature } = await import('@/lib/storage/media')
const { isValidStorageKey } = await import('@/lib/storage/provider')

const KEYS = [
  'users/cabc123/0f8fad5b-d9cb-469f-a165-70867728950e.jpg',
  'users/cabc123/0f8fad5b-d9cb-469f-a165-70867728950e_display.webp',
  'users/cabc123/0f8fad5b-d9cb-469f-a165-70867728950e_thumb.webp',
  'users/A-b_9/7c9e6679-7425-40de-944b-e07fc1f90ae7.png',
  'users/cabc123/7c9e6679-7425-40de-944b-e07fc1f90ae7_thumb.jpg', // Phase 2 thumbnail
]
const NOW = Date.UTC(2026, 10, 26, 8, 0, 0, 123)

const signed: unknown[] = []
for (const baseUrl of [undefined, 'https://lookly.example.uz']) {
  if (baseUrl) process.env.PUBLIC_BASE_URL = baseUrl
  else delete process.env.PUBLIC_BASE_URL
  for (const ttl of [undefined, '60', '86400']) {
    if (ttl) process.env.MEDIA_URL_TTL_SECONDS = ttl
    else delete process.env.MEDIA_URL_TTL_SECONDS
    for (const key of KEYS) {
      const s = signMedia(key, NOW)
      signed.push({ publicBaseUrl: baseUrl ?? null, ttlSeconds: ttl ?? null, now: NOW, key, url: s.url, expiresAt: s.expiresAt.toISOString() })
    }
  }
}
delete process.env.PUBLIC_BASE_URL
delete process.env.MEDIA_URL_TTL_SECONDS

const good = signMedia(KEYS[0], NOW)
const params = new URL(good.url, 'http://x').searchParams
const exp = params.get('exp')!
const sig = params.get('sig')!
const nowSec = Math.floor(NOW / 1000)
const checks: Array<{ name: string; key: string; exp: string | null; sig: string | null; now: number }> = [
  { name: 'as signed', key: KEYS[0], exp, sig, now: NOW },
  { name: 'at the second it expires', key: KEYS[0], exp, sig, now: (nowSec + 3600) * 1000 + 999 },
  { name: 'one second later', key: KEYS[0], exp, sig, now: (nowSec + 3601) * 1000 },
  { name: 'another key', key: KEYS[1], exp, sig, now: NOW },
  { name: 'another expiry', key: KEYS[0], exp: String(Number(exp) + 1), sig, now: NOW },
  { name: 'signature changed in its last character', key: KEYS[0], exp, sig: sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A'), now: NOW },
  { name: 'signature in padded base64', key: KEYS[0], exp, sig: Buffer.from(sig, 'base64url').toString('base64'), now: NOW },
  { name: 'signature cut short', key: KEYS[0], exp, sig: sig.slice(0, 10), now: NOW },
  { name: 'no signature', key: KEYS[0], exp, sig: null, now: NOW },
  { name: 'empty signature', key: KEYS[0], exp, sig: '', now: NOW },
  { name: 'no expiry', key: KEYS[0], exp: null, sig, now: NOW },
  { name: 'expiry with a sign', key: KEYS[0], exp: `+${exp}`, sig, now: NOW },
  { name: 'expiry of 13 digits', key: KEYS[0], exp: '1' + exp.padStart(12, '0'), sig, now: NOW },
  { name: 'expiry with leading zeros', key: KEYS[0], exp: `0${exp}`, sig, now: NOW },
  { name: 'a key we never generate', key: 'users/cabc123/../secret.jpg', exp, sig, now: NOW },
  { name: 'the master key of the other user', key: 'users/cother/0f8fad5b-d9cb-469f-a165-70867728950e.jpg', exp, sig, now: NOW },
]
const verified = checks.map((c) => ({ ...c, valid: verifyMediaSignature(c.key, c.exp, c.sig, c.now) }))
// Leading zeros: the HMAC is over the number, so "0<exp>" signs the same.
const keyPatterns = [
  ...KEYS,
  'users/cabc123/0F8FAD5B-D9CB-469F-A165-70867728950E.jpg',
  'users/cabc123/0f8fad5b-d9cb-469f-a165-70867728950e.jpeg',
  'users/cabc123/0f8fad5b-d9cb-469f-a165-70867728950e_display.png',
  'users/cabc123/0f8fad5b-d9cb-469f-a165-70867728950e.gif',
  'users//0f8fad5b-d9cb-469f-a165-70867728950e.jpg',
  `users/${'a'.repeat(64)}/0f8fad5b-d9cb-469f-a165-70867728950e.jpg`,
  `users/${'a'.repeat(65)}/0f8fad5b-d9cb-469f-a165-70867728950e.jpg`,
  'users/c.b/0f8fad5b-d9cb-469f-a165-70867728950e.jpg',
  'other/cabc/0f8fad5b-d9cb-469f-a165-70867728950e.jpg',
  'users/cabc/0f8fad5b-d9cb-469f-a165-70867728950e.jpg/x',
  '/users/cabc/0f8fad5b-d9cb-469f-a165-70867728950e.jpg',
  'users/cabc/0f8fad5b-d9cb-469f-a165-70867728950e.jpg\n',
  'users/cabc/0f8fad5bd9cb469fa16570867728950e.jpg',
  '',
].map((key) => ({ key, valid: isValidStorageKey(key) }))

const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
writeFileSync(
  out,
  JSON.stringify(
    {
      generatedBy: 'apps/web/scripts/golden-media.ts',
      sourceCommit,
      note: 'secret is a fixed test value used nowhere else. signed: signMedia(key, now) with PUBLIC_BASE_URL and MEDIA_URL_TTL_SECONDS as given (null: unset). verified: verifyMediaSignature(key, exp, sig, now); now in milliseconds. keys: isValidStorageKey.',
      secret: SECRET,
      signed,
      verified,
      keys: keyPatterns,
    },
    null,
    1,
  ) + '\n',
)
console.log(`wrote ${signed.length} signed, ${verified.length} checks, ${keyPatterns.length} keys`)
