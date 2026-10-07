/**
 * Log-based AI metrics and alert rules (pure; no I/O). Input: the content-free
 * `ai.call` / `ai.request` / `ai.quota` events (as written by monitoring.ts,
 * one JSON log line each). Output: a dashboard snapshot and firing alerts.
 * Used by scripts/ai-monitor.ts; a metrics backend can implement the same
 * rules natively later (see docs/ai/monitoring.md).
 *
 * Every threshold here is INITIAL / TO BE CALIBRATED AFTER LIVE BAKE-OFF.
 */

export interface AiLogEvent {
  msg: string
  ts?: string
  [key: string]: unknown
}

// ─── Statistics ─────────────────────────────────────────────────────────────

/** Nearest-rank percentile of non-negative finite numbers; null when empty. */
export function percentile(values: number[], p: number): number | null {
  const v = values.filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b)
  if (v.length === 0) return null
  return v[Math.min(v.length - 1, Math.max(0, Math.ceil((p / 100) * v.length) - 1))]
}
const ratio = (a: number, b: number) => (b === 0 ? null : Math.round((a / b) * 10_000) / 10_000)
const str = (v: unknown, fallback = 'unknown') => (typeof v === 'string' && v ? v : fallback)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined)
const inc = (m: Record<string, number>, k: string) => {
  m[k] = (m[k] ?? 0) + 1
}

// ─── Aggregation ────────────────────────────────────────────────────────────

export interface CallMetrics {
  feature: string
  provider: string
  model: string
  calls: number
  success: number
  failure: number
  successRate: number | null
  timeouts: number
  timeoutRate: number | null
  errorCodes: Record<string, number>
  httpStatus: Record<string, number>
  retry: { none: number; succeeded: number; failed: number }
  latencyMs: { p50: number | null; p95: number | null; p99: number | null; max: number | null }
  /** Calls that reported provider usage; totals only over those. */
  usage: { calls: number; input: number; output: number; inputP50: number | null; inputP95: number | null; outputP50: number | null; outputP95: number | null }
  /** Sum of estimated cost; null when no call had a configured price. */
  costUsd: number | null
}

export interface RequestMetrics {
  feature: string
  provider: string
  requests: number
  outcomes: Record<string, number>
  reasons: Record<string, number>
  corrected: number
  billable: number
  latencyMs: { p50: number | null; p95: number | null; p99: number | null }
}

export interface QuotaMetrics {
  feature: string
  provider: string
  charged: number
  rejected: number
  refunded: number
  storeErrors: number
  /** rejected / (charged + rejected) */
  rejectionRate: number | null
  refundReasons: Record<string, number>
}

export interface AiDashboard {
  window: { from: string | null; to: string | null; events: number }
  calls: CallMetrics[]
  requests: RequestMetrics[]
  quota: QuotaMetrics[]
}

/** Keeps ai.* events inside [from, to] (ISO timestamps, inclusive); unparseable lines are skipped by the caller. */
export function inWindow(events: AiLogEvent[], from?: string, to?: string): AiLogEvent[] {
  const f = from ? Date.parse(from) : -Infinity
  const t = to ? Date.parse(to) : Infinity
  return events.filter((e) => {
    if (e.msg !== 'ai.call' && e.msg !== 'ai.request' && e.msg !== 'ai.quota') return false
    const at = e.ts ? Date.parse(e.ts) : NaN
    return Number.isNaN(at) ? from === undefined && to === undefined : at >= f && at <= t
  })
}

