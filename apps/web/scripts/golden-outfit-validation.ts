/**
 * Golden vectors for the Go port of request validation in the outfit and
 * weather routes (stage B5, parity strength "exact"): the bodies of
 * POST /outfits/generate, POST /outfits, PATCH /outfits/{id} and
 * POST /outfits/{id}/feedback, the query of GET /outfits and of
 * GET /weather/current.
 *
 * Runs the real parseJson / validate on raw inputs and records the outcome:
 * the parsed value, or the error envelope's code, message and details.
 *
 *   cd apps/web && bun scripts/golden-outfit-validation.ts ../api/testdata/golden/outfit-validation.json
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import type { ZodType } from 'zod'
import { ApiError, parseJson, validate } from '@/server/http'
import { OutfitFeedbackRequest, OutfitGenerateRequest, OutfitListQuery, OutfitPatchRequest, OutfitSaveRequest, WeatherQuery } from '@/server/schemas/requests'
import { OCCASIONS } from '@/lib/ai/catalog'

const out = process.argv[2]
if (!out) throw new Error('usage: bun scripts/golden-outfit-validation.ts <output.json>')

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
  raw('not JSON', '{occasion'),
  raw('two JSON values', '{}{}'),
  raw('JSON null', 'null'),
  raw('a JSON array', '[]'),
  raw('a JSON number', '12'),
  raw('an empty object', '{}'),
]

const weather = { temperature: 21.5, feelsLike: 20, condition: 'clear', precipitationProbability: 10, humidity: 40, windSpeed: 12, uvIndex: 5 }
const without = (key: string) => Object.fromEntries(Object.entries(weather).filter(([k]) => k !== key))

/** The cases of a member that is an occasion or null. */
const occasionCases = (wrap: (occasion: unknown) => unknown): Case[] => [
  ...OCCASIONS.map((o) => json(`occasion ${o.id}`, wrap(o.id))),
  ...WRONG_TYPES.map(([name, value]) => json(`occasion ${name}`, wrap(value))),
  json('occasion unknown', wrap('party')),
  json('occasion in upper case', wrap('Work')),
  json('occasion empty', wrap('')),
]

/** The cases of a member that is a weather snapshot or null. */
const weatherCases = (wrap: (weather: unknown) => unknown): Case[] => [
  json('weather whole', wrap(weather)),
  json('weather with a member more', wrap({ ...weather, pressure: 1013 })),
  ...WRONG_TYPES.filter(([name]) => name !== 'an object').map(([name, value]) => json(`weather ${name}`, wrap(value))),
  json('weather empty', wrap({})),
  ...Object.keys(weather).map((key) => json(`weather without ${key}`, wrap(without(key)))),
  ...Object.keys(weather).flatMap((key) => [
    json(`weather ${key} null`, wrap({ ...weather, [key]: null })),
    json(`weather ${key} of another type`, wrap({ ...weather, [key]: key === 'condition' ? 5 : '5' })),
  ]),
  ...(
    [
      ['temperature', -90, 70],
      ['feelsLike', -100, 80],
      ['precipitationProbability', 0, 100],
      ['humidity', 0, 100],
      ['windSpeed', 0, 500],
      ['uvIndex', 0, 30],
    ] as Array<[string, number, number]>
  ).flatMap(([key, min, max]) =>
    [min, min - 0.5, max, max + 0.5].map((value) => json(`weather ${key} ${value}`, wrap({ ...weather, [key]: value }))),
  ),
  json('weather condition empty', wrap({ ...weather, condition: '' })),
  json('weather condition of spaces', wrap({ ...weather, condition: '   ' })),
  json('weather condition trimmed', wrap({ ...weather, condition: '  rain \n' })),
  json('weather condition of 40 characters', wrap({ ...weather, condition: 'c'.repeat(40) })),
  json('weather condition of 41 characters', wrap({ ...weather, condition: 'c'.repeat(41) })),
  json('weather with everything wrong', wrap({ temperature: 99, feelsLike: 'x', condition: '', humidity: -1 })),
  raw('weather temperature past the largest number', JSON.stringify(wrap({ ...weather, temperature: 0 })).replace('"temperature":0', '"temperature":1e400')),
]

