import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { CONFIDENCE_KEYS, type GarmentAttributes } from '@/lib/ai/garment-analysis'
import { Dataset, Matrix, percentile, scoreItem, summarize, type ItemOutcome, type ItemRecord } from '../../../scripts/ai-eval/vision-scoring'

const attrs = (over: Partial<GarmentAttributes> = {}): GarmentAttributes => ({
  category: 'pants',
  subcategory: 'jeans',
  colors: ['blue', 'white'],
  pattern: 'denim',
  material: null,
  sleeveLength: null,
  fit: 'slim',
  style: 'casual',
  season: ['spring'],
  gender: 'unisex',
  formality: 'casual',
  ...over,
})
const conf = (v: number) => Object.fromEntries(CONFIDENCE_KEYS.map((k) => [k, v])) as Record<(typeof CONFIDENCE_KEYS)[number], number>
const garment = (over: Partial<GarmentAttributes> = {}, c = 0.9): ItemOutcome => ({ kind: 'garment', attributes: attrs(over), rawConfidence: conf(c), colorVerdict: 'supported' })

describe('vision evaluation: dataset and matrix validation', () => {
  it('accepts neutral ids and relative image names; rejects paths, personal-looking names and unknown fields', () => {
    const ok = { items: [{ id: 'g001', file: 'g001.jpg', expected: { subject: 'single_garment', category: 'pants', primaryColor: 'blue' } }] }
    expect(Dataset.safeParse(ok).success).toBe(true)
    for (const file of ['../g001.jpg', '/abs/g001.jpg', 'Jane Doe.jpg', 'g001.pdf']) {
      expect(Dataset.safeParse({ items: [{ ...ok.items[0], file }] }).success, file).toBe(false)
    }
    expect(Dataset.safeParse({ items: [{ ...ok.items[0], owner: 'x' }] }).success).toBe(false)
    expect(Dataset.safeParse({ items: [ok.items[0], ok.items[0]] }).success).toBe(false) // duplicate ids
    expect(Dataset.safeParse({ items: [{ ...ok.items[0], expected: { subject: 'person' } }] }).success).toBe(false)
  })

  it('the example matrix is valid and covers Gemini and OpenAI A/B at 768 and 1024', () => {
    const matrix = Matrix.parse(JSON.parse(readFileSync(path.resolve(__dirname, '../../../scripts/ai-eval/matrix.example.json'), 'utf8')))
    const keys = new Set(matrix.configs.map((c) => `${c.provider}:${c.maxSide}`))
    expect(keys).toEqual(new Set(['gemini:768', 'gemini:1024', 'openai:768', 'openai:1024']))
    for (const p of ['gemini', 'openai']) expect(new Set(matrix.configs.filter((c) => c.provider === p).map((c) => c.model)).size).toBe(2)
  })
})

describe('vision evaluation: scoring', () => {
  it('scores only labelled fields; primaryColor compares the first colour; null labels expect null', () => {
    const { fields, subjectCorrect } = scoreItem({ subject: 'single_garment', category: 'pants', subcategory: 'chinos', primaryColor: 'blue', material: null }, garment())
    expect(subjectCorrect).toBe(true)
    expect(fields).toEqual({ category: true, subcategory: false, primaryColor: true, material: true })
    expect(scoreItem({ subject: 'single_garment', primaryColor: 'white' }, garment()).fields).toEqual({ primaryColor: false })
  })

  it('a rejection or failure scores the subject only', () => {
    expect(scoreItem({ subject: 'no_garment' }, { kind: 'rejected', subject: 'no_garment' })).toEqual({ fields: {}, subjectCorrect: true, subjectAcceptable: true, subjectOutcome: 'correct' })
    expect(scoreItem({ subject: 'single_garment', category: 'pants' }, { kind: 'rejected', subject: 'unclear' })).toEqual({ fields: {}, subjectCorrect: false, subjectAcceptable: false, subjectOutcome: 'incorrect' })
    expect(scoreItem({ subject: 'single_garment' }, { kind: 'invalid' }).subjectCorrect).toBe(false)
    expect(scoreItem({ subject: 'no_garment' }, garment()).fields).toEqual({}) // accepted a non-garment: no attribute scoring
  })

  it('percentile is nearest-rank', () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3)
    expect(percentile([5, 1, 3, 2, 4], 95)).toBe(5)
    expect(percentile([], 50)).toBe(0)
  })

  it('summarizes rates, cost and the raw-confidence calibration table', () => {
    const expected = new Map<string, any>([
      ['a', { subject: 'single_garment', category: 'pants' }],
      ['b', { subject: 'single_garment', category: 'shirt' }],
      ['c', { subject: 'single_garment', category: 'pants' }],
      ['d', { subject: 'no_garment' }],
    ])
    const rec = (item: string, outcome: ItemOutcome, latencyMs: number): ItemRecord => ({
      config: 'g-A-768', provider: 'gemini', model: 'm', maxSide: 768, item, latencyMs,
      inputTokens: 1000, outputTokens: 100, costUsd: 0.0002, outcome, ...scoreItem(expected.get(item), outcome),
    })
    const s = summarize(
      [rec('a', garment({}, 0.96), 100), rec('b', garment({}, 0.6), 200), rec('c', { kind: 'rejected', subject: 'unclear' }, 300), rec('d', garment(), 400)],
      expected,
    )
    expect(s).toMatchObject({
      items: 4,
      subjectAccuracy: 0.5,
      falseRejectionRate: 0.3333,
      falseAcceptanceRate: 1,
      invalidRate: 0,
      errorRate: 0,
      fieldAccuracy: { category: { n: 2, accuracy: 0.5 } },
      colorConflictRate: 0,
      latencyMs: { p50: 200, p95: 400, max: 400 },
      meanInputTokens: 1000,
      meanOutputTokens: 100,
      totalCostUsd: 0.0008,
      costPer1000Usd: 0.2,
    })
    expect(s.calibration.find((b) => b.range === '0.5-0.7')).toEqual({ range: '0.5-0.7', n: 1, accuracy: 0 })
    expect(s.calibration.find((b) => b.range === '0.95-1')).toEqual({ range: '0.95-1', n: 1, accuracy: 1 })
  })

  it('reports no total cost when any call lacks a price or usage', () => {
    const expected = new Map<string, any>([['a', { subject: 'single_garment' }]])
    const s = summarize([{ config: 'x', provider: 'openai', model: 'm', maxSide: 1024, item: 'a', latencyMs: 1, outcome: { kind: 'error', error: 'timeout' }, fields: {}, subjectCorrect: false, subjectAcceptable: false, subjectOutcome: 'incorrect' }], expected)
    expect(s.totalCostUsd).toBeNull()
    expect(s.errorRate).toBe(1)
  })
})
