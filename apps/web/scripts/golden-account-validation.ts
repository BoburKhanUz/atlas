/**
 * Golden vectors for the Go port of request validation in the account
 * operations (stage B3, parity strength "exact":
 * .claude/skills/lookly-testing/references/parity.md): password reset request
 * and reset, renewed consent, profile change.
 *
 * Runs the real parseJson with the real request schemas on raw bodies and
 * records the outcome: the parsed value, or the error envelope's code,
 * message and details. Go reproduces every one, so a client sees the same
 * answer from either server.
 *
 *   cd apps/web && bun scripts/golden-account-validation.ts ../api/testdata/golden/account-validation.json
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import type { ZodType } from 'zod'
import { LEGAL_VERSION } from '@/lib/legal/version'
import { ApiError, parseJson } from '@/server/http'
import { colorSchema, fitSchema, styleSchema } from '@/server/schemas/catalog'
import { LegalConsentRequest, PasswordForgotRequest, PasswordResetRequest, ProfilePatchRequest } from '@/server/schemas/requests'

const out = process.argv[2]
if (!out) throw new Error('usage: bun scripts/golden-account-validation.ts <output.json>')

type Case = { name: string; body: string }
const json = (name: string, value: unknown): Case => ({ name, body: JSON.stringify(value) })
const raw = (name: string, body: string): Case => ({ name, body })

const WRONG_TYPES: Array<[string, unknown]> = [
  ['null', null],
  ['a number', 7],
  ['true', true],
  ['false', false],
  ['a string', 'text'],
  ['an array', ['x']],
  ['an object', { a: 1 }],
]
const except = (label: string) => WRONG_TYPES.filter(([l]) => l !== label)

/** Bodies that are not a JSON object, for every schema. */
const notAnObject: Case[] = [
  raw('an empty body', ''),
  raw('white space only', '  \n'),
  raw('not JSON', '{email'),
  raw('truncated JSON', '{"email":"a@test.uz"'),
  raw('two JSON values', '{}{}'),
  raw('JSON null', 'null'),
  raw('a JSON string', '"text"'),
  raw('a JSON number', '12'),
  raw('a JSON array', '[]'),
  raw('JSON true', 'true'),
  raw('an empty object', '{}'),
  raw('a byte order mark before the object', '﻿{}'),
]

// ── password reset: request ──────────────────────────────────────────────────
const forgot: Case[] = [
  ...notAnObject,
  json('valid', { email: 'aziza@example.uz' }),
  json('upper case is accepted (normalised by the handler)', { email: 'AZIZA@Example.UZ' }),
  json('unknown fields are dropped', { email: 'aziza@example.uz', token: 'x' }),
  json('no email', { other: 1 }),
  json('an empty email', { email: '' }),
  json('not an address', { email: 'aziza' }),
  json('a space before the address', { email: ' aziza@example.uz' }),
  json('a line break after the address', { email: 'aziza@example.uz\n' }),
  json('two dots', { email: 'a..b@example.uz' }),
  json('a long address', { email: `${'a'.repeat(250)}@example.uz` }),
  ...WRONG_TYPES.filter(([l]) => l !== 'a string').map(([label, value]) => json(`email is ${label}`, { email: value })),
  raw('the email twice: the last one counts', '{"email":"nope","email":"aziza@example.uz"}'),
]