export function aggregateAiEvents(events: AiLogEvent[], window: { from?: string; to?: string } = {}): AiDashboard {
  const selected = inWindow(events, window.from, window.to)
  const calls = new Map<string, { m: CallMetrics; lat: number[]; inTok: number[]; outTok: number[]; cost: number[] }>()
  const requests = new Map<string, { m: RequestMetrics; lat: number[] }>()
  const quota = new Map<string, QuotaMetrics>()

  for (const e of selected) {
    const feature = str(e.feature)
    const provider = str(e.provider)
    if (e.msg === 'ai.call') {
      const model = str(e.model)
      const key = `${feature}|${provider}|${model}`
      let g = calls.get(key)
      if (!g) {
        g = {
          m: {
            feature, provider, model, calls: 0, success: 0, failure: 0, successRate: null, timeouts: 0, timeoutRate: null,
            errorCodes: {}, httpStatus: {}, retry: { none: 0, succeeded: 0, failed: 0 },
            latencyMs: { p50: null, p95: null, p99: null, max: null },
            usage: { calls: 0, input: 0, output: 0, inputP50: null, inputP95: null, outputP50: null, outputP95: null }, costUsd: null,
          },
          lat: [], inTok: [], outTok: [], cost: [],
        }
        calls.set(key, g)
      }
      const ok = e.success === true || (e.success === undefined && e.outcome === 'ok')
      g.m.calls++
      if (ok) g.m.success++
      else {
        g.m.failure++
        const code = str(e.errorCode ?? e.outcome, 'error')
        inc(g.m.errorCodes, code)
        if (code === 'timeout') g.m.timeouts++
      }
      const status = num(e.httpStatus)
      if (status !== undefined) inc(g.m.httpStatus, String(status))
      const attempts = num(e.attempts) ?? 1
      const retry = e.retry === 'none' || e.retry === 'succeeded' || e.retry === 'failed' ? e.retry : attempts <= 1 ? 'none' : ok ? 'succeeded' : 'failed'
      g.m.retry[retry]++
      const lat = num(e.latencyMs)
      if (lat !== undefined) g.lat.push(lat)
      const i = num(e.usageInput), o = num(e.usageOutput)
      if (i !== undefined || o !== undefined) {
        g.m.usage.calls++
        if (i !== undefined) g.inTok.push(i)
        if (o !== undefined) g.outTok.push(o)
      }
      const c = num(e.costUsd)
      if (c !== undefined) g.cost.push(c)
    } else if (e.msg === 'ai.request') {
      const key = `${feature}|${provider}`
      let g = requests.get(key)
      if (!g) {
        g = { m: { feature, provider, requests: 0, outcomes: {}, reasons: {}, corrected: 0, billable: 0, latencyMs: { p50: null, p95: null, p99: null } }, lat: [] }
        requests.set(key, g)
      }
      g.m.requests++
      inc(g.m.outcomes, str(e.outcome))
      if (typeof e.reason === 'string') inc(g.m.reasons, e.reason)
      if (e.corrected === true) g.m.corrected++
      if (e.billable === true) g.m.billable++
      const lat = num(e.latencyMs)
      if (lat !== undefined) g.lat.push(lat)
    } else {
      const key = `${feature}|${provider}`
      let q = quota.get(key)
      if (!q) {
        q = { feature, provider, charged: 0, rejected: 0, refunded: 0, storeErrors: 0, rejectionRate: null, refundReasons: {} }
        quota.set(key, q)
      }
      if (e.action === 'charged') q.charged++
      else if (e.action === 'rejected') q.rejected++
      else if (e.action === 'refunded') {
        q.refunded++
        inc(q.refundReasons, str(e.reason))
      } else if (e.action === 'store_error') q.storeErrors++
    }
  }

  const sum = (v: number[]) => v.reduce((a, b) => a + b, 0)
  const byKey = <T extends { feature: string; provider: string; model?: string }>(a: T, b: T) =>
    `${a.feature}|${a.provider}|${a.model ?? ''}`.localeCompare(`${b.feature}|${b.provider}|${b.model ?? ''}`)
  return {
    window: { from: window.from ?? null, to: window.to ?? null, events: selected.length },
    calls: [...calls.values()]
      .map(({ m, lat, inTok, outTok, cost }) => ({
        ...m,
        successRate: ratio(m.success, m.calls),
        timeoutRate: ratio(m.timeouts, m.calls),
        latencyMs: { p50: percentile(lat, 50), p95: percentile(lat, 95), p99: percentile(lat, 99), max: lat.length ? Math.max(...lat) : null },
        usage: { ...m.usage, input: sum(inTok), output: sum(outTok), inputP50: percentile(inTok, 50), inputP95: percentile(inTok, 95), outputP50: percentile(outTok, 50), outputP95: percentile(outTok, 95) },
        costUsd: cost.length ? Math.round(sum(cost) * 1e6) / 1e6 : null,
      }))
      .sort(byKey),
    requests: [...requests.values()]
      .map(({ m, lat }) => ({ ...m, latencyMs: { p50: percentile(lat, 50), p95: percentile(lat, 95), p99: percentile(lat, 99) } }))
      .sort(byKey),
    quota: [...quota.values()].map((q) => ({ ...q, rejectionRate: ratio(q.rejected, q.charged + q.rejected) })).sort(byKey),
  }
}

