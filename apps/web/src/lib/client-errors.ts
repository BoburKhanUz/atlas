/**
 * Browser error reports to our own server (POST /api/v1/client-errors, see
 * src/server/client-errors.ts): uncaught errors, unhandled rejections and
 * error boundaries. Scrubbed before they leave the page (src/lib/error-scrub.ts);
 * each distinct error once, at most MAX_PER_PAGE per page load, in small
 * batches. Uses plain fetch (never the API client) and swallows its own
 * failures, so reporting can never cause another report.
 */
import { normalizeRoute, scrubErrorText } from '@/lib/error-scrub'

type Kind = 'web_error' | 'web_rejection' | 'react'

interface Report {
  platform: 'web'
  appVersion: string
  kind: Kind
  fatal: boolean
  errorType: string
  message: string
  stack?: string
  route: string
  occurredAt: string
}

const ENDPOINT = '/api/v1/client-errors'
const MAX_PER_PAGE = 10
const MAX_BATCH = 10
const FLUSH_DELAY_MS = 2_000
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || 'web'

const seen = new Set<string>()
let queued: Report[] = []
let accepted = 0
let timer: ReturnType<typeof setTimeout> | null = null

function flush() {
  timer = null
  const reports = queued.splice(0, MAX_BATCH)
  if (!reports.length) return
  try {
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reports }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    // reporting must never throw
  }
}

/** Queues one error for the server log. Duplicates and anything past the page limit are dropped. */
export function reportClientError(error: unknown, kind: Kind, fatal = false): void {
  try {
    const err = error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Non-error value thrown')
    const firstFrame = err.stack?.split('\n').find((l) => l.trim().startsWith('at ') || l.includes('@')) ?? ''
    const key = `${kind}|${err.name}|${err.message}|${firstFrame}`
    if (seen.has(key) || accepted >= MAX_PER_PAGE) return
    seen.add(key)
    accepted += 1
    queued.push({
      platform: 'web',
      appVersion: APP_VERSION.slice(0, 40),
      kind,
      fatal,
      errorType: (err.name || 'Error').slice(0, 200),
      message: scrubErrorText(err.message).slice(0, 1000),
      ...(err.stack ? { stack: scrubErrorText(err.stack).slice(0, 4000) } : {}),
      route: normalizeRoute(window.location.pathname).slice(0, 200),
      occurredAt: new Date().toISOString(),
    })
    timer ??= setTimeout(flush, FLUSH_DELAY_MS)
  } catch {
    // reporting must never throw
  }
}

/** Listens for uncaught errors and unhandled rejections; returns the cleanup. */
export function installClientErrorReporting(): () => void {
  const onError = (e: ErrorEvent) => reportClientError(e.error ?? e.message, 'web_error', true)
  const onRejection = (e: PromiseRejectionEvent) => reportClientError(e.reason, 'web_rejection')
  const onHide = () => {
    if (document.visibilityState === 'hidden') flush()
  }
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  document.addEventListener('visibilitychange', onHide)
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
    document.removeEventListener('visibilitychange', onHide)
  }
}

/** Tests: forget what was reported and queued. */
export function resetClientErrorReportingForTesting() {
  seen.clear()
  queued = []
  accepted = 0
  if (timer) clearTimeout(timer)
  timer = null
}
