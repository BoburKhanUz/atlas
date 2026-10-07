/**
 * AI monitoring (operational observability, content-free).
 *
 * Three event types, all emitted through pluggable sinks (default: the
 * structured JSON logger, i.e. log-based metrics — no metrics backend needed):
 *
 *   ai.call     one per provider call made through client.ts (attempt-level:
 *               provider, model, outcome, latency, retries, usage, cost)
 *   ai.request  one per feature request (stylist turn, garment analysis,
 *               outfit ranking): the outcome the user got, typed reason,
 *               whether a correction ran, total latency, whether billable
 *   ai.quota    quota decisions: charged, rejected, refunded, store_error
 *
 * PRIVACY (hard rule): every event passes `sanitizeAiEvent`, a per-event
 * whitelist. Only known keys survive; strings must be short identifier-like
 * codes (no spaces, so no sentences, prompts, answers or URLs), numbers must be
 * finite and ≥ 0, booleans stay booleans. Nothing else can be emitted — even if
 * a caller passes user content by mistake. No user, conversation or item ids.
 *
 * A future metrics backend (Prometheus, OpenTelemetry, a cloud agent) is a new
 * sink (`setAiMonitoringSinks`); the AI services do not change.
 */
import { log } from '@/server/log'

export const AI_MONITORING_SCHEMA_VERSION = 2

export type AiEventName = 'ai.call' | 'ai.request' | 'ai.quota'
export type AiMonitoringEvent = { event: AiEventName } & Record<string, unknown>

/** Allowed fields per event, and their kind. */
const FIELDS: Record<AiEventName, Record<string, 'code' | 'model' | 'number' | 'boolean'>> = {
  'ai.call': {
    feature: 'code',
    provider: 'code',
    model: 'model',
    outcome: 'code',
    success: 'boolean',
    errorCode: 'code',
    httpStatus: 'number',
    latencyMs: 'number',
    attempts: 'number',
    retried: 'boolean',
    retry: 'code',
    usageInput: 'number',
    usageOutput: 'number',
    usageTotal: 'number',
    costUsd: 'number',
    environment: 'code',
    schemaVersion: 'number',
  },
  'ai.request': {
    feature: 'code',
    provider: 'code',
    model: 'model',
    outcome: 'code',
    reason: 'code',
    corrected: 'boolean',
    billable: 'boolean',
    latencyMs: 'number',
    environment: 'code',
    schemaVersion: 'number',
  },
  'ai.quota': {
    feature: 'code',
    provider: 'code',
    action: 'code',
    reason: 'code',
    environment: 'code',
    schemaVersion: 'number',
  },
}

/** Short lowercase codes only: no spaces, so no free text can pass. */
const CODE = /^[a-z0-9][a-z0-9_.:-]{0,63}$/
/** Model ids as validated by the AI configuration. */
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/

/** Keeps only the whitelisted, well-typed fields of an event; drops everything else. */
export function sanitizeAiEvent(input: AiMonitoringEvent): AiMonitoringEvent | null {
  const spec = FIELDS[input.event]
  if (!spec) return null
  const out: AiMonitoringEvent = { event: input.event }
  for (const [key, kind] of Object.entries(spec)) {
    const v = input[key]
    if (v === undefined || v === null) continue
    if (kind === 'boolean' && typeof v === 'boolean') out[key] = v
    else if (kind === 'number' && typeof v === 'number' && Number.isFinite(v) && v >= 0) out[key] = Math.round(v * 1e6) / 1e6
    else if (kind === 'code' && typeof v === 'string' && CODE.test(v)) out[key] = v
    else if (kind === 'model' && typeof v === 'string' && MODEL.test(v)) out[key] = v
  }
  return out
}

// ─── Sinks ──────────────────────────────────────────────────────────────────

export interface AiMonitoringSink {
  emit(event: AiMonitoringEvent): void
}

/** Default sink: one structured log line per event (msg = event name). */
export const logSink: AiMonitoringSink = {
  emit(e) {
    const { event, ...fields } = e
    const failed = (event === 'ai.call' && e.success === false) || (event === 'ai.request' && e.outcome !== 'ok' && e.outcome !== 'replay' && e.outcome !== 'disabled')
    if (failed) log.warn(event, fields)
    else log.info(event, fields)
  },
}

let sinks: AiMonitoringSink[] = [logSink]

/** Replaces the sinks (e.g. log + a metrics backend). Tests may capture events. */
export function setAiMonitoringSinks(next: AiMonitoringSink[] | null): void {
  sinks = next ?? [logSink]
}

const environment = () => {
  const env = process.env.NODE_ENV
  return env === 'production' || env === 'development' || env === 'test' ? env : 'unknown'
}

/** Emits a sanitized event to every sink. Monitoring never breaks a request. */
export function emitAiEvent(input: AiMonitoringEvent): void {
  const event = sanitizeAiEvent({ ...input, environment: environment(), schemaVersion: AI_MONITORING_SCHEMA_VERSION })
  if (!event) return
  for (const sink of sinks) {
    try {
      sink.emit(event)
    } catch {
      // A failing sink must not affect the AI request.
    }
  }
}

// ─── Typed helpers used by the AI services ──────────────────────────────────

export type AiRequestFeature = 'stylist_chat' | 'clothing_analysis' | 'outfit_explanation'

/** What the user got from a feature request. */
export type AiRequestOutcome =
  | 'ok' // a validated AI result
  | 'fallback' // outfit only: deterministic order/explanations
  | 'ai_unavailable' // typed AI_UNAVAILABLE to the user
  | 'quota_exceeded' // typed quota error (stylist, vision); outfit reports 'fallback' with reason quota_exceeded
  | 'not_a_garment' // vision: the image is not a single garment
  | 'image_rejected' // vision: undecodable image or provider safety refusal
  | 'replay' // idempotent replay: no provider call, no charge
  | 'internal_error' // an unexpected application error (a bug), not a provider failure
  | 'disabled' // Phase 5.0 rollout: switch off or user not in the rollout; reason = feature_disabled | rollout_not_selected

export function recordAiRequest(r: {
  feature: AiRequestFeature
  provider: string
  model?: string
  outcome: AiRequestOutcome
  reason?: string
  corrected?: boolean
  /** True when the request consumed (and kept) a quota unit. */
  billable: boolean
  latencyMs?: number
}): void {
  emitAiEvent({ event: 'ai.request', ...r, latencyMs: r.latencyMs === undefined ? undefined : Math.max(0, Math.round(r.latencyMs)) })
}

export type AiQuotaAction = 'charged' | 'rejected' | 'refunded' | 'store_error'

export function recordAiQuota(r: { feature: AiRequestFeature; provider: string; action: AiQuotaAction; reason?: string }): void {
  emitAiEvent({ event: 'ai.quota', ...r })
}