// ─── Alerts ─────────────────────────────────────────────────────────────────

export interface AlertThresholds {
  /** Minimum events in the window before a rate alert can fire (avoids noise). */
  minSample: number
  errorRateWarning: number
  errorRateCritical: number
  timeoutRate: number
  /** p95 latency per feature (ms): a fraction of the per-attempt timeout budget. */
  p95LatencyMs: Record<string, number>
  quotaRejectionRate: number
  outfitFallbackRate: number
  /** Consecutive failed calls of one provider (any feature). */
  consecutiveFailures: number
  /** Usage (tokens, else calls) vs baseline: alert above factor× or below 1/factor. */
  usageAnomalyFactor: number
  usageBaselineMinCalls: number
}

/**
 * INITIAL / TO BE CALIBRATED AFTER LIVE BAKE-OFF. Derived only from the
 * configured budgets (timeouts 25 s stylist / 15 s vision and outfit) and
 * common starting points; no live provider data exists yet.
 */
export const INITIAL_ALERT_THRESHOLDS: AlertThresholds = {
  minSample: 20,
  errorRateWarning: 0.05,
  errorRateCritical: 0.2,
  timeoutRate: 0.02,
  p95LatencyMs: { stylist_chat: 20_000, clothing_analysis: 12_000, outfit_explanation: 12_000 },
  quotaRejectionRate: 0.1,
  outfitFallbackRate: 0.1,
  consecutiveFailures: 5,
  usageAnomalyFactor: 2,
  usageBaselineMinCalls: 50,
}

export type AlertName =
  | 'ai_error_rate'
  | 'ai_p95_latency'
  | 'ai_timeout_rate'
  | 'ai_quota_rejection_rate'
  | 'ai_outfit_fallback_rate'
  | 'ai_provider_availability'
  | 'ai_provider_auth_or_config'
  | 'ai_usage_anomaly'

export interface Alert {
  name: AlertName
  severity: 'warning' | 'critical'
  feature?: string
  provider: string
  model?: string
  value: number
  threshold: number
  provisional: true
}

const REAL = (provider: string) => provider !== 'mock' && provider !== 'deterministic'

/** Longest run of consecutive failed ai.call events per provider, in event order. */
export function failureStreaks(events: AiLogEvent[]): Record<string, number> {
  const current: Record<string, number> = {}
  const max: Record<string, number> = {}
  for (const e of events) {
    if (e.msg !== 'ai.call') continue
    const p = str(e.provider)
    const ok = e.success === true || (e.success === undefined && e.outcome === 'ok')
    current[p] = ok ? 0 : (current[p] ?? 0) + 1
    max[p] = Math.max(max[p] ?? 0, current[p])
  }
  return max
}