// ── password reset: new password ─────────────────────────────────────────────
const resetOk = { token: 't'.repeat(43), password: 'parol1234' }
const reset: Case[] = [
  ...notAnObject,
  json('valid', resetOk),
  json('unknown fields are dropped', { ...resetOk, email: 'aziza@example.uz' }),
  json('no token', { password: resetOk.password }),
  json('no password', { token: resetOk.token }),
  json('an empty token', { ...resetOk, token: '' }),
  json('a token of 1 character', { ...resetOk, token: 't' }),
  json('a token of spaces (not trimmed)', { ...resetOk, token: '  ' }),
  json('a token of 200 characters', { ...resetOk, token: 't'.repeat(200) }),
  json('a token of 201 characters', { ...resetOk, token: 't'.repeat(201) }),
  json('a token of 100 characters outside the basic plane (200 units)', { ...resetOk, token: '😀'.repeat(100) }),
  json('a token of 101 characters outside the basic plane (202 units)', { ...resetOk, token: '😀'.repeat(101) }),
  json('a password of 7 characters', { ...resetOk, password: 'p'.repeat(7) }),
  json('a password of 8 characters', { ...resetOk, password: 'p'.repeat(8) }),
  json('a password of 4 characters outside the basic plane (8 units)', { ...resetOk, password: '😀'.repeat(4) }),
  json('a password of 200 characters', { ...resetOk, password: 'p'.repeat(200) }),
  json('a password of 201 characters', { ...resetOk, password: 'p'.repeat(201) }),
  json('an empty password', { ...resetOk, password: '' }),
  json('a password of 8 spaces (not trimmed)', { ...resetOk, password: ' '.repeat(8) }),
  json('both wrong', { token: '', password: 'short' }),
  ...WRONG_TYPES.filter(([l]) => l !== 'a string').flatMap(([label, value]) => [
    json(`token is ${label}`, { ...resetOk, token: value }),
    json(`password is ${label}`, { ...resetOk, password: value }),
  ]),
]

// ── renewed consent ──────────────────────────────────────────────────────────
const consentOk = { acceptedLegalVersion: LEGAL_VERSION, ageConfirmed: true }
const consent: Case[] = [
  ...notAnObject,
  json('valid', consentOk),
  json('unknown fields are dropped', { ...consentOk, userId: 'someone-else' }),
  json('no accepted version', { ageConfirmed: true }),
  json('no age confirmation', { acceptedLegalVersion: LEGAL_VERSION }),
  json('age not confirmed', { ...consentOk, ageConfirmed: false }),
  json('an older accepted version', { ...consentOk, acceptedLegalVersion: '2026-10-17.2-draft' }),
  json('an empty accepted version', { ...consentOk, acceptedLegalVersion: '' }),
  json('an accepted version with a space', { ...consentOk, acceptedLegalVersion: `${LEGAL_VERSION} ` }),
  json('an accepted version of 40 characters', { ...consentOk, acceptedLegalVersion: 'v'.repeat(40) }),
  json('an accepted version of 41 characters', { ...consentOk, acceptedLegalVersion: 'v'.repeat(41) }),
  json('an old version and age not confirmed', { acceptedLegalVersion: 'old', ageConfirmed: false }),
  ...WRONG_TYPES.filter(([l]) => l !== 'a string').map(([label, value]) => json(`acceptedLegalVersion is ${label}`, { ...consentOk, acceptedLegalVersion: value })),
  ...WRONG_TYPES.filter(([l]) => l !== 'true' && l !== 'false').map(([label, value]) => json(`ageConfirmed is ${label}`, { ...consentOk, ageConfirmed: value })),
  json('ageConfirmed is the string "true"', { ...consentOk, ageConfirmed: 'true' }),
  json('ageConfirmed is 1', { ...consentOk, ageConfirmed: 1 }),
]

// ── profile change ───────────────────────────────────────────────────────────
const FREE_TEXT = ['ageRange', 'bodyShape', 'skinTone', 'skinUndertone', 'hairColor', 'eyeColor', 'clothingSize'] as const
const LISTS = ['preferredStyles', 'dislikedStyles', 'favoriteColors', 'dislikedColors'] as const
const styles = [...styleSchema.options]
const colors = [...colorSchema.options]
const fits = [...fitSchema.options]
const listValues = (field: (typeof LISTS)[number]) => (field.endsWith('Styles') ? styles : colors)
const repeat = (values: string[], n: number) => Array.from({ length: n }, (_, i) => values[i % values.length])

const profileField = (field: string, value: unknown) => ({ profile: { [field]: value } })
const preference = (field: string, value: unknown) => ({ preferences: { [field]: value } })

