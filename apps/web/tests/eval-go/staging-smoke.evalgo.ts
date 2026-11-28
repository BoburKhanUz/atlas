/**
 * The staging smoke's log check through the Go binary (e2e/smoke/smoke-mode.ts,
 * goDashboard): `lookly ai-monitor --json` reads the target's log, the window
 * starts when the smoke started, and an alert (exit 2) is no failure of the run.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkSmokeLog, goDashboard } from '../../e2e/smoke/smoke-mode'

const BINARY = process.env.LOOKLY_BINARY
if (!BINARY) throw new Error('LOOKLY_BINARY is not set: build apps/api (go build -tags nodynamic -o <path> ./cmd/lookly) and point it there')

const line = (o: Record<string, unknown>) => JSON.stringify({ level: 'INFO', ts: '2026-10-07T10:00:00.000Z', ...o })
function logFile(lines: string[]): string {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'lookly-smoke-')), 'server.log')
  writeFileSync(file, lines.join('\n') + '\n')
  return file
}

describe('the smoke log check through lookly ai-monitor', () => {
  it('reads the features, the providers and the quota of the window, and skips what is not an AI event', () => {
    const file = logFile([
      line({ msg: 'ai.request', feature: 'clothing_analysis', provider: 'mock', outcome: 'ok', billable: false }),
      line({ msg: 'ai.request', feature: 'stylist_chat', provider: 'openai', outcome: 'ok', billable: true }),
      line({ msg: 'ai.quota', feature: 'stylist_chat', provider: 'openai', action: 'charged' }),
      'not json',
      line({ msg: 'request', route: 'POST /api/v1/stylist/chat', status: 200 }),
      line({ msg: 'ai.request', ts: '2026-10-07T09:00:00.000Z', feature: 'outfit_explanation', provider: 'mock', outcome: 'fallback' }),
    ])
    const v = checkSmokeLog('', [], goDashboard(BINARY, file, '2026-10-07T09:30:00.000Z'))
    expect(v.features).toEqual(['clothing_analysis', 'stylist_chat'])
    expect(v.providers).toEqual(['mock', 'openai'])
    expect(v.quotaCharged).toBe(1)
    expect(checkSmokeLog('', [], goDashboard(BINARY, file)).features).toEqual(['clothing_analysis', 'outfit_explanation', 'stylist_chat'])
  })

  it('an alert does not fail the check; a missing log does', () => {
    // Six failed calls of a real provider in a row: ai_provider_availability fires (exit 2).
    const fails = Array.from({ length: 6 }, () => line({ msg: 'ai.call', feature: 'stylist_chat', provider: 'openai', model: 'm', success: false, errorCode: 'unavailable' }))
    expect(goDashboard(BINARY, logFile(fails)).requests).toEqual([])
    expect(() => goDashboard(BINARY, '/nonexistent/server.log')).toThrow(/lookly ai-monitor failed \(exit 1\)/)
  })
})
