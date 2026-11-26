/**
 * Writes the clothing catalog as the Go service embeds it
 * (apps/api/internal/catalog/catalog.json). The catalog is owned here
 * (src/lib/ai/catalog.ts) until the cutover (stage B7);
 * tests/unit/catalog-copy.test.ts fails when the copy is stale, so a change
 * to the catalog is followed by:
 *
 *   cd apps/web && bun scripts/catalog-copy.ts ../api/internal/catalog/catalog.json
 */
import { writeFileSync } from 'node:fs'
import { catalogCopy } from '../tests/unit/catalog-copy'

const out = process.argv[2]
if (!out) throw new Error('usage: bun scripts/catalog-copy.ts <output.json>')
writeFileSync(out, catalogCopy())
console.log(`wrote ${out}`)