// ── POST /outfits/generate ──────────────────────────────────────────────────
const generate: Case[] = [
  ...notAnObject,
  json('members that are not known', { other: 1, wardrobe: [] }),
  ...occasionCases((occasion) => ({ occasion })),
  ...weatherCases((w) => ({ weather: w })),
  ...[-90, 90, -90.5, 90.5, 0, 41.311].map((lat) => json(`lat ${lat}`, { lat })),
  ...[-180, 180, -180.5, 180.5, 0, 69.24].map((lon) => json(`lon ${lon}`, { lon })),
  ...WRONG_TYPES.map(([name, value]) => json(`lat ${name}`, { lat: value })),
  ...WRONG_TYPES.map(([name, value]) => json(`lon ${name}`, { lon: value })),
  json('lat and lon', { lat: 41.31, lon: 69.24 }),
  ...[0, 1, -5, 1.5, 123456789, 1e21, -1e-7, 9007199254740993].map((seed) => json(`seed ${seed}`, { seed })),
  ...WRONG_TYPES.map(([name, value]) => json(`seed ${name}`, { seed: value })),
  raw('seed past the largest number', '{"seed":1e400}'),
  raw('seed negative past the largest number', '{"seed":-1e400}'),
  ...[1, 2, 3, 4, 5, 0, 6, -1, 2.5, 1e20].map((topN) => json(`topN ${topN}`, { topN })),
  ...WRONG_TYPES.map(([name, value]) => json(`topN ${name}`, { topN: value })),
  json('everything', { occasion: 'work', weather, lat: 41.31, lon: 69.24, seed: 7, topN: 5 }),
  json('everything null that may be', { occasion: null, weather: null, lat: null, lon: null }),
  json('everything wrong', { occasion: 'x', weather: 'x', lat: 'x', lon: 200, seed: 'x', topN: 9 }),
  raw('a member twice (the last counts)', '{"topN":9,"topN":2}'),
]

