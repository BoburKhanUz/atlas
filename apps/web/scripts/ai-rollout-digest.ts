/**
 * Prints the AI_ROLLOUT_ALLOWLIST digest of one or more user ids (Phase 5.0).
 * The environment holds digests, never raw ids.
 *
 *   bun scripts/ai-rollout-digest.ts <userId> [<userId> …]
 *
 * Output: one digest per line, in argument order (nothing else is printed).
 */
import { allowlistDigest } from '../src/lib/ai/rollout'

const ids = process.argv.slice(2).map((a) => a.trim()).filter(Boolean)
if (ids.length === 0) {
  console.error('usage: bun scripts/ai-rollout-digest.ts <userId> [<userId> …]')
  process.exit(1)
}
for (const id of ids) console.log(allowlistDigest(id))
