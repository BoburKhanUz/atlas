/**
 * Delete stored image files that no database row references (dry run unless
 * --apply). Uses DATABASE_URL, STORAGE_DRIVER and STORAGE_LOCAL_DIR.
 *
 *   bun scripts/storage-sweep.ts [--apply] [--json] [--min-age-minutes=60]
 *
 * Files younger than --min-age-minutes (default 60) are kept: an upload writes
 * its files before its database row commits. Run after a rollback/roll-forward
 * (display variants left behind) and occasionally. Exit 0 ok, 1 error.
 */
import { PrismaClient } from '@prisma/client'
import { getStorageProvider } from '../src/lib/storage/provider'
import { sweepStorage } from '../src/server/media/maintenance'

async function main() {
  const args = process.argv.slice(2)
  let minAgeMinutes = 60
  for (const a of args) {
    if (a === '--apply' || a === '--json') continue
    const m = /^--min-age-minutes=(\d+)$/.exec(a)
    if (m) minAgeMinutes = Number(m[1])
    else throw new Error(`unknown option ${a}`)
  }
  const client = new PrismaClient()
  try {
    const report = await sweepStorage(client, getStorageProvider(), { apply: args.includes('--apply'), minAgeMs: minAgeMinutes * 60_000 })
    if (args.includes('--json')) console.log(JSON.stringify(report, null, 2))
    else {
      console.log(report.applied ? 'APPLIED' : 'DRY RUN (use --apply to delete)')
      console.log(`files: ${report.files}, referenced: ${report.referenced}, orphans: ${report.orphans.length}, recent unreferenced (kept): ${report.recentUnreferenced}`)
      for (const k of report.orphans) console.log(`orphan ${k}`)
      for (const k of report.unknown) console.log(`UNKNOWN FILE (not deleted) ${k}`)
    }
  } finally {
    await client.$disconnect()
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  },
)
