/**
 * Staging smoke mode (Phase 5.0). Pure: no Playwright, no network; unit-tested
 * in tests/unit/ai/staging-smoke.test.ts. See docs/ai/staging.md.
 *
 *   STAGING_SMOKE_PROVIDER=mock (default)  the target runs mock AI providers;
 *                                          the smoke asserts mock results
 *   STAGING_SMOKE_PROVIDER=real            the target runs a real provider; needs
 *                                          STAGING_SMOKE_REAL_PROVIDER_OPT_IN=1,
 *                                          and is refused under CI
 *
 * The smoke never holds a provider key: it only talks to the target over
 * HTTP. A real-provider run spends the target's provider budget, hence the
 * explicit opt-in.
 */
import { parseLogLines } from '../../scripts/ai-monitor'
import { aggregateAiEvents, type AiDashboard } from '../../src/lib/ai/monitoring-metrics'

export type SmokeProvider = 'mock' | 'real'

export interface SmokeMode {
  provider: SmokeProvider
  /** Log the run against an existing (allowlisted) staging account instead of a fresh user. */
  account: { email: string; password: string } | null
  /** Optional JSON-lines log of the target for the monitoring and privacy checks. */
  logFile: string | null
}

type Env = Record<string, string | undefined>

export function smokeMode(env: Env): SmokeMode {
  const raw = (env.STAGING_SMOKE_PROVIDER ?? '').trim().toLowerCase() || 'mock'
  if (raw !== 'mock' && raw !== 'real') throw new Error('STAGING_SMOKE_PROVIDER must be mock or real')
  if (raw === 'real') {
    if (env.CI) throw new Error('a real-provider smoke never runs in CI')
    if (env.STAGING_SMOKE_REAL_PROVIDER_OPT_IN !== '1') throw new Error('a real-provider smoke needs STAGING_SMOKE_REAL_PROVIDER_OPT_IN=1 (it spends the target provider budget)')
  }
  const email = env.STAGING_SMOKE_EMAIL?.trim(), password = env.STAGING_SMOKE_PASSWORD
  if (!!email !== !!password) throw new Error('set both STAGING_SMOKE_EMAIL and STAGING_SMOKE_PASSWORD, or neither')
  return { provider: raw, account: email && password ? { email, password } : null, logFile: env.STAGING_SMOKE_LOG_FILE?.trim() || null }
}

export interface SmokeLogVerdict {
  dashboard: AiDashboard
  /** Features with at least one ai.request event in the window. */
  features: string[]
  /** Providers seen on ai.request events. */
  providers: string[]
  quotaCharged: number
  /** Which forbidden values (by index, never the value) appeared anywhere in the log. */
  leaks: number[]
}

/**
 * Monitoring and privacy check of the target's log over the smoke window:
 * the AI events are there, and none of `forbidden` (the smoke user's email,
 * ids, message text…) appears anywhere in the log text.
 */
export function checkSmokeLog(text: string, forbidden: readonly string[], window: { from?: string; to?: string } = {}): SmokeLogVerdict {
  const dashboard = aggregateAiEvents(parseLogLines(text), window)
  return {
    dashboard,
    features: [...new Set(dashboard.requests.map((r) => r.feature))].sort(),
    providers: [...new Set(dashboard.requests.map((r) => r.provider))].sort(),
    quotaCharged: dashboard.quota.reduce((n, q) => n + q.charged, 0),
    leaks: forbidden.flatMap((v, i) => (v && text.includes(v) ? [i] : [])),
  }
}

/** What a provider name on an ai.request event means for the mode. */
export const isMockProviderName = (name: string) => name === 'mock'
