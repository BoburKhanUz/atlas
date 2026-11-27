/**
 * Writes the outfit engine's tables as the Go service embeds them
 * (apps/api/internal/engine/tables.json). They are owned here
 * (src/lib/ai/outfit-config.ts and the modules tests/unit/engine-copy.ts
 * names) until the cutover (stage B7); tests/unit/engine-copy.test.ts fails
 * when the copy is stale, so a change to them is followed by:
 *
 *   cd apps/web && bun scripts/engine-copy.ts ../api/internal/engine/tables.json
 *
 * and, when rules or rankings change, by new golden vectors
 * (scripts/golden-engine.ts).
 */
import { writeFileSync } from 'node:fs'
import { engineCopy } from '../tests/unit/engine-copy'

const out = process.argv[2]
if (!out) throw new Error('usage: bun scripts/engine-copy.ts <output.json>')
writeFileSync(out, engineCopy())
console.log(`wrote ${out}`)