// ── POST /outfits ───────────────────────────────────────────────────────────
const items = [
  { itemId: 'cshirt', role: 'top' },
  { itemId: 'cpants', role: 'bottom' },
  { itemId: 'cshoes', role: 'shoes' },
]
const save: Case[] = [
  ...notAnObject,
  json('the items only', { items }),
  json('members that are not known', { items, other: 1 }),
  json('everything', { items, occasion: 'date', weather, name: 'Kechki', score: 87.5, reasons: ['weather', 'occasion'], explanation: 'Yaxshi', isSaved: true }),
  json('everything null that may be', { items, occasion: null, weather: null, name: null, score: null, explanation: null }),
  ...WRONG_TYPES.map(([name, value]) => json(`items ${name}`, { items: value })),
  json('items empty', { items: [] }),
  json('items of 12', { items: Array.from({ length: 12 }, (_, i) => ({ itemId: `c${i}`, role: 'top' })) }),
  json('items of 13', { items: Array.from({ length: 13 }, (_, i) => ({ itemId: `c${i}`, role: 'top' })) }),
  ...WRONG_TYPES.filter(([name]) => name !== 'an object').map(([name, value]) => json(`an item ${name}`, { items: [items[0], value] })),
  json('an item empty', { items: [{}] }),
  json('an item with a member more', { items: [{ ...items[0], note: 'x' }] }),
  ...WRONG_TYPES.filter(([name]) => name !== 'a string').map(([name, value]) => json(`itemId ${name}`, { items: [{ itemId: value, role: 'top' }] })),
  ...WRONG_TYPES.filter(([name]) => name !== 'a string').map(([name, value]) => json(`role ${name}`, { items: [{ itemId: 'c1', role: value }] })),
  ...['', '   ', ' c1 ', 'c'.repeat(64), 'c'.repeat(65)].map((itemId) => json(`itemId ${JSON.stringify(itemId).slice(0, 12)} (${itemId.length})`, { items: [{ itemId, role: 'top' }] })),
  ...['', '   ', ' top ', 'r'.repeat(30), 'r'.repeat(31), 'no_such_role'].map((role) => json(`role ${JSON.stringify(role).slice(0, 12)} (${role.length})`, { items: [{ itemId: 'c1', role }] })),
  json('several items wrong', { items: [{ itemId: '', role: '' }, { itemId: 5 }, { role: 'top' }] }),
  ...occasionCases((occasion) => ({ items, occasion })),
  ...weatherCases((w) => ({ items, weather: w })),
  ...WRONG_TYPES.filter(([name]) => !['null', 'a string'].includes(name)).map(([name, value]) => json(`name ${name}`, { items, name: value })),
  ...['', '   ', '  Yozgi  ', 'n'.repeat(80), 'n'.repeat(81), ` ${'n'.repeat(80)} `, 'ў'.repeat(80), '😀'.repeat(40), '😀'.repeat(41)].map((name, i) => json(`name text ${i}`, { items, name })),
  ...[0, 100, -0.5, 100.5, 50, 49.5, 1e3].map((score) => json(`score ${score}`, { items, score })),
  ...WRONG_TYPES.filter(([name]) => !['null', 'a number'].includes(name)).map(([name, value]) => json(`score ${name}`, { items, score: value })),
  ...WRONG_TYPES.filter(([name]) => name !== 'an array').map(([name, value]) => json(`reasons ${name}`, { items, reasons: value })),
  json('reasons empty', { items, reasons: [] }),
  json('reasons of 20', { items, reasons: Array.from({ length: 20 }, (_, i) => `r${i}`) }),
  json('reasons of 21', { items, reasons: Array.from({ length: 21 }, (_, i) => `r${i}`) }),
  json('a reason of 120 characters', { items, reasons: ['r'.repeat(120)] }),
  json('a reason of 121 characters', { items, reasons: ['ok', 'r'.repeat(121)] }),
  json('reasons that are not text', { items, reasons: ['ok', 5, null, ['x']] }),
  json('a reason with spaces around (kept)', { items, reasons: ['  spaced  ', ''] }),
  ...WRONG_TYPES.filter(([name]) => !['null', 'a string'].includes(name)).map(([name, value]) => json(`explanation ${name}`, { items, explanation: value })),
  json('explanation of 2000 characters', { items, explanation: 'e'.repeat(2000) }),
  json('explanation of 2001 characters', { items, explanation: 'e'.repeat(2001) }),
  json('explanation with spaces around (kept)', { items, explanation: '  spaced  ' }),
  json('explanation empty', { items, explanation: '' }),
  ...WRONG_TYPES.filter(([name]) => name !== 'true').map(([name, value]) => json(`isSaved ${name}`, { items, isSaved: value })),
  json('isSaved false', { items, isSaved: false }),
  json('everything wrong', { items: 'x', occasion: 'x', weather: 5, name: 5, score: 'x', reasons: 'x', explanation: 5, isSaved: 'x' }),
]

// ── PATCH /outfits/{id} ─────────────────────────────────────────────────────
const patch: Case[] = [
  ...notAnObject,
  json('members that are not known', { score: 5, items: [] }),
  json('isSaved true', { isSaved: true }),
  json('isSaved false', { isSaved: false }),
  ...WRONG_TYPES.filter(([name]) => name !== 'true').map(([name, value]) => json(`isSaved ${name}`, { isSaved: value })),
  ...WRONG_TYPES.filter(([name]) => !['null', 'a string'].includes(name)).map(([name, value]) => json(`name ${name}`, { name: value })),
  json('name null', { name: null }),
  ...['', '   ', '  Yozgi  ', 'n'.repeat(80), 'n'.repeat(81), ` ${'n'.repeat(80)} `].map((name, i) => json(`name text ${i}`, { name })),
  json('both', { isSaved: true, name: 'Ish uchun' }),
  json('both wrong', { isSaved: 'x', name: 5 }),
]

