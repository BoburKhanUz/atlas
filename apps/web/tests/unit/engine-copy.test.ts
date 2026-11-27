/**
 * The Go service embeds a copy of the outfit engine's tables
 * (apps/api/internal/engine/tables.json). Until the cutover they are owned
 * here; this test fails when the copy and the source differ.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { engineCopy } from './engine-copy'

describe('the Go copy of the outfit engine tables', () => {
  it('equals the tables (run: bun scripts/engine-copy.ts ../api/internal/engine/tables.json)', () => {
    const copy = readFileSync(path.resolve(__dirname, '../../../api/internal/engine/tables.json'), 'utf8')
    expect(copy).toBe(engineCopy())
  })
})
