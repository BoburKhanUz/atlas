/**
 * Crash monitoring on our own server: POST /api/v1/client-errors writes one
 * scrubbed `client error` log line per report and stores nothing. No user
 * text, e-mail address, token, signed URL or id survives into the log.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST as clientErrors } from '@/app/api/v1/client-errors/route'
import { resetRateLimits } from '@/lib/rate-limit'
import { normalizeRoute, scrubErrorText } from '@/lib/error-scrub'
import { jsonRequest } from '../helpers'

const report = (extra: Record<string, unknown> = {}) => ({
  platform: 'android',
  appVersion: '0.1.0+1',
  osVersion: 'Android 14',
  kind: 'dart',
  fatal: false,
  errorType: 'StateError',
  message: 'Bad state: no element',
  ...extra,
})

let lines: Record<string, unknown>[] = []
beforeEach(() => {
  resetRateLimits()
  lines = []
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    for (const l of String(chunk).split('\n').filter(Boolean)) lines.push(JSON.parse(l))
    return true
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

const post = (body: unknown, headers: Record<string, string> = {}) => clientErrors(jsonRequest('/api/v1/client-errors', body, headers))
const clientLines = () => lines.filter((l) => l.msg === 'client error')

describe('POST /api/v1/client-errors', () => {
  it('logs each report as one error line and answers { ok: true }', async () => {
    const res = await post({ reports: [report(), report({ kind: 'flutter', fatal: true, errorType: 'FlutterError', route: '/wardrobe' })] })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(clientLines()).toEqual([
      expect.objectContaining({ level: 'error', platform: 'android', appVersion: '0.1.0+1', kind: 'dart', fatal: false, errorType: 'StateError' }),
      expect.objectContaining({ kind: 'flutter', fatal: true, route: '/wardrobe' }),
    ])
  })

  it('scrubs what the app may have missed: e-mail, Bearer, JWT, URL queries, opaque tokens, ids in the route', async () => {
    const token = 'Ab3_dEf-'.repeat(6) // 48 characters, like a refresh or reset token
    const jwt = `eyJ${'a'.repeat(20)}.${'b'.repeat(20)}.${'c'.repeat(20)}`
    await post({
      reports: [
        report({
          message: `failed for ali@example.uz with Bearer ${jwt} at https://atlas.example.uz/api/v1/media/users/x.webp?exp=1&sig=abc and token ${token}`,
          stack: `#0 main (package:atlas_mobile/main.dart:10:3)\n#1 https://atlas.example.uz/reset-password?token=${token}`,
          route: '/wardrobe/item/cm9x8y7z6w5v4u3t2s1r?tab=a',
        }),
      ],
    })
    const [line] = clientLines()
    const text = JSON.stringify(line)
    for (const secret of ['ali@example.uz', jwt, token, 'sig=abc', 'cm9x8y7z6w5v4u3t2s1r']) expect(text).not.toContain(secret)
    expect(line.route).toBe('/wardrobe/item/:id')
    expect(line.message).toContain('https://atlas.example.uz/api/v1/media/users/x.webp?[REDACTED]')
    expect(line.stack).toContain('package:atlas_mobile/main.dart:10:3')
  })

  it('refuses malformed batches (no report, more than 10, unknown platform) and oversized bodies', async () => {
    for (const body of [{ reports: [] }, { reports: Array.from({ length: 11 }, () => report()) }, { reports: [report({ platform: 'symbian' })] }]) {
      const res = await post(body)
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe('VALIDATION_ERROR')
    }
    const big = await post({ reports: [report({ stack: 'x'.repeat(70_000) })] })
    expect(big.status).toBe(413)
    expect(clientLines()).toEqual([])
  })

  it('at most 30 requests per client IP in 10 minutes behind a trusted proxy', async () => {
    vi.stubEnv('TRUST_PROXY', '1')
    for (let i = 0; i < 30; i++) expect((await post({ reports: [report()] }, { 'x-forwarded-for': '198.51.100.4' })).status).toBe(200)
    const limited = await post({ reports: [report()] }, { 'x-forwarded-for': '198.51.100.4' })
    expect(limited.status).toBe(429)
    expect((await limited.json()).code).toBe('RATE_LIMITED')
    expect((await post({ reports: [report()] }, { 'x-forwarded-for': '198.51.100.5' })).status).toBe(200)
  })
})

describe('scrubbing helpers', () => {
  it('keeps stack frames and short words, drops long opaque values and URL queries', () => {
    expect(scrubErrorText('at Foo.bar (https://x.uz/_next/static/chunks/app-1a2b3c4d5e6f7a8b.js:1:200)')).toBe(
      'at Foo.bar (https://x.uz/_next/static/chunks/app-1a2b3c4d5e6f7a8b.js:1:200)',
    )
    expect(scrubErrorText('GET https://x.uz/a?b=c failed')).toBe('GET https://x.uz/a?[REDACTED] failed')
    expect(scrubErrorText(`key ${'k'.repeat(40)}`)).toBe('key [REDACTED]')
    expect(normalizeRoute('/stylist/chat/cmabcdefghijklmnop12#x')).toBe('/stylist/chat/:id')
    expect(normalizeRoute('/legal/privacy')).toBe('/legal/privacy')
  })
})
