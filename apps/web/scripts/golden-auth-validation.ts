/**
 * Golden vectors for the Go port of request validation in auth (stage B2,
 * parity strength "exact": .claude/skills/lookly-testing/references/parity.md).
 *
 * Runs the real parseJson with the real request schemas on raw bodies and
 * records the outcome: the parsed value, or the error envelope's code,
 * message and details. Go reproduces every one, so a client sees the same
 * answer from either server.
 *
 *   cd apps/web && bun scripts/golden-auth-validation.ts ../api/testdata/golden/auth-validation.json
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import type { ZodType } from 'zod'
import { LEGAL_VERSION } from '@/lib/legal/version'
import { ApiError, parseJson } from '@/server/http'
import { LoginRequest, MobileLogoutRequest, MobileRefreshRequest, RegisterRequest } from '@/server/schemas/requests'

const out = process.argv[2]
if (!out) throw new Error('usage: bun scripts/golden-auth-validation.ts <output.json>')

type Case = { name: string; body: string }
const json = (name: string, value: unknown): Case => ({ name, body: JSON.stringify(value) })
const raw = (name: string, body: string): Case => ({ name, body })

const WRONG_TYPES: Array<[string, unknown]> = [
  ['null', null],
  ['a number', 7],
  ['true', true],
  ['false', false],
  ['an array', ['x']],
  ['an object', { a: 1 }],
]

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

const EMAILS = [
  'aziza@example.uz',
  'AZIZA@Example.UZ',
  'a.b+c_d-e@sub.example.co.uz',
  "o'neil@example.uz",
  'a@b.uz',
  'a@b.u',
  'a@b',
  'a@.uz',
  '@b.uz',
  'a@b..uz',
  '.a@b.uz',
  'a.@b.uz',
  'a..b@b.uz',
  'a b@b.uz',
  ' aziza@example.uz',
  'aziza@example.uz ',
  'aziza@example.uz\n',
  'aziza@-example.uz',
  'aziza@example-.uz',
  'aziza@exa_mple.uz',
  'aziza@example.u2',
  'ўзбек@example.uz',
  'aziza@мисол.uz',
  'a@b@c.uz',
  'aziza',
  '',
  `${'a'.repeat(250)}@example.uz`,
  'a%b@example.uz',
  'a&b@example.uz',
  '"a b"@example.uz',
  'aziza@123.45',
  'aziza@1.2.3.uz',
  'A_1+x@x-y.zz',
]

// ── login ────────────────────────────────────────────────────────────────────
const loginOk = { email: 'aziza@example.uz', password: 'parol123' }
const login: Case[] = [
  ...notAnObject,
  json('valid', loginOk),
  json('valid, with a device name', { ...loginOk, deviceName: 'Pixel 9' }),
  json('unknown fields are dropped', { ...loginOk, admin: true, role: 'x' }),
  json('no email', { password: 'x' }),
  json('no password', { email: 'aziza@example.uz' }),
  json('an empty password', { ...loginOk, password: '' }),
  json('a password of 1 character', { ...loginOk, password: 'x' }),
  json('a password of 200 characters', { ...loginOk, password: 'p'.repeat(200) }),
  json('a password of 201 characters', { ...loginOk, password: 'p'.repeat(201) }),
  json('a password of 200 two-byte characters', { ...loginOk, password: 'ў'.repeat(200) }),
  json('a password of 100 characters outside the basic plane (200 units)', { ...loginOk, password: '😀'.repeat(100) }),
  json('a password of 101 characters outside the basic plane (202 units)', { ...loginOk, password: '😀'.repeat(101) }),
  json('a password of spaces', { ...loginOk, password: '   ' }),
  json('a bad email and no password', { email: 'nope' }),
  json('a bad email and a long password', { email: 'nope', password: 'p'.repeat(201) }),
  json('everything wrong', { email: 5, password: null, deviceName: '' }),
  json('an empty device name', { ...loginOk, deviceName: '' }),
  json('a device name of spaces', { ...loginOk, deviceName: '   ' }),
  json('a device name with spaces around', { ...loginOk, deviceName: '  Pixel 9  ' }),
  json('a device name of 100 characters', { ...loginOk, deviceName: 'd'.repeat(100) }),
  json('a device name of 101 characters', { ...loginOk, deviceName: 'd'.repeat(101) }),
  json('a device name of 100 characters and spaces around', { ...loginOk, deviceName: ` ${'d'.repeat(100)} ` }),
  json('a device name of 50 characters outside the basic plane (100 units)', { ...loginOk, deviceName: '😀'.repeat(50) }),
  json('a device name of 51 characters outside the basic plane (102 units)', { ...loginOk, deviceName: '😀'.repeat(51) }),
  json('a device name with other white space around', { ...loginOk, deviceName: '  Pixel﻿\t' }),
  ...EMAILS.map((email) => json(`email ${JSON.stringify(email)}`, { ...loginOk, email })),
  ...WRONG_TYPES.flatMap(([label, value]) => [
    json(`email is ${label}`, { ...loginOk, email: value }),
    json(`password is ${label}`, { ...loginOk, password: value }),
    json(`deviceName is ${label}`, { ...loginOk, deviceName: value }),
  ]),
  raw('the email twice: the last one counts', '{"email":"nope","password":"x","email":"aziza@example.uz"}'),
  // zod also applies length rules to anything with a "length" (arrays, and
  // objects that have such a member) after reporting the wrong type.
  json('password is an empty array', { ...loginOk, password: [] }),
  json('password is an array of 201 items', { ...loginOk, password: Array.from({ length: 201 }, () => 'x') }),
  json('password is an object with a length of 300', { ...loginOk, password: { length: 300 } }),
  json('password is an object with a length of 0', { ...loginOk, password: { length: 0 } }),
  json('deviceName is an empty array', { ...loginOk, deviceName: [] }),
]

// ── register ─────────────────────────────────────────────────────────────────
const registerOk = { email: 'aziza@example.uz', password: 'parol1234', acceptedLegalVersion: LEGAL_VERSION, ageConfirmed: true }
const register: Case[] = [
  ...notAnObject,
  json('valid', registerOk),
  json('valid, with a name and a device name', { ...registerOk, name: 'Aziza', deviceName: 'Pixel 9' }),
  json('unknown fields are dropped', { ...registerOk, role: 'admin' }),
  json('no email', { ...registerOk, email: undefined }),
  json('no password', { ...registerOk, password: undefined }),
  json('a password of 7 characters', { ...registerOk, password: 'p'.repeat(7) }),
  json('a password of 8 characters', { ...registerOk, password: 'p'.repeat(8) }),
  json('a password of 4 characters outside the basic plane (8 units)', { ...registerOk, password: '😀'.repeat(4) }),
  json('a password of 200 characters', { ...registerOk, password: 'p'.repeat(200) }),
  json('a password of 201 characters', { ...registerOk, password: 'p'.repeat(201) }),
  json('an empty password', { ...registerOk, password: '' }),
  json('an empty name', { ...registerOk, name: '' }),
  json('a name of spaces (not trimmed)', { ...registerOk, name: '  ' }),
  json('a name with spaces around (kept)', { ...registerOk, name: ' Aziza ' }),
  json('a name of 60 characters', { ...registerOk, name: 'n'.repeat(60) }),
  json('a name of 61 characters', { ...registerOk, name: 'n'.repeat(61) }),
  json('a name of 30 characters outside the basic plane (60 units)', { ...registerOk, name: '😀'.repeat(30) }),
  json('a name of 31 characters outside the basic plane (62 units)', { ...registerOk, name: '😀'.repeat(31) }),
  json('an empty device name', { ...registerOk, deviceName: '' }),
  json('a device name of 101 characters', { ...registerOk, deviceName: 'd'.repeat(101) }),
  json('no accepted version', { ...registerOk, acceptedLegalVersion: undefined }),
  json('no age confirmation', { ...registerOk, ageConfirmed: undefined }),
  json('neither consent field', { email: registerOk.email, password: registerOk.password }),
  json('age not confirmed', { ...registerOk, ageConfirmed: false }),
  json('an older accepted version', { ...registerOk, acceptedLegalVersion: '2026-10-17.2-draft' }),
  json('an empty accepted version', { ...registerOk, acceptedLegalVersion: '' }),
  json('an accepted version with a space', { ...registerOk, acceptedLegalVersion: `${LEGAL_VERSION} ` }),
  json('an accepted version of 40 characters', { ...registerOk, acceptedLegalVersion: 'v'.repeat(40) }),
  json('an accepted version of 41 characters', { ...registerOk, acceptedLegalVersion: 'v'.repeat(41) }),
  json('an old version and age not confirmed', { ...registerOk, acceptedLegalVersion: 'old', ageConfirmed: false }),
  json('everything wrong', { email: 'nope', password: 'short', name: '', deviceName: ' ', acceptedLegalVersion: 'old', ageConfirmed: false }),
  json('every field of the wrong type', { email: 1, password: 2, name: 3, deviceName: 4, acceptedLegalVersion: 5, ageConfirmed: 'yes' }),
  json('more than twenty problems cannot happen: all six fields wrong, twice over', {
    email: null,
    password: [],
    name: {},
    deviceName: true,
    acceptedLegalVersion: 'x'.repeat(41),
    ageConfirmed: null,
  }),
  ...EMAILS.map((email) => json(`email ${JSON.stringify(email)}`, { ...registerOk, email })),
  ...WRONG_TYPES.flatMap(([label, value]) => [
    json(`email is ${label}`, { ...registerOk, email: value }),
    json(`password is ${label}`, { ...registerOk, password: value }),
    json(`name is ${label}`, { ...registerOk, name: value }),
    json(`deviceName is ${label}`, { ...registerOk, deviceName: value }),
    json(`acceptedLegalVersion is ${label}`, { ...registerOk, acceptedLegalVersion: value }),
    json(`ageConfirmed is ${label}`, { ...registerOk, ageConfirmed: value }),
  ]),
  json('ageConfirmed is the string "true"', { ...registerOk, ageConfirmed: 'true' }),
  json('ageConfirmed is 1', { ...registerOk, ageConfirmed: 1 }),
  json('name is an empty array', { ...registerOk, name: [] }),
  json('acceptedLegalVersion is an array of 41 items', { ...registerOk, acceptedLegalVersion: Array.from({ length: 41 }, () => 'x') }),
  json('ageConfirmed is 0', { ...registerOk, ageConfirmed: 0 }),
]

// ── refresh and logout (mobile mode) ─────────────────────────────────────────
const tokenCases = (required: boolean): Case[] => [
  ...notAnObject,
  json('valid', { refreshToken: 'r'.repeat(43) }),
  json('unknown fields are dropped', { refreshToken: 'abc', other: 1 }),
  json('an empty token', { refreshToken: '' }),
  json('a token of 1 character', { refreshToken: 'r' }),
  json('a token of 128 characters', { refreshToken: 'r'.repeat(128) }),
  json('a token of 129 characters', { refreshToken: 'r'.repeat(129) }),
  json('a token of 64 characters outside the basic plane (128 units)', { refreshToken: '😀'.repeat(64) }),
  json('a token of spaces (not trimmed)', { refreshToken: '  ' }),
  ...WRONG_TYPES.map(([label, value]) => json(`refreshToken is ${label}`, { refreshToken: value })),
  json(required ? 'another field only (the token is required)' : 'another field only (the token is optional)', { other: 'x' }),
  json('refreshToken is an empty array', { refreshToken: [] }),
  json('refreshToken is an array of 129 items', { refreshToken: Array.from({ length: 129 }, () => 1) }),
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
  login: await run(LoginRequest, login),
  register: await run(RegisterRequest, register),
  refresh: await run(MobileRefreshRequest, tokenCases(true)),
  logout: await run(MobileLogoutRequest, tokenCases(false)),
}
writeFileSync(
  out,
  JSON.stringify(
    {
      generatedBy: 'apps/web/scripts/golden-auth-validation.ts',
      sourceCommit,
      note: 'body is the raw request body. ok: the parsed value; otherwise the error envelope. register was recorded with legalVersion as the current version.',
      legalVersion: LEGAL_VERSION,
      ...sections,
    },
    null,
    1,
  ) + '\n',
)
console.log(`wrote ${out}: ${Object.entries(sections).map(([k, v]) => `${v.length} ${k}`).join(', ')}`)
