/**
 * Create the 1600 px WebP display variant for images uploaded before display
 * variants existed (dry run unless --apply; safe to re-run). Until it runs,
 * the API serves those images' masters as `url`.
 *
 *   bun scripts/backfill-display-variants.ts [--apply] [--json]
 *
 * Exit 0 ok, 1 error, 2 some images failed (listed by id).
 */
import { PrismaClient } from '@prisma/client'
import { getStorageProvider } from '../src/lib/storage/provider'
import { backfillDisplayVariants } from '../src/server/media/maintenance'

async function main(): Promise<number> {
  const args = process.argv.slice(2)
  for (const a of args) if (a !== '--apply' && a !== '--json') throw new Error(`unknown option ${a}`)
  const client = new PrismaClient()
  try {
    const report = await backfillDisplayVariants(client, getStorageProvider(), { apply: args.includes('--apply') })
    if (args.includes('--json')) console.log(JSON.stringify(report, null, 2))
    else {
      console.log(report.applied ? 'APPLIED' : 'DRY RUN (use --apply to create display variants)')
      console.log(`images without a display variant: ${report.missingDisplay}, created: ${report.created}, failed: ${report.failed.length}`)
      for (const f of report.failed) console.log(`failed ${f.imageId}: ${f.reason}`)
    }
    return report.failed.length ? 2 : 0
  } finally {
    await client.$disconnect()
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  },
)
