/**
 * The evaluation harness's own catalog and types (scripts/ai-eval/catalog.ts,
 * protocol.ts; docs/plan/B7.md, B7.4c) are the server's: the error kinds are
 * Go's, the catalog is the one Go embeds, and nothing of the harness imports
 * the web app's code.
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import * as local from '../../scripts/ai-eval/catalog'
import { AI_ERROR_KINDS, errorKindOf } from '../../scripts/ai-eval/protocol'

describe("the harness's protocol", () => {
  it("names Go's error kinds", () => {
    const go = readFileSync(path.resolve(__dirname, '../../../api/internal/ai/errors.go'), 'utf8')
    const kinds = [...go.matchAll(/^\t\w+\s+Kind = "([a-z_]+)"/gm)].map((m) => m[1])
    expect(kinds.length).toBeGreaterThan(5)
    expect([...AI_ERROR_KINDS].sort()).toEqual(kinds.sort())
  })

  it("reads the catalog Go embeds: every subcategory under a known category, ids unique, colours with a hex", () => {
    // catalog.ts reads the file next to the Go package that embeds it, so the harness scores with what Go serves.
    const goSource = readFileSync(path.resolve(__dirname, '../../../api/internal/catalog/catalog.go'), 'utf8')
    expect(goSource).toMatch(/^\/\/go:embed catalog\.json$/m)
    expect(local.CATEGORIES.length).toBeGreaterThan(0)
    expect(Object.keys(local.SUBCATEGORIES).sort()).toEqual(local.CATEGORIES.map((c) => c.id).sort())
    for (const list of [local.CATEGORIES, local.COLORS, local.PATTERNS, local.MATERIALS, local.STYLES, local.SEASONS, local.OCCASIONS, ...Object.values(local.SUBCATEGORIES)]) {
      expect(new Set(list.map((e) => e.id)).size).toBe(list.length)
    }
    for (const c of local.COLORS) expect(c.hex).toMatch(/^#[0-9A-Fa-f]{6}$/)
  })
})

describe('a scripted failure', () => {
  it('is read by its kind, whoever made it', () => {
    expect(errorKindOf(Object.assign(new Error('x'), { kind: 'rate_limited' }))).toBe('rate_limited')
    expect(errorKindOf({ kind: 'timeout' })).toBe('timeout')
    expect(errorKindOf({ kind: 'bogus' })).toBeNull()
    expect(errorKindOf(new Error('plain'))).toBeNull()
    expect(errorKindOf(null)).toBeNull()
    expect(errorKindOf('timeout')).toBeNull()
  })
})

describe("the harness stands without the web app's AI code", () => {
  it('no script of scripts/ai-eval imports src/ (it goes in B7.6)', () => {
    const root = path.resolve(__dirname, '../../scripts/ai-eval')
    const files = (readdirSync(root, { recursive: true }) as string[]).filter((f) => f.endsWith('.ts'))
    expect(files.length).toBeGreaterThan(30)
    const offenders = files.filter((f) => /from\s+['"](?:@\/|(?:\.\.\/)+src\/)|import\(\s*['"](?:@\/|(?:\.\.\/)+src\/)/.test(readFileSync(path.join(root, f), 'utf8')))
    expect(offenders).toEqual([])
  })
})
