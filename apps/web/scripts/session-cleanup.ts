/**
 * Manual session maintenance (dry run unless --apply). Uses DATABASE_URL.
 *
 *   bun scripts/session-cleanup.ts                         # dry run: what cleanup would change
 *   bun scripts/session-cleanup.ts --apply                 # clear stale ciphertexts, delete old rows
 *   bun scripts/session-cleanup.ts --preflight-families    # READ-ONLY, before the cutover migration
 *   add --json for machine-readable output
 *
 * Exit codes: 0 ok / clean; 1 error; preflight only: 2 anomalies found
 * (those families will be revoked at the cutover), 3 duplicate links (the
 * migration would fail — fix before cutting over).
 * Output contains user and session ids only (no tokens, hashes or e-mails).
 */
import { PrismaClient } from '@prisma/client'
import { cleanupSessions, preflightExitCode, preflightFamilies } from '../src/server/session/maintenance'

async function main(): Promise<number> {
  const args = new Set(process.argv.slice(2))
  const known = new Set(['--apply', '--json', '--preflight-families'])
  for (const a of args) if (!known.has(a)) throw new Error(`unknown option ${a}`)
  if (args.has('--apply') && args.has('--preflight-families')) throw new Error('--preflight-families is read-only; it takes no --apply')
  const json = args.has('--json')
  const client = new PrismaClient()
  try {
    if (args.has('--preflight-families')) {
      const report = await preflightFamilies(client)
      if (json) console.log(JSON.stringify(report, null, 2))
      else {
        console.log(`sessions: ${report.sessions}, components: ${report.components}`)
        console.log(`planned families: ${report.planned.healthyLive} live, ${report.planned.migratedRevoked} fully revoked, ${report.planned.anomaly} anomalous (revoked at cutover)`)
        console.log(
          `legacy lifetime (cutover now): ${report.legacyLifetime.fromChainStart} live chains keep chain start + 90 days, ` +
            `${report.legacyLifetime.transition} get the transition limit ${report.legacyLifetime.transitionEndsAt}`,
        )
        for (const d of report.duplicateLinks) console.log(`DUPLICATE LINK → ${d.replacedById} from ${d.predecessorIds.join(', ')}`)
        for (const a of report.anomalies) console.log(`anomaly ${a.key}: ${a.reasons.join('+')} user=${a.userId} sessions=${a.sessionIds.length} live=${a.liveSessionIds.length}`)
      }
      return preflightExitCode(report)
    }
    const report = await cleanupSessions(client, { apply: args.has('--apply') })
    if (json) console.log(JSON.stringify(report, null, 2))
    else {
      console.log(report.applied ? 'APPLIED' : 'DRY RUN (use --apply to change data)')
      console.log(`successor ciphertexts cleared: ${report.successorCiphertextsCleared}`)
      console.log(`rotated sessions deleted:      ${report.rotatedSessionsDeleted}`)
      console.log(`families deleted:              ${report.familiesDeleted} (with ${report.familySessionsDeleted} sessions)`)
    }
    return 0
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
