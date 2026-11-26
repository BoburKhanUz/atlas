/**
 * Writes the legal texts as the Go service embeds them: the body of
 * GET /api/v1/legal, exactly as this server answers it.
 *
 * The texts are owned here (src/lib/legal) until the cutover (stage B7).
 * tests/unit/legal-bundle-copy.test.ts fails when the copy is stale, so a
 * change to the texts or their version is followed by:
 *
 *   cd apps/web && bun scripts/legal-bundle.ts ../api/internal/legal/documents.json
 */
import { writeFileSync } from 'node:fs'
import { legalBundle } from '@/lib/legal/documents'

const out = process.argv[2]
if (!out) throw new Error('usage: bun scripts/legal-bundle.ts <output.json>')
writeFileSync(out, JSON.stringify(legalBundle()) + '\n')
console.log(`wrote ${out}`)
