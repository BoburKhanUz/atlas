/**
 * Golden vectors of the client error reports for the Go backend (stage
 * B6.8; POST /api/v1/client-errors): what the request rules make of a body
 * (src/server/schemas/requests.ts ClientErrorsRequest), and what is written
 * to the log for each report (src/server/client-errors.ts: the scrubbing of
 * src/lib/error-scrub.ts, then the log's own redaction, src/server/log.ts).
 *
 *   cd apps/web && bun scripts/golden-client-errors.ts ../api/testdata/golden/client-errors.json
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { ApiError, parseJson } from '@/server/http'
import { ClientErrorsRequest } from '@/server/schemas/requests'
import { normalizeRoute, scrubErrorText } from '@/lib/error-scrub'
import { redact, redactString } from '@/server/log'

const out = process.argv[2]
if (!out) throw new Error('usage: bun scripts/golden-client-errors.ts <output.json>')

type Case = { name: string; body: string }
const json = (name: string, value: unknown): Case => ({ name, body: JSON.stringify(value) })
const raw = (name: string, body: string): Case => ({ name, body })

const report = { platform: 'android', appVersion: '0.1.0+1', kind: 'flutter', errorType: 'StateError', message: 'Bad state: no element' }
const full = {
  ...report, osVersion: 'Android 14 (API 34)', fatal: true, stack: '#0 main (package:atlas/main.dart:10:5)',
  route: '/wardrobe/item/cm0abcdefghijklmnop12', occurredAt: '2026-11-28T07:00:00.000Z',
}
const WRONG: Array<[string, unknown]> = [['null', null], ['a number', 7], ['true', true], ['a string', 'text'], ['an array', ['x']], ['an object', { a: 1 }]]
const one = (over: Record<string, unknown>) => ({ reports: [{ ...report, ...over }] })
const dropped = (key: string) => {
  const r: Record<string, unknown> = { ...full }
  delete r[key]
  return { reports: [r] }
}

const cases: Case[] = [
  raw('an empty body', ''), raw('not JSON', '{reports'), raw('JSON null', 'null'), raw('a JSON array', '[]'), raw('an empty object', '{}'),
  json('one report', { reports: [report] }),
  json('every member', { reports: [full] }),
  json('members that are not known', { reports: [{ ...report, extra: 1, userId: 'u1' }], other: true }),
  ...WRONG.filter(([n]) => n !== 'an array').map(([n, v]) => json(`reports ${n}`, { reports: v })),
  json('no reports', { reports: [] }),
  json('ten reports', { reports: Array.from({ length: 10 }, () => report) }),
  json('eleven reports', { reports: Array.from({ length: 11 }, () => report) }),
  json('a report that is not an object', { reports: [report, 'x', null] }),
  ...['platform', 'appVersion', 'kind', 'errorType', 'message'].map((k) => json(`without ${k}`, dropped(k))),
  ...['osVersion', 'fatal', 'stack', 'route', 'occurredAt'].map((k) => json(`without optional ${k}`, dropped(k))),
  ...['android', 'ios', 'web', 'windows', 'Android', ''].map((p) => json(`platform ${p || 'empty'}`, one({ platform: p }))),
  ...['flutter', 'dart', 'android_java', 'android_native', 'android_anr', 'web_error', 'web_rejection', 'react', 'native', ''].map((k) => json(`kind ${k || 'empty'}`, one({ kind: k }))),
  ...WRONG.filter(([n]) => n !== 'a string').flatMap(([n, v]) =>
    ['platform', 'appVersion', 'osVersion', 'kind', 'errorType', 'message', 'stack', 'route', 'occurredAt'].map((k) => json(`${k} ${n}`, one({ [k]: v }))),
  ),
  ...WRONG.filter(([n]) => n !== 'true').map(([n, v]) => json(`fatal ${n}`, one({ fatal: v }))),
  json('fatal false', one({ fatal: false })),
  ...([['appVersion', 1, 40], ['osVersion', 0, 120], ['errorType', 1, 200], ['message', 0, 1000], ['stack', 0, 4000], ['route', 0, 200]] as Array<[string, number, number]>).flatMap(([k, min, max]) => [
    json(`${k} empty`, one({ [k]: '' })),
    json(`${k} at ${max}`, one({ [k]: 'a'.repeat(max) })),
    json(`${k} past ${max}`, one({ [k]: 'a'.repeat(max + 1) })),
    json(`${k} at ${max} in pairs`, one({ [k]: '😀'.repeat(max / 2) })),
    json(`${k} past ${max} in pairs`, one({ [k]: '😀'.repeat(max / 2) + 'a' })),
    ...(min > 0 ? [json(`${k} white space`, one({ [k]: ' ' }))] : []),
  ]),
  ...[
    '2026-11-28T07:00:00Z', '2026-11-28T07:00:00.1Z', '2026-11-28T07:00:00.123456789Z', '2026-11-28T07:00Z', '2026-11-28T07Z',
    '2026-11-28T07:00:00+05:00', '2026-11-28T07:00:00', '2026-11-28 07:00:00Z', '2026-11-28', '2026-02-29T00:00:00Z', '2024-02-29T00:00:00Z',
    '2000-02-29T00:00:00Z', '1900-02-29T00:00:00Z', '2026-04-31T00:00:00Z', '2026-13-01T00:00:00Z', '2026-11-28T24:00:00Z', '2026-11-28T23:60:00Z',
    '2026-11-28T23:59:60Z', '2026-11-28t07:00:00z', '+2026-11-28T07:00:00Z', '20261128T070000Z', '2026-11-28T07:00:00.Z', ' 2026-11-28T07:00:00Z',
  ].map((t) => json(`occurredAt ${t}`, one({ occurredAt: t }))),
  json('every error at once', { reports: [{ platform: 'x', kind: 'y', appVersion: '', errorType: 7, message: 'a'.repeat(1001), fatal: 'yes', occurredAt: 'now' }] }),
  json('two reports wrong', { reports: [{ ...report, platform: 'x' }, { ...report, kind: 'y' }] }),
  raw('a duplicate member', '{"reports":[],"reports":[' + JSON.stringify(report) + ']}'),
  // What is written to the log: the scrubbing and the redaction.
  json('texts to scrub', {
    reports: [
      { ...report, errorType: 'HttpException: Bearer abc.DEF-123_xyz~+/=', message: 'GET https://api.lookly.uz/v1/items?sig=abc&exp=9 failed for aziza.k+1@mail.example.uz' },
      { ...report, errorType: 'JWT eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9abcdef.c2lnbmF0dXJlLXZhbHVlLWhlcmU', message: 'token Rk9PQkFSQkFaUVVYMTIzNDU2Nzg5MDEyMzQ1Njc4OTA= and short abc123' },
      { ...report, errorType: 'E', message: 'bearer lower x, BEARER UPPER y', stack: '#0 at http://h.uz/a?b=c#frag (file:///lib/x.dart:1)\n#1 /data/app/~~longpathsegmentlongpathsegmentAAAA==/base.apk' },
      { ...report, errorType: 'E', message: '', route: '/stylist/conversations/cm0abcdefghijklmnop12?tab=1#top', osVersion: 'iOS 17.1 user@example.com', appVersion: '1.0 Bearer tokenvalue' },
      { ...report, errorType: 'E', message: 'x', route: '/outfits/short/a-b_c-d-e-f-g-h-i-j/0123456789abcdef' },
      { ...report, errorType: 'E', message: 'see ?sig=raw&exp=1 and &sig=z here', route: 'no-slash-route' },
      { ...report, errorType: 'E', message: 'ünïcödé@exämple.uz and a@b.c and a@b.co', route: '/' },
      { ...report, errorType: 'E', message: 'https://x.uz/p?q=1 https://y.uz/p?"quoted" https://z.uz?q=<a>' },
      { ...report, errorType: 'E', message: 'bearer abc~def/ghi+j=k and BeArEr\u00a0x~y', route: '/stylist/conversations/cm0abcdefghijklmnop12#frag' },
      { ...report, errorType: 'E', message: `${'A'.repeat(31)} ${'B'.repeat(32)} ${'C'.repeat(33)}`, route: '/a/abcdefghijklmno/abcdefghijklmnop#x?y' },
    ],
  }),
]

const results: unknown[] = []
for (const c of cases) {
  const req = new Request('http://internal.invalid/', { method: 'POST', body: c.body === '' ? undefined : c.body })
  try {
    const { reports } = await parseJson(req, ClientErrorsRequest)
    // The fields of each log line, as logClientErrors builds them and the
    // log writes them (undefined members are not written).
    const logged = reports.map((r) =>
      JSON.parse(JSON.stringify(redact({
        platform: r.platform, appVersion: r.appVersion, osVersion: r.osVersion, kind: r.kind, fatal: r.fatal ?? false,
        errorType: scrubErrorText(r.errorType), message: scrubErrorText(r.message), stack: r.stack ? scrubErrorText(r.stack) : undefined,
        route: r.route ? normalizeRoute(r.route) : undefined, occurredAt: r.occurredAt,
      }))),
    )
    results.push({ ...c, ok: true, logged })
  } catch (err) {
    if (!(err instanceof ApiError)) throw err
    results.push({ ...c, ok: false, status: err.status, code: err.code, error: err.message, details: err.details ?? [] })
  }
}

writeFileSync(
  out,
  JSON.stringify(
    {
      generatedBy: 'apps/web/scripts/golden-client-errors.ts', sourceCommit: execFileSync('git', ['rev-parse', 'HEAD']).toString().trim(),
      note: 'POST /api/v1/client-errors as the Next.js route judges a body, and the fields it logs for each report (scrubbed, then redacted).',
      logMessage: 'client error', redactedSample: redactString('Bearer x'),
      requests: results,
    },
    null, 1,
  ) + '\n',
)
console.log(`requests: ${results.length}`)