const numberCases = (field: string, min: number, max: number): Case[] => [
  json(`${field} at the minimum`, profileField(field, min)),
  json(`${field} at the maximum`, profileField(field, max)),
  json(`${field} is null`, profileField(field, null)),
  raw(`${field} just below the minimum`, `{"profile":{"${field}":${min - 1}.999}}`),
  raw(`${field} just above the maximum`, `{"profile":{"${field}":${max}.001}}`),
  raw(`${field} is negative`, `{"profile":{"${field}":-1}}`),
  raw(`${field} is minus zero`, `{"profile":{"${field}":-0}}`),
  raw(`${field} with an exponent`, `{"profile":{"${field}":1e2}}`),
  raw(`${field} with a fraction of zeros`, `{"profile":{"${field}":100.0}}`),
  raw(`${field} with a fraction`, `{"profile":{"${field}":100.5}}`),
  raw(`${field} past the largest double`, `{"profile":{"${field}":1e400}}`),
  raw(`${field} below the smallest double`, `{"profile":{"${field}":-1e400}}`),
  raw(`${field} is a tiny number`, `{"profile":{"${field}":1e-400}}`),
  raw(`${field} with many digits`, `{"profile":{"${field}":100.00000000000000000000000000001}}`),
  ...except('a number')
    .filter(([l]) => l !== 'null')
    .map(([label, value]) => json(`${field} is ${label}`, profileField(field, value))),
  json(`${field} is a string of digits`, profileField(field, '100')),
]

