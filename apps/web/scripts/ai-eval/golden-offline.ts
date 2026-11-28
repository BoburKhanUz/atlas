/**
 * Writes the offline golden file of the evaluation harness
 * (tests/eval-go/golden/offline.json, docs/plan/B7.md B7.4) from the Go
 * pipeline (`lookly eval`, LOOKLY_BINARY). It was first written from the
 * TypeScript pipeline, which gave the same records (B7.4a); the two
 * robustness scenarios on an answer that is not JSON follow Go's outcome
 * since the owner's decision of 2026-11-28 (B7.4f). The file is the
 * reference the Go pipeline is held to: a change of the requests is a prompt
 * change, a change of the checks or the pass an evaluator change; both need
 * the owner's approval (rule 6) before the file is written again.
 *
 *   cd apps/web && LOOKLY_BINARY=<built lookly> bun scripts/ai-eval/golden-offline.ts
 */
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { collectOffline, goOfflinePipeline } from './offline-scenarios'

async function main() {
  const golden = await collectOffline(goOfflinePipeline())
  const out = path.resolve(__dirname, '../../tests/eval-go/golden/offline.json')
  writeFileSync(out, JSON.stringify({ generatedBy: 'apps/web/scripts/ai-eval/golden-offline.ts (the Go pipeline, lookly eval)', ...golden }, null, 1) + '\n')
  console.log(`stylist ${golden.stylist.length}, outfit ${golden.outfit.length}, failures ${golden.failures.length}, vision ${golden.vision.length}, robustness ${golden.robustness.length} → ${out}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
