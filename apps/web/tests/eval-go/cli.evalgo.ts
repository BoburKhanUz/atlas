/**
 * The evaluation's command-line runs go through the Go server only
 * (docs/plan/B7.md, B7.4e): a scripted run reaches `lookly eval` through the
 * stand-in and gives the frozen offline results; the removed --pipeline flag
 * and a paid run without its cap or key are refused before any call.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

if (!process.env.LOOKLY_BINARY) throw new Error('LOOKLY_BINARY is not set: build apps/api (go build -tags nodynamic -o <path> ./cmd/lookly) and point it there')

const out = mkdtempSync(path.join(os.tmpdir(), 'lookly-eval-cli-'))
afterAll(() => rmSync(out, { recursive: true, force: true }))

const golden = JSON.parse(readFileSync(path.join(__dirname, 'golden/offline.json'), 'utf8')) as { stylist: Array<{ record: { pass: boolean } }>; outfit: Array<{ record: { pass: boolean } }> }
const passed = (rows: Array<{ record: { pass: boolean } }>) => rows.filter((r) => r.record.pass).length

function run(script: string, args: string[], env: Record<string, string> = {}) {
  const r = spawnSync('bun', [path.join('scripts/ai-eval', script), ...args], {
    cwd: path.resolve(__dirname, '../..'), encoding: 'utf8', timeout: 120_000,
    env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', LOOKLY_BINARY: process.env.LOOKLY_BINARY!, ...env },
  })
  return { code: r.status, stdout: r.stdout, stderr: r.stderr }
}

describe('the command-line runs on Go', () => {
  it.each([
    ['stylist-eval.ts', 'stylist', golden.stylist],
    ['outfit-eval.ts', 'outfit', golden.outfit],
  ])('%s: a scripted run gives the frozen results', (script, name, rows) => {
    const r = run(script, ['--provider=scripted', `--out=${path.join(out, name)}`])
    expect(r.code, r.stderr).toBe(0)
    const summary = JSON.parse(readFileSync(path.join(out, name, `${name}-summary.json`), 'utf8')) as { status: string; cases: number; passed: number }
    expect(summary).toMatchObject({ status: 'OFFLINE_SELF_TEST', cases: rows.length, passed: passed(rows) })
  }, 120_000)

  it('the removed --pipeline flag, a paid run without a cap or a key: refused, nothing run', () => {
    for (const script of ['stylist-eval.ts', 'outfit-eval.ts']) {
      const flag = run(script, ['--provider=scripted', '--pipeline=go', `--out=${path.join(out, 'x')}`])
      expect([flag.code, flag.stderr]).toEqual([1, expect.stringMatching(/--pipeline is gone/)])
      const uncapped = run(script, ['--provider=openai', '--model=m', `--out=${path.join(out, 'x')}`], { OPENAI_API_KEY: 'sk-test-not-sent' })
      expect([uncapped.code, uncapped.stderr]).toEqual([1, expect.stringMatching(/--max-calls/)])
      const keyless = run(script, ['--provider=openai', '--model=m', '--max-calls=2', `--out=${path.join(out, 'x')}`])
      expect([keyless.code, keyless.stderr]).toEqual([1, expect.stringMatching(/OPENAI_API_KEY is not set/)])
    }
    const vision = run('vision-eval.ts', ['--dataset=/nonexistent', '--matrix=/nonexistent', `--out=${path.join(out, 'v')}`])
    expect([vision.code, vision.stderr]).toEqual([1, expect.stringMatching(/--max-calls=N/)])
  }, 120_000)
})