const profile: Case[] = [
  ...notAnObject,
  json('a name only', { name: 'Aziza' }),
  json('every section', {
    name: 'Aziza',
    profile: {
      gender: 'female',
      ageRange: '25-34',
      height: 165,
      weight: 58.5,
      bodyShape: 'hourglass',
      skinTone: 'medium',
      skinUndertone: 'warm',
      hairColor: 'qora',
      eyeColor: 'jigarrang',
      clothingSize: 'M',
      preferredFit: fits[0],
      typicalBudget: 500000,
    },
    preferences: { preferredStyles: [styles[0], styles[1]], dislikedStyles: [], favoriteColors: [colors[0]], dislikedColors: [colors[1]], language: 'uz' },
  }),
  json('unknown fields are dropped at every level', { name: 'Aziza', role: 'admin', profile: { height: 170, userId: 'x', colorProfileId: 'y' }, preferences: { language: 'ru', id: 'z' } }),
  json('empty sections', { profile: {}, preferences: {} }),
  json('every profile field null', {
    profile: Object.fromEntries(['gender', ...FREE_TEXT, 'height', 'weight', 'preferredFit', 'typicalBudget'].map((f) => [f, null])),
  }),

  // name: trimmed, then 1–60
  json('an empty name', { name: '' }),
  json('a name of spaces', { name: '   ' }),
  json('a name with spaces around (trimmed)', { name: '  Aziza  ' }),
  json('a name with other white space around', { name: '﻿\tAziza ' }),
  json('a name of 60 characters', { name: 'n'.repeat(60) }),
  json('a name of 61 characters', { name: 'n'.repeat(61) }),
  json('a name of 60 characters and spaces around', { name: ` ${'n'.repeat(60)} ` }),
  json('a name of 30 characters outside the basic plane (60 units)', { name: '😀'.repeat(30) }),
  json('a name of 31 characters outside the basic plane (62 units)', { name: '😀'.repeat(31) }),
  json('a name with an apostrophe and Cyrillic', { name: 'O‘g‘iloy Ўткир' }),
  ...except('a string').map(([label, value]) => json(`name is ${label}`, { name: value })),

  // sections of the wrong type
  ...except('an object').flatMap(([label, value]) => [json(`profile is ${label}`, { profile: value }), json(`preferences is ${label}`, { preferences: value })]),

  // gender
  ...['male', 'female', 'other', 'unisex'].map((g) => json(`gender ${g}`, profileField('gender', g))),
  json('gender null', profileField('gender', null)),
  json('gender unknown', profileField('gender', 'robot')),
  json('gender in upper case', profileField('gender', 'Male')),
  json('gender empty', profileField('gender', '')),
  json('gender with a space', profileField('gender', 'male ')),
  ...except('a string')
    .filter(([l]) => l !== 'null')
    .map(([label, value]) => json(`gender is ${label}`, profileField('gender', value))),

  // free text: trimmed, at most 60, may be empty or null
  ...FREE_TEXT.flatMap((field) => [
    json(`${field} valid`, profileField(field, 'qiymat')),
    json(`${field} null`, profileField(field, null)),
    json(`${field} empty`, profileField(field, '')),
    json(`${field} of spaces (trimmed to empty)`, profileField(field, '   ')),
    json(`${field} with spaces around (trimmed)`, profileField(field, '  qiymat  ')),
    json(`${field} of 60 characters`, profileField(field, 'x'.repeat(60))),
    json(`${field} of 61 characters`, profileField(field, 'x'.repeat(61))),
    json(`${field} of 60 characters and spaces around`, profileField(field, `  ${'x'.repeat(60)}  `)),
    json(`${field} is a number`, profileField(field, 7)),
  ]),
  ...except('a string')
    .filter(([l]) => l !== 'null')
    .map(([label, value]) => json(`ageRange is ${label}`, profileField('ageRange', value))),
  json('ageRange of 31 characters outside the basic plane (62 units)', profileField('ageRange', '😀'.repeat(31))),

  // numbers
  ...numberCases('height', 50, 250),
  ...numberCases('weight', 20, 300),
  json('typicalBudget zero', profileField('typicalBudget', 0)),
  json('typicalBudget at the maximum', profileField('typicalBudget', 1_000_000_000)),
  json('typicalBudget above the maximum', profileField('typicalBudget', 1_000_000_001)),
  json('typicalBudget negative', profileField('typicalBudget', -1)),
  json('typicalBudget null', profileField('typicalBudget', null)),
  raw('typicalBudget with a fraction', '{"profile":{"typicalBudget":1.5}}'),
  raw('typicalBudget with a fraction of zeros', '{"profile":{"typicalBudget":250000.0}}'),
  raw('typicalBudget with an exponent', '{"profile":{"typicalBudget":2.5e5}}'),
  raw('typicalBudget with a negative exponent', '{"profile":{"typicalBudget":5e-1}}'),
  raw('typicalBudget minus zero', '{"profile":{"typicalBudget":-0}}'),
  raw('typicalBudget past the safe integers', '{"profile":{"typicalBudget":9007199254740993}}'),
  raw('typicalBudget past the largest double', '{"profile":{"typicalBudget":1e400}}'),
  raw('typicalBudget below the safe integers', '{"profile":{"typicalBudget":-9007199254740993}}'),
  raw('typicalBudget a whole number past the safe integers, written with an exponent', '{"profile":{"typicalBudget":1e300}}'),
  raw('typicalBudget negative and fractional', '{"profile":{"typicalBudget":-1.5}}'),
  raw('typicalBudget fractional and above the maximum', '{"profile":{"typicalBudget":1000000000.5}}'),
  ...except('a number')
    .filter(([l]) => l !== 'null')
    .map(([label, value]) => json(`typicalBudget is ${label}`, profileField('typicalBudget', value))),

  // preferredFit
  ...fits.map((f) => json(`preferredFit ${f}`, profileField('preferredFit', f))),
  json('preferredFit null', profileField('preferredFit', null)),
  json('preferredFit unknown', profileField('preferredFit', 'baggy')),
  json('preferredFit is a number', profileField('preferredFit', 1)),

  // lists
  ...LISTS.flatMap((field) => {
    const values = listValues(field)
    return [
      json(`${field} empty`, preference(field, [])),
      json(`${field} every value`, preference(field, values)),
      json(`${field} of 20 items`, preference(field, repeat(values, 20))),
      json(`${field} of 21 items`, preference(field, repeat(values, 21))),
      json(`${field} with a repeated value (kept)`, preference(field, [values[0], values[0]])),
      json(`${field} with an unknown value`, preference(field, [values[0], 'nope', values[1]])),
      json(`${field} with a value of the other list`, preference(field, [listValues(field.endsWith('Styles') ? 'favoriteColors' : 'preferredStyles')[5]])),
      json(`${field} with a number and a null inside`, preference(field, [values[0], 5, null])),
      json(`${field} null`, preference(field, null)),
      json(`${field} is a string`, preference(field, values[0])),
      json(`${field} is an object`, preference(field, { 0: values[0], length: 1 })),
      json(`${field} of 21 items, some unknown`, preference(field, [...repeat(values, 19), 'nope', 'nope2'])),
    ]
  }),
  json('a list with 25 unknown values (more than twenty problems)', preference('preferredStyles', Array.from({ length: 25 }, (_, i) => `x${i}`))),
  json('a value with upper case', preference('preferredStyles', ['Casual'])),
  json('a nested list', preference('favoriteColors', [[colors[0]]])),

  // language
  ...['uz', 'ru', 'en'].map((l) => json(`language ${l}`, preference('language', l))),
  json('language unknown', preference('language', 'de')),
  json('language in upper case', preference('language', 'UZ')),
  json('language null', preference('language', null)),
  json('language is a number', preference('language', 1)),

  // several problems: reported in schema order, not in the order sent
  json('problems in every section', {
    preferences: { language: 'xx', dislikedColors: ['nope'], preferredStyles: 'casual' },
    profile: { typicalBudget: 1.5, preferredFit: 'baggy', eyeColor: 'x'.repeat(61), height: 10, gender: 'robot' },
    name: '',
  }),
  json('every profile field wrong: reported in schema order', {
    profile: Object.fromEntries(['typicalBudget', 'preferredFit', 'clothingSize', 'eyeColor', 'hairColor', 'skinUndertone', 'skinTone', 'bodyShape', 'weight', 'height', 'ageRange', 'gender'].map((f) => [f, true])),
  }),
  json('every preference wrong: reported in schema order', {
    preferences: Object.fromEntries(['language', 'dislikedColors', 'favoriteColors', 'dislikedStyles', 'preferredStyles'].map((f) => [f, 5])),
  }),
  raw('a section twice: the last one counts', '{"profile":{"height":10},"profile":{"height":170}}'),
  raw('a field twice: the last one counts', '{"profile":{"height":10,"height":170}}'),
  raw('member names are matched exactly', '{"Name":"x","PROFILE":{"height":1},"profile":{"Height":1}}'),
]

