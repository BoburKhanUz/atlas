/**
 * Staging smoke mode (Phase 5.0). Pure except goDashboard, which runs the Go
 * binary; unit-tested in tests/unit/staging-smoke.test.ts and, through the
 * binary, tests/eval-go/staging-smoke.evalgo.ts. See docs/ai/staging.md.
 *
 *   STAGING_SMOKE_PROVIDER=mock (default)  the target runs mock AI providers;
 *                                          the smoke asserts mock results
 *   STAGING_SMOKE_PROVIDER=real            the target runs a real provider; needs
 *                                          STAGING_SMOKE_REAL_PROVIDER_OPT_IN=1,
 *                                          and is refused under CI
 *
 * The smoke never holds a provider key: it only talks to the target over
 * HTTP. A real-provider run spends the target's provider budget, hence the
 * explicit opt-in (and the owner's approval, CLAUDE.md rule 4).
 */
import { execFileSync } from 'node:child_process'

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

/** The part of `lookly ai-monitor --json`'s dashboard the smoke reads. */
export interface SmokeDashboard {
  requests: Array<{ feature: string; provider: string }>
  quota: Array<{ feature: string; provider: string; charged: number }>
}

/**
 * The AI dashboard of a log file from `from` on, as the Go server's operator
 * command computes it (`lookly ai-monitor --json`, docs/ai/monitoring.md). Its
 * exit code 2 only says that an alert fired, which the smoke does not judge.
 */
export function goDashboard(binary: string, logFile: string, from?: string): SmokeDashboard {
  const args = ['ai-monitor', '--json', `--input=${logFile}`, ...(from ? [`--from=${from}`] : [])]
  let out: string
  try {
    out = execFileSync(binary, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    if (e.status !== 2 || !e.stdout) throw new Error(`lookly ai-monitor failed (exit ${e.status ?? '?'}): ${(e.stderr ?? '').trim()}`)
    out = e.stdout
  }
  return (JSON.parse(out) as { dashboard: SmokeDashboard }).dashboard
}

export interface SmokeLogVerdict {
  /** Features with at least one ai.request event in the window. */
  features: string[]
  /** Providers seen on ai.request events. */
  providers: string[]
  /** Units charged to an AI provider's daily quota (the mock is never charged). */
  quotaCharged: number
  /** Colour analyses counted: their daily limit applies whatever the provider (B6). */
  colorAnalysesCharged: number
  /** Which forbidden values (by index, never the value) appeared anywhere in the log. */
  leaks: number[]
}

/**
 * Monitoring and privacy check of the target's log over the smoke window: the
 * AI events are there (from the dashboard), and none of `forbidden` (the smoke
 * user's email, ids, message text…) appears anywhere in the log text.
 */
export function checkSmokeLog(text: string, forbidden: readonly string[], dashboard: SmokeDashboard): SmokeLogVerdict {
  return {
    features: [...new Set(dashboard.requests.map((r) => r.feature))].sort(),
    providers: [...new Set(dashboard.requests.map((r) => r.provider))].sort(),
    quotaCharged: dashboard.quota.filter((q) => q.provider !== 'deterministic').reduce((n, q) => n + q.charged, 0),
    colorAnalysesCharged: dashboard.quota.filter((q) => q.feature === 'color_analysis').reduce((n, q) => n + q.charged, 0),
    leaks: forbidden.flatMap((v, i) => (v && text.includes(v) ? [i] : [])),
  }
}

/** What a provider name on an ai.request event means for the mode. */
export const isMockProviderName = (name: string) => name === 'mock'
