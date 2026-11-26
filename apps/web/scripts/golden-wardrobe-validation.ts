/**
 * Golden vectors for the Go port of request validation in the wardrobe
 * (stage B4, parity strength "exact": .claude/skills/lookly-testing/references/parity.md):
 * the correction body (PATCH /wardrobe/items/{id}), the list query, the item
 * id in the path and the Idempotency-Key header.
 *
 * Runs the real parseJson / validate / idempotencyKeyOf on raw inputs and
 * records the outcome: the parsed value, or the error envelope's code,
 * message and details.
 *
 *   cd apps/web && bun scripts/golden-wardrobe-validation.ts ../api/testdata/golden/wardrobe-validation.json
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import type { ZodType } from 'zod'
import { ApiError, parseJson, validate } from '@/server/http'
import { idempotencyKeyOf } from '@/server/idempotency'
import { idParamsSchema } from '@/server/schemas/common'
import { WardrobeItemPatchRequest, WardrobeListQuery } from '@/server/schemas/requests'
import { CATEGORIES, COLORS, FITS, FORMALITIES, GENDERS, MATERIALS, PATTERNS, SEASONS, SLEEVE_LENGTHS, STYLES, SUBCATEGORIES } from '@/lib/ai/catalog'

const out = process.argv[2]
if (!out) throw new Error('usage: bun scripts/golden-wardrobe-validation.ts <output.json>')

type Case = { name: string; body: string }
const json = (name: string, value: unknown): Case => ({ name, body: JSON.stringify(value) })
const raw = (name: string, body: string): Case => ({ name, body })

const WRONG_TYPES: Array<[string, unknown]> = [
  ['null', null],
  ['a number', 7],
  ['true', true],
  ['a string', 'text'],
  ['an array', ['x']],
  ['an object', { a: 1 }],
]

const notAnObject: Case[] = [
  raw('an empty body', ''),
  raw('white space only', '  \n'),
  raw('not JSON', '{category'),
  raw('two JSON values', '{}{}'),
  raw('JSON null', 'null'),
  raw('a JSON array', '[]'),
  raw('a JSON number', '12'),
  raw('an empty object', '{}'),
]

// ── correction body ─────────────────────────────────────────────────────────
const SINGLE: Array<[string, readonly { id: string }[], boolean]> = [
  // field, vocabulary, nullable
  ['category', CATEGORIES, false],
  ['subcategory', Object.values(SUBCATEGORIES).flat(), true],
  ['pattern', PATTERNS, true],
  ['material', MATERIALS, true],
  ['sleeveLength', SLEEVE_LENGTHS, true],
  ['fit', FITS, true],
  ['style', STYLES, true],
  ['gender', GENDERS, true],
  ['formality', FORMALITIES, true],
]
const colors = COLORS.map((c) => c.id)
const seasons = SEASONS.map((s) => s.id)
const patch: Case[] = [
  ...notAnObject,
  json('every field', {
    category: 'pants', subcategory: 'jeans', colors: ['blue', 'white'], pattern: PATTERNS[0].id, material: MATERIALS[0].id,
    sleeveLength: null, fit: FITS[1].id, style: STYLES[0].id, season: ['spring', 'autumn'], gender: GENDERS[0].id, formality: FORMALITIES[0].id,
  }),
  json('unknown fields are dropped', { material: MATERIALS[1].id, wasCorrected: false, userId: 'someone', images: [] }),
  ...SINGLE.flatMap(([field, vocab, nullable]) => [
    json(`${field}: the first value`, { [field]: vocab[0].id }),
    json(`${field}: the last value`, { [field]: vocab[vocab.length - 1].id }),
    json(`${field}: unknown`, { [field]: 'nope' }),
    json(`${field}: upper case`, { [field]: vocab[0].id.toUpperCase() }),
    json(`${field}: with a space`, { [field]: ` ${vocab[0].id}` }),
    json(`${field}: empty`, { [field]: '' }),
    json(`${field}: null${nullable ? '' : ' (not allowed)'}`, { [field]: null }),
    ...WRONG_TYPES.filter(([l]) => l !== 'null' && l !== 'a string').map(([label, value]) => json(`${field} is ${label}`, { [field]: value })),
  ]),
  json('colors: empty', { colors: [] }),
  json('colors: five', { colors: colors.slice(0, 5) }),
  json('colors: six', { colors: colors.slice(0, 6) }),
  json('colors: a repeat (kept)', { colors: ['red', 'red'] }),
  json('colors: unknown inside', { colors: ['red', 'nope', 7] }),
  json('colors: null', { colors: null }),
  json('colors: a string', { colors: 'red' }),
  json('colors: seven unknown (problems in item order, then the length)', { colors: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }),
  json('season: four', { season: seasons }),
  json('season: five', { season: [...seasons, seasons[0]] }),
  json('season: empty', { season: [] }),
  json('season: unknown', { season: ['monsoon'] }),
  json('season: null', { season: null }),
  json('problems everywhere: reported in schema order', {
    formality: 'x', gender: 'x', season: 'x', style: 'x', fit: 'x', sleeveLength: 'x', material: 'x', pattern: 'x', colors: 'x', subcategory: 'x', category: 'x',
  }),
  raw('a field twice: the last one counts', '{"material":"nope","material":"' + MATERIALS[0].id + '"}'),
  raw('member names are matched exactly', '{"Category":"pants","CATEGORY":"x"}'),
]

// ── list query (each parameter as the route reads it: absent when empty) ─────
type QueryCase = { name: string; query: Record<string, string> }
const q = (name: string, query: Record<string, string>): QueryCase => ({ name, query })
const queries: QueryCase[] = [
  q('nothing', {}),
  q('every category', { category: 'all' }),
  ...CATEGORIES.map((c) => q(`category ${c.id}`, { category: c.id })),
  q('category unknown', { category: 'hats' }),
  q('category upper case', { category: 'Shirt' }),
  q('limit 1', { limit: '1' }),
  q('limit 200', { limit: '200' }),
  q('limit 0', { limit: '0' }),
  q('limit 201', { limit: '201' }),
  q('limit -5', { limit: '-5' }),
  q('limit 1.5', { limit: '1.5' }),
  q('limit 10.0', { limit: '10.0' }),
  q('limit 1e2', { limit: '1e2' }),
  q('limit 0x10', { limit: '0x10' }),
  q('limit with spaces', { limit: ' 20 ' }),
  q('limit abc', { limit: 'abc' }),
  q('limit Infinity', { limit: 'Infinity' }),
  q('limit 9e999', { limit: '9e999' }),
  // How JavaScript's Number() reads a string (the validator coerces with it).
  ...['+5', '-0', '.5e1', '5.', '50e-1', '1e-2', '1_0', '0b101', '0o17', '0X1f', '-0x10', '0x', '0b2', ' 0x10 ', '\u00a020\u2003', '\t7\n', '+Infinity', '-Infinity', 'infinity', 'NaN', '1e', '--5', '5 5', '٣', '   ', '\ufeff20', '0x-10', '0x+1f'].map((limit) =>
    q(`limit ${JSON.stringify(limit)}`, { limit }),
  ),
  q('cursor', { cursor: 'cabc123' }),
  q('cursor with spaces (trimmed)', { cursor: '  cabc123  ' }),
  q('cursor of spaces', { cursor: '   ' }),
  q('cursor of 64', { cursor: 'c'.repeat(64) }),
  q('cursor of 65', { cursor: 'c'.repeat(65) }),
  q('cursor of 64 and spaces', { cursor: ` ${'c'.repeat(64)} ` }),
  q('everything wrong', { category: 'x', limit: 'x', cursor: 'c'.repeat(70) }),
  q('unknown parameter', { sort: 'asc' }),
]

// ── item id in the path ─────────────────────────────────────────────────────
const ids = ['cabc', ' cabc ', '   ', 'c'.repeat(64), 'c'.repeat(65), `${'c'.repeat(64)} `, 'ўзбек', 'a/b', 'a%2Fb', '..']

// ── Idempotency-Key header ──────────────────────────────────────────────────
const keys: Array<string | null> = [
  null, '', 'abcdefgh', 'abcdefg', 'A'.repeat(128), 'A'.repeat(129), 'key_with-dash_123', 'key with space', 'key.dot.is.bad', ' abcdefgh', 'abcdefgh ',
]

async function runBodies<T>(schema: ZodType<T>, cases: Case[]) {
  const results: unknown[] = []
  for (const c of cases) {
    const req = new Request('http://internal.invalid/', { method: 'PATCH', body: c.body === '' ? undefined : c.body })
    try {
      results.push({ ...c, ok: true, value: await parseJson(req, schema) })
    } catch (err) {
      if (!(err instanceof ApiError)) throw err
      results.push({ ...c, ok: false, status: err.status, code: err.code, error: err.message, details: err.details ?? [] })
    }
  }
  return results
}

function outcome(fn: () => unknown) {
  try {
    return { ok: true, value: fn() }
  } catch (err) {
    if (!(err instanceof ApiError)) throw err
    return { ok: false, status: err.status, code: err.code, error: err.message, details: err.details ?? [] }
  }
}

const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const sections = {
  patch: await runBodies(WardrobeItemPatchRequest, patch),
  query: queries.map((c) => ({ ...c, ...outcome(() => validate(c.query, WardrobeListQuery)) })),
  id: ids.map((id) => ({ id, ...outcome(() => validate({ id }, idParamsSchema)) })),
  idempotencyKey: keys.map((key) => {
    const headers = new Headers()
    if (key !== null) headers.set('Idempotency-Key', key)
    return { key, ...outcome(() => idempotencyKeyOf(new Request('http://internal.invalid/', { method: 'POST', headers }))) }
  }),
}
writeFileSync(
  out,
  JSON.stringify(
    {
      generatedBy: 'apps/web/scripts/golden-wardrobe-validation.ts',
      sourceCommit,
      note: 'patch: raw bodies through parseJson. query: the parameters the route passes (an empty one is absent) through validate. id: the path id. idempotencyKey: the header (null: absent; the Headers API trims a value).',
      ...sections,
    },
    null,
    1,
  ) + '\n',
)
console.log(`wrote ${out}: ${Object.entries(sections).map(([k, v]) => `${v.length} ${k}`).join(', ')}`)
