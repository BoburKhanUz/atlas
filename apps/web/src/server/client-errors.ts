/**
 * Error reports from the apps (POST /api/v1/client-errors): our own crash
 * monitoring, no third party. Each report becomes one `client error` line in
 * the server log (docs/ai/monitoring.md); nothing is stored in the database.
 * The apps scrub reports before sending; the same rules run again here
 * (src/lib/error-scrub.ts), then the log redaction.
 */
import type { z } from 'zod'
import { normalizeRoute, scrubErrorText } from '@/lib/error-scrub'
import { log } from '@/server/log'
import type { ClientErrorReport } from '@/server/schemas/requests'

type Report = z.infer<typeof ClientErrorReport>

export function logClientErrors(reports: Report[]): void {
  for (const r of reports) {
    log.error('client error', {
      platform: r.platform,
      appVersion: r.appVersion,
      osVersion: r.osVersion,
      kind: r.kind,
      fatal: r.fatal ?? false,
      errorType: scrubErrorText(r.errorType),
      message: scrubErrorText(r.message),
      stack: r.stack ? scrubErrorText(r.stack) : undefined,
      route: r.route ? normalizeRoute(r.route) : undefined,
      occurredAt: r.occurredAt,
    })
  }
}
