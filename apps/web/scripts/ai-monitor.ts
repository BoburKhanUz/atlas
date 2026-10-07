/**
 * AI monitoring dashboard and alert check over structured logs.
 *
 *   bun scripts/ai-monitor.ts --input=<server log (JSON lines)> [--input=…] [--from=ISO] [--to=ISO]
 *                             [--baseline=<log file>] [--baseline-from=ISO] [--baseline-to=ISO] [--json]
 *
 * Reads only ai.call / ai.request / ai.quota lines (content-free by design;
 * see src/lib/ai/monitoring.ts). Prints the dashboard (Markdown, or JSON with
 * --json) and the firing alerts. Exit code 2 when any alert fires (for cron or
 * CI), 0 otherwise. All thresholds are INITIAL / TO BE CALIBRATED AFTER LIVE BAKE-OFF.
 */
import { promises as fs } from 'fs'
import { aggregateAiEvents, evaluateAlerts, type AiDashboard, type AiLogEvent, type Alert } from '../src/lib/ai/monitoring-metrics'

const args = (name: string) => process.argv.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.slice(name.length + 3))

/** Parses JSON log lines; anything that is not an ai.* event is ignored. */
export function parseLogLines(text: string): AiLogEvent[] {
  const out: AiLogEvent[] = []
  for (const line of text.split('\n')) {
    if (!line.includes('"ai.')) continue
    try {
      const e = JSON.parse(line) as AiLogEvent
      if (e && typeof e.msg === 'string' && (e.msg === 'ai.call' || e.msg === 'ai.request' || e.msg === 'ai.quota')) out.push(e)
    } catch {
      // not JSON: skip
    }
  }
  return out
}

async function read(files: string[]): Promise<AiLogEvent[]> {
  const texts = await Promise.all(files.map((f) => fs.readFile(f, 'utf8')))
  return texts.flatMap(parseLogLines)
}

const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`)
const ms = (v: number | null) => (v === null ? '—' : String(Math.round(v)))

export function dashboardMarkdown(d: AiDashboard, alerts: Alert[]): string {
  const lines = [
    `# AI monitoring — ${d.window.from ?? 'start'} → ${d.window.to ?? 'end'} (${d.window.events} events)`,
    '',
    'Thresholds are INITIAL / TO BE CALIBRATED AFTER LIVE BAKE-OFF.',
    '',
    '## Provider calls (ai.call)',
    '',
    '| feature | provider | model | calls | success | errors | timeouts | retry ok/failed | p50 ms | p95 ms | p99 ms | tokens in/out | cost USD |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...d.calls.map(
      (c) =>
        `| ${c.feature} | ${c.provider} | ${c.model} | ${c.calls} | ${pct(c.successRate)} | ${Object.entries(c.errorCodes).map(([k, v]) => `${k}:${v}`).join(' ') || '—'} | ${pct(c.timeoutRate)} | ${c.retry.succeeded}/${c.retry.failed} | ${ms(c.latencyMs.p50)} | ${ms(c.latencyMs.p95)} | ${ms(c.latencyMs.p99)} | ${c.usage.calls ? `${c.usage.input}/${c.usage.output}` : 'n/a'} | ${c.costUsd ?? 'n/a'} |`,
    ),
    '',
    '## Feature requests (ai.request)',
    '',
    '| feature | provider | requests | outcomes | reasons | corrected | billable | p95 ms |',
    '|---|---|---|---|---|---|---|---|',
    ...d.requests.map(
      (r) =>
        `| ${r.feature} | ${r.provider} | ${r.requests} | ${Object.entries(r.outcomes).map(([k, v]) => `${k}:${v}`).join(' ')} | ${Object.entries(r.reasons).map(([k, v]) => `${k}:${v}`).join(' ') || '—'} | ${r.corrected} | ${r.billable} | ${ms(r.latencyMs.p95)} |`,
    ),
    '',
    '## Quota (ai.quota)',
    '',
    '| feature | provider | charged | rejected | refunded | store errors | rejection rate |',
    '|---|---|---|---|---|---|---|',
    ...d.quota.map((q) => `| ${q.feature} | ${q.provider} | ${q.charged} | ${q.rejected} | ${q.refunded} | ${q.storeErrors} | ${pct(q.rejectionRate)} |`),
    '',
    '## Alerts',
    '',
    ...(alerts.length
      ? alerts.map((a) => `- **${a.severity.toUpperCase()}** ${a.name} — ${a.provider}${a.feature ? ` / ${a.feature}` : ''}${a.model ? ` / ${a.model}` : ''}: ${a.value} (threshold ${a.threshold}, provisional)`)
      : ['- none']),
  ]
  return lines.join('\n') + '\n'
}

async function main() {
  const inputs = args('input')
  if (inputs.length === 0) throw new Error('usage: --input=<log file> [--from=ISO] [--to=ISO] [--baseline=<log file>] [--json]')
  const events = await read(inputs)
  const window = { from: args('from')[0], to: args('to')[0] }
  const dashboard = aggregateAiEvents(events, window)
  const baselineFiles = args('baseline')
  const baseline = baselineFiles.length ? aggregateAiEvents(await read(baselineFiles), { from: args('baseline-from')[0], to: args('baseline-to')[0] }) : undefined
  const alerts = evaluateAlerts(dashboard, events, undefined, baseline)
  if (process.argv.includes('--json')) console.log(JSON.stringify({ dashboard, alerts }, null, 2))
  else process.stdout.write(dashboardMarkdown(dashboard, alerts))
  process.exitCode = alerts.length ? 2 : 0
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
