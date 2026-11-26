/**
 * The Go service embeds a copy of the clothing catalog
 * (apps/api/internal/catalog/catalog.json). Until the cutover the catalog is
 * owned here; this test fails when the copy and the source differ.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { catalogCopy } from './catalog-copy'

describe('the Go copy of the clothing catalog', () => {
  it('equals the catalog (run: bun scripts/catalog-copy.ts ../api/internal/catalog/catalog.json)', () => {
    const copy = readFileSync(path.resolve(__dirname, '../../../api/internal/catalog/catalog.json'), 'utf8')
    expect(copy).toBe(catalogCopy())
  })
})
