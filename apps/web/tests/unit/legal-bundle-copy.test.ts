/**
 * The Go service embeds a copy of the legal texts
 * (apps/api/internal/legal/documents.json). Until the cutover the texts are
 * owned here; this test fails when the copy and the source differ.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { legalBundle } from '@/lib/legal/documents'

describe('the Go copy of the legal texts', () => {
  it('equals GET /api/v1/legal (run: bun scripts/legal-bundle.ts ../api/internal/legal/documents.json)', () => {
    const copy = readFileSync(path.resolve(__dirname, '../../../api/internal/legal/documents.json'), 'utf8')
    expect(copy).toBe(JSON.stringify(legalBundle()) + '\n')
  })
})
