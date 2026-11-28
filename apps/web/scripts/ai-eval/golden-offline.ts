/**
 * Writes the offline golden file of the evaluation harness
 * (tests/eval-go/golden/offline.json, docs/plan/B7.md B7.4) from the TypeScript
 * pipeline, which today gives the same records as the Go one (the offline
 * tests prove it). Once the TypeScript pipeline is gone, the file is the
 * reference the Go pipeline is held to: a change of the requests is a prompt
 * change, a change of the checks or the pass an evaluator change; both need the
 * owner's approval (rules 6) before the file is written again.
 *
 *   cd apps/web && bun scripts/ai-eval/golden-offline.ts
 */
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { collectOffline, VISION_SETTINGS } from './offline-scenarios'
import { runOutfitCase } from './outfit-eval'
import { runStylistCase } from './stylist-eval'
import { runOne } from './vision-eval'

async function main() {
  const ts = { stylist: runStylistCase, outfit: runOutfitCase }
  const golden = await collectOffline({
    ...ts,
    withShortTimeout: ts,
    vision: async (p, bytes) => {
      const r = await runOne(p, VISION_SETTINGS as never, bytes)
      return { outcome: r.outcome, usage: r.usage }
    },
  })
  const out = path.resolve(__dirname, '../../tests/eval-go/golden/offline.json')
  writeFileSync(out, JSON.stringify({ generatedBy: 'apps/web/scripts/ai-eval/golden-offline.ts (the TypeScript pipeline)', ...golden }, null, 1) + '\n')
  console.log(`stylist ${golden.stylist.length}, outfit ${golden.outfit.length}, failures ${golden.failures.length}, vision ${golden.vision.length}, robustness ${golden.robustness.length} → ${out}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