export function evaluateAlerts(
  dashboard: AiDashboard,
  events: AiLogEvent[],
  t: AlertThresholds = INITIAL_ALERT_THRESHOLDS,
  baseline?: AiDashboard,
): Alert[] {
  const alerts: Alert[] = []
  const add = (a: Omit<Alert, 'provisional'>) => alerts.push({ ...a, value: Math.round(a.value * 10_000) / 10_000, provisional: true })
  for (const c of dashboard.calls) {
    if (!REAL(c.provider)) continue
    const base = { feature: c.feature, provider: c.provider, model: c.model }
    if (c.calls >= t.minSample) {
      const errorRate = c.failure / c.calls
      if (errorRate > t.errorRateCritical) add({ ...base, name: 'ai_error_rate', severity: 'critical', value: errorRate, threshold: t.errorRateCritical })
      else if (errorRate > t.errorRateWarning) add({ ...base, name: 'ai_error_rate', severity: 'warning', value: errorRate, threshold: t.errorRateWarning })
      if ((c.timeoutRate ?? 0) > t.timeoutRate) add({ ...base, name: 'ai_timeout_rate', severity: 'warning', value: c.timeoutRate!, threshold: t.timeoutRate })
      const limit = t.p95LatencyMs[c.feature]
      if (limit !== undefined && (c.latencyMs.p95 ?? 0) > limit) add({ ...base, name: 'ai_p95_latency', severity: 'warning', value: c.latencyMs.p95!, threshold: limit })
    }
    const authOrConfig = (c.errorCodes.auth ?? 0) + (c.errorCodes.config ?? 0)
    if (authOrConfig > 0) add({ ...base, name: 'ai_provider_auth_or_config', severity: 'critical', value: authOrConfig, threshold: 0 })
  }
  for (const [provider, streak] of Object.entries(failureStreaks(inWindow(events, dashboard.window.from ?? undefined, dashboard.window.to ?? undefined)))) {
    if (REAL(provider) && streak >= t.consecutiveFailures) add({ name: 'ai_provider_availability', severity: 'critical', provider, value: streak, threshold: t.consecutiveFailures })
  }
  for (const q of dashboard.quota) {
    if (q.charged + q.rejected >= t.minSample && (q.rejectionRate ?? 0) > t.quotaRejectionRate) {
      add({ name: 'ai_quota_rejection_rate', severity: 'warning', feature: q.feature, provider: q.provider, value: q.rejectionRate!, threshold: t.quotaRejectionRate })
    }
  }
  for (const r of dashboard.requests) {
    if (r.feature !== 'outfit_explanation' || !REAL(r.provider)) continue
    // Fallbacks the system chose on purpose (quota) are not provider problems.
    const fallbacks = (r.outcomes.fallback ?? 0) - (r.reasons.quota_exceeded ?? 0)
    const relevant = r.requests - (r.reasons.quota_exceeded ?? 0)
    if (relevant >= t.minSample && fallbacks / relevant > t.outfitFallbackRate) {
      add({ name: 'ai_outfit_fallback_rate', severity: 'warning', feature: r.feature, provider: r.provider, value: fallbacks / relevant, threshold: t.outfitFallbackRate })
    }
  }
  if (baseline) {
    const usage = (d: AiDashboard, p: string) => {
      const calls = d.calls.filter((c) => c.provider === p)
      const tokens = calls.reduce((s, c) => s + c.usage.input + c.usage.output, 0)
      return { calls: calls.reduce((s, c) => s + c.calls, 0), amount: tokens > 0 ? tokens : calls.reduce((s, c) => s + c.calls, 0) }
    }
    const providers = new Set([...dashboard.calls, ...baseline.calls].map((c) => c.provider).filter(REAL))
    for (const p of [...providers].sort()) {
      const now = usage(dashboard, p), base = usage(baseline, p)
      if (base.calls < t.usageBaselineMinCalls || base.amount === 0) continue
      const factor = now.amount / base.amount
      if (factor > t.usageAnomalyFactor || factor < 1 / t.usageAnomalyFactor) {
        add({ name: 'ai_usage_anomaly', severity: 'warning', provider: p, value: Math.round(factor * 1000) / 1000, threshold: t.usageAnomalyFactor })
      }
    }
  }
  return alerts.sort((a, b) => `${a.name}|${a.provider}|${a.feature ?? ''}`.localeCompare(`${b.name}|${b.provider}|${b.feature ?? ''}`))
}
