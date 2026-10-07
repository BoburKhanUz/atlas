/**
 * Phase 5.0 staging smoke foundation: the mode gate (mock by default, a real
 * provider only with an explicit opt-in and never under CI) and the log
 * check (AI events present, nothing personal in the log). Pure; no network.
 */
import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { checkSmokeLog, isMockProviderName, smokeMode } from '../../../e2e/smoke/smoke-mode'

describe('smoke mode', () => {
  it('defaults to mock; an existing account and a log file are optional', () => {
    expect(smokeMode({})).toEqual({ provider: 'mock', account: null, logFile: null })
    expect(smokeMode({ STAGING_SMOKE_PROVIDER: ' MOCK ', STAGING_SMOKE_EMAIL: 'smoke@example.test', STAGING_SMOKE_PASSWORD: 'p', STAGING_SMOKE_LOG_FILE: '/tmp/x.log' })).toEqual({
      provider: 'mock',
      account: { email: 'smoke@example.test', password: 'p' },
      logFile: '/tmp/x.log',
    })
  })

  it('a real provider needs the explicit opt-in', () => {
    expect(() => smokeMode({ STAGING_SMOKE_PROVIDER: 'real' })).toThrow(/STAGING_SMOKE_REAL_PROVIDER_OPT_IN=1/)
    expect(() => smokeMode({ STAGING_SMOKE_PROVIDER: 'real', STAGING_SMOKE_REAL_PROVIDER_OPT_IN: 'true' })).toThrow(/OPT_IN=1/)
    expect(smokeMode({ STAGING_SMOKE_PROVIDER: 'real', STAGING_SMOKE_REAL_PROVIDER_OPT_IN: '1' }).provider).toBe('real')
  })

  it('a real provider never runs in CI, opt-in or not', () => {
    expect(() => smokeMode({ CI: '1', STAGING_SMOKE_PROVIDER: 'real', STAGING_SMOKE_REAL_PROVIDER_OPT_IN: '1' })).toThrow(/never runs in CI/)
    expect(smokeMode({ CI: '1' }).provider).toBe('mock')
  })

  it.each(['gemini', 'openai', 'live', 'yes'])('an unknown provider mode (%s) is refused', (v) => {
    expect(() => smokeMode({ STAGING_SMOKE_PROVIDER: v })).toThrow(/must be mock or real/)
  })

  it('account credentials come in pairs', () => {
    expect(() => smokeMode({ STAGING_SMOKE_EMAIL: 'a@example.test' })).toThrow(/both/)
    expect(() => smokeMode({ STAGING_SMOKE_PASSWORD: 'p' })).toThrow(/both/)
  })
})

describe('smoke log check', () => {
  const line = (o: Record<string, unknown>) => JSON.stringify({ level: 'info', ts: '2026-10-07T10:00:00.000Z', ...o })
  const log = [
    line({ msg: 'ai.request', feature: 'clothing_analysis', provider: 'mock', outcome: 'ok', billable: false }),
    line({ msg: 'ai.request', feature: 'stylist_chat', provider: 'mock', outcome: 'ok', billable: false }),
    line({ msg: 'ai.request', feature: 'outfit_explanation', provider: 'mock', outcome: 'fallback', reason: 'mock', billable: false }),
    'not json',
    line({ msg: 'request ok', route: 'POST /api/v1/stylist/chat', status: 200 }),
  ].join('\n')

  it('reports the features and providers seen, and no quota for the mock', () => {
    const v = checkSmokeLog(log, ['smoke@example.test', 'conv_123'])
    expect(v.features).toEqual(['clothing_analysis', 'outfit_explanation', 'stylist_chat'])
    expect(v.providers).toEqual(['mock'])
    expect(v.providers.every(isMockProviderName)).toBe(true)
    expect(v.quotaCharged).toBe(0)
    expect(v.leaks).toEqual([])
  })

  it('a real provider and its quota charge are visible', () => {
    const v = checkSmokeLog(
      [line({ msg: 'ai.request', feature: 'stylist_chat', provider: 'gemini', outcome: 'ok', billable: true }), line({ msg: 'ai.quota', feature: 'stylist_chat', provider: 'gemini', action: 'charged' })].join('\n'),
      [],
    )
    expect(v.providers.every(isMockProviderName)).toBe(false)
    expect(v.quotaCharged).toBe(1)
  })

  it('names leaked values by index only (the value itself is never echoed)', () => {
    const v = checkSmokeLog(log + '\n' + line({ msg: 'oops', email: 'smoke@example.test' }), ['', 'smoke@example.test', 'conv_123'])
    expect(v.leaks).toEqual([1])
    expect(JSON.stringify(v.leaks)).not.toContain('smoke@')
  })

  it('only counts events inside the smoke window', () => {
    expect(checkSmokeLog(log, [], { from: '2026-10-07T11:00:00.000Z' }).features).toEqual([])
  })
})

describe('staging smoke wiring', () => {
  const root = path.resolve(__dirname, '../../..')
  it('the staging config has no web server and only runs e2e/smoke; CI never sets a real provider', () => {
    const config = readFileSync(path.join(root, 'playwright.staging.config.ts'), 'utf8')
    expect(config).toContain("testDir: './e2e/smoke'")
    expect(config).not.toMatch(/webServer\s*:/)
    expect(config).toContain('smokeMode(process.env)')
    for (const wf of ['ci.yml']) {
      const ci = readFileSync(path.join(root, '../../.github/workflows', wf), 'utf8')
      expect(ci).not.toMatch(/STAGING_SMOKE_PROVIDER:\s*real|STAGING_SMOKE_REAL_PROVIDER_OPT_IN/)
      expect(ci).not.toContain('playwright.staging.config')
    }
  })
})