// ── POST /outfits/{id}/feedback ─────────────────────────────────────────────
const feedback: Case[] = [
  ...notAnObject,
  ...['liked', 'disliked', 'saved', 'rejected'].map((f) => json(`feedback ${f}`, { feedback: f })),
  ...WRONG_TYPES.map(([name, value]) => json(`feedback ${name}`, { feedback: value })),
  json('feedback unknown', { feedback: 'loved' }),
  json('feedback in upper case', { feedback: 'Liked' }),
  json('members that are not known', { feedback: 'liked', outfitId: 'x' }),
  ...WRONG_TYPES.filter(([name]) => name !== 'a string').map(([name, value]) => json(`note ${name}`, { feedback: 'liked', note: value })),
  ...['', '   ', '  rangi yoqmadi  ', 'n'.repeat(500), 'n'.repeat(501), ` ${'n'.repeat(500)} `].map((note, i) => json(`note text ${i}`, { feedback: 'disliked', note })),
  json('a note without feedback', { note: 'x' }),
]

// ── GET /outfits?saved= ─────────────────────────────────────────────────────
// The route passes the parameter only when it is not empty.
const saved: Array<string | null> = [null, '', '0', '1', 'true', 'false', 'yes', 'TRUE', ' 1', '01', 'null']

// ── GET /weather/current?lat=&lon= ──────────────────────────────────────────
// The route passes each parameter, or undefined when it is missing or empty.
const coordinates: Array<{ lat: string | null; lon: string | null }> = [
  { lat: '41.31', lon: '69.24' },
  { lat: null, lon: null },
  { lat: '41.31', lon: null },
  { lat: null, lon: '69.24' },
  { lat: '', lon: '' },
  { lat: '-90', lon: '-180' },
  { lat: '90', lon: '180' },
  { lat: '-90.01', lon: '0' },
  { lat: '90.01', lon: '0' },
  { lat: '0', lon: '-180.01' },
  { lat: '0', lon: '180.01' },
  { lat: '91', lon: '181' },
  { lat: 'abc', lon: '69.24' },
  { lat: '41.31', lon: 'abc' },
  { lat: 'abc', lon: 'abc' },
  { lat: ' 41.31 ', lon: '\t69.24\n' },
  { lat: '4.131e1', lon: '6924e-2' },
  { lat: '0x10', lon: '0b11' },
  { lat: '+41', lon: '-0' },
  { lat: '.5', lon: '5.' },
  { lat: 'Infinity', lon: '0' },
  { lat: '-Infinity', lon: '0' },
  { lat: 'NaN', lon: '0' },
  { lat: '1e400', lon: '0' },
  { lat: '41,31', lon: '69,24' },
  { lat: '   ', lon: '0' },
  { lat: '41.31abc', lon: '0' },
  { lat: '٤١', lon: '0' },
  { lat: '41.123456789', lon: '69.987654321' },
]

async function runBodies<T>(schema: ZodType<T>, cases: Case[]) {
  const results: unknown[] = []
  for (const c of cases) {
    const req = new Request('http://internal.invalid/', { method: 'POST', body: c.body === '' ? undefined : c.body })
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
  generate: await runBodies(OutfitGenerateRequest, generate),
  save: await runBodies(OutfitSaveRequest, save),
  patch: await runBodies(OutfitPatchRequest, patch),
  feedback: await runBodies(OutfitFeedbackRequest, feedback),
  saved: saved.map((value) => ({ saved: value, ...outcome(() => validate(value ? { saved: value } : {}, OutfitListQuery)) })),
  coordinates: coordinates.map((c) => ({ ...c, ...outcome(() => validate({ lat: c.lat || undefined, lon: c.lon || undefined }, WeatherQuery)) })),
}
writeFileSync(
  out,
  JSON.stringify(
    {
      generatedBy: 'apps/web/scripts/golden-outfit-validation.ts',
      sourceCommit,
      note: 'generate, save, patch, feedback: raw bodies through parseJson. saved, coordinates: the parameters as the routes pass them (an empty one is absent) through validate.',
      ...sections,
    },
    null,
    1,
  ) + '\n',
)
console.log(`wrote ${out}: ${Object.entries(sections).map(([k, v]) => `${v.length} ${k}`).join(', ')}`)
