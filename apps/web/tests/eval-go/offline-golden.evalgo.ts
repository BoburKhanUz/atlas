/**
 * The offline regression guard of the evaluation harness (docs/plan/B7.md,
 * B7.4): every offline scenario (scripted cases, provider failures,
 * corrections, preferences, synthetic pictures, robustness) through `lookly
 * eval`, served the scripted providers by a stand-in on 127.0.0.1, must give
 * the records and requests frozen in golden/offline.json (first written from
 * the TypeScript pipeline, which gave the same; the two robustness scenarios
 * on an answer that is not JSON follow Go since the owner's decision of
 * 2026-11-28).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectOffline, goOfflinePipeline, type OfflineGolden } from '../../scripts/ai-eval/offline-scenarios'

if (!process.env.LOOKLY_BINARY) throw new Error('LOOKLY_BINARY is not set: build apps/api (go build -tags nodynamic -o <path> ./cmd/lookly) and point it there')

const golden = JSON.parse(readFileSync(path.join(__dirname, 'golden/offline.json'), 'utf8')) as OfflineGolden & { generatedBy: string }

describe('the offline golden records', () => {
  it('the Go pipeline gives them', async () => {
    const { generatedBy: _generatedBy, ...frozen } = golden
    void _generatedBy
    expect(await collectOffline(goOfflinePipeline())).toEqual(frozen)
  }, 180_000)

  it('every robustness scenario ends as specified', () => {
    expect(golden.robustness.length).toBeGreaterThanOrEqual(13)
    for (const r of golden.robustness) expect(r.actual, `${r.feature}: ${r.scenario}`).toBe(r.expected)
  })
})
