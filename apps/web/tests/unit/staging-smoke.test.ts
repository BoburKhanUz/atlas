/**
 * Staging smoke foundation (e2e/smoke/smoke-mode.ts): the mode gate (mock by
 * default, a real provider only with an explicit opt-in and never under CI)
 * and the log verdict over the dashboard `lookly ai-monitor` computes (the
 * binary's part: tests/eval-go/staging-smoke.evalgo.ts). Pure; no network.
 */
import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { checkSmokeLog, isMockProviderName, smokeMode, type SmokeDashboard } from '../../e2e/smoke/smoke-mode'

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

describe('smoke log verdict', () => {
  const mock: SmokeDashboard = {
    requests: [
      { feature: 'stylist_chat', provider: 'mock' },
      { feature: 'clothing_analysis', provider: 'mock' },
      { feature: 'outfit_explanation', provider: 'mock' },
      { feature: 'stylist_chat', provider: 'mock' },
    ],
    quota: [],
  }

  it('reports the features and providers seen, sorted and once each, and no quota for the mock', () => {
    const v = checkSmokeLog('', [], mock)
    expect(v.features).toEqual(['clothing_analysis', 'outfit_explanation', 'stylist_chat'])
    expect(v.providers).toEqual(['mock'])
    expect(v.providers.every(isMockProviderName)).toBe(true)
    expect(v.quotaCharged).toBe(0)
  })

  it("a real provider's quota charges are visible; the colour analysis's own limit is counted apart", () => {
    const v = checkSmokeLog('', [], {
      requests: [{ feature: 'stylist_chat', provider: 'openai' }],
      quota: [
        { feature: 'stylist_chat', provider: 'openai', charged: 1 },
        { feature: 'outfit_explanation', provider: 'openai', charged: 2 },
        { feature: 'color_analysis', provider: 'deterministic', charged: 1 },
      ],
    })
    expect(v.providers.every(isMockProviderName)).toBe(false)
    expect(v.quotaCharged).toBe(3)
    expect(v.colorAnalysesCharged).toBe(1)
    const mockRun = checkSmokeLog('', [], { requests: [], quota: [{ feature: 'color_analysis', provider: 'deterministic', charged: 1 }] })
    expect([mockRun.quotaCharged, mockRun.colorAnalysesCharged]).toEqual([0, 1])
  })

  it('names leaked values by index only (the value itself is never echoed); an empty value is no leak', () => {
    const v = checkSmokeLog('{"msg":"oops","email":"smoke@example.test"}', ['', 'smoke@example.test', 'conv_123'], mock)
    expect(v.leaks).toEqual([1])
    expect(JSON.stringify(v)).not.toContain('smoke@')
  })
})

describe('staging smoke wiring', () => {
  const root = path.resolve(__dirname, '../..')
  it('the staging config has no web server and only runs e2e/smoke; CI never sets a real provider', () => {
    const config = readFileSync(path.join(root, 'playwright.staging.config.ts'), 'utf8')
    expect(config).toContain("testDir: './e2e/smoke'")
    expect(config).not.toMatch(/webServer\s*:/)
    expect(config).toContain('smokeMode(process.env)')
    const ci = readFileSync(path.join(root, '../../.github/workflows/ci.yml'), 'utf8')
    expect(ci).not.toMatch(/STAGING_SMOKE_PROVIDER:\s*real|STAGING_SMOKE_REAL_PROVIDER_OPT_IN/)
    expect(ci).not.toContain('playwright.staging.config')
  })

  it('the browser suite runs the smoke against Go with the mock (e2e/ includes e2e/smoke/)', () => {
    const config = readFileSync(path.join(root, 'playwright.config.ts'), 'utf8')
    expect(config).toContain("testDir: './e2e'")
    expect(config).not.toMatch(/testIgnore/)
  })
})