async function run<T>(schema: ZodType<T>, cases: Case[]) {
  const results: unknown[] = []
  for (const c of cases) {
    const req = new Request('http://internal.invalid/', { method: 'POST', body: c.body === '' ? undefined : c.body })
    try {
      const value = await parseJson(req, schema)
      results.push({ ...c, ok: true, value })
    } catch (err) {
      if (!(err instanceof ApiError)) throw err
      results.push({ ...c, ok: false, status: err.status, code: err.code, error: err.message, details: err.details ?? [] })
    }
  }
  return results
}

const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const sections = {
  forgot: await run(PasswordForgotRequest, forgot),
  reset: await run(PasswordResetRequest, reset),
  consent: await run(LegalConsentRequest, consent),
  profile: await run(ProfilePatchRequest, profile),
}
writeFileSync(
  out,
  JSON.stringify(
    {
      generatedBy: 'apps/web/scripts/golden-account-validation.ts',
      sourceCommit,
      note: 'body is the raw request body. ok: the parsed value; otherwise the error envelope. consent was recorded with legalVersion as the current version. styles, colors and fits are the catalog values the profile schema accepts.',
      legalVersion: LEGAL_VERSION,
      styles,
      colors,
      fits,
      ...sections,
    },
    null,
    1,
  ) + '\n',
)
console.log(`wrote ${out}: ${Object.entries(sections).map(([k, v]) => `${v.length} ${k}`).join(', ')}`)
