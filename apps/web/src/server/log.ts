/**
 * Structured JSON logger (server only). One line per event on stdout/stderr,
 * so any log collector can ingest it without extra infrastructure.
 *
 * Sensitive data is redacted before it is written: passwords, tokens,
 * cookies, authorization headers, signed media URLs and e-mail addresses.
 * Never log request bodies, image bytes or prompts.
 */

type Level = 'debug' | 'info' | 'warn' | 'error'
type Fields = Record<string, unknown>

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }
const minLevel: Level = (process.env.LOG_LEVEL as Level) in LEVELS ? (process.env.LOG_LEVEL as Level) : 'info'

const SENSITIVE_KEY = /pass(word)?|secret|token|authorization|cookie|session|signature|^sig$|email|phone/i
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const SIGNED_URL_QUERY = /([?&](?:sig|exp)=)[^&\s"]+/g
const BEARER = /Bearer\s+[A-Za-z0-9._-]+/gi
const JWT = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g

export function redactString(s: string): string {
  return s
    .replace(BEARER, 'Bearer [REDACTED]')
    .replace(JWT, '[REDACTED_JWT]')
    .replace(SIGNED_URL_QUERY, '$1[REDACTED]')
    .replace(EMAIL, '[REDACTED_EMAIL]')
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[TRUNCATED]'
  if (typeof value === 'string') return redactString(value)
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message), stack: value.stack?.split('\n').slice(0, 8).map(redactString).join('\n') }
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1))
  if (value && typeof value === 'object') {
    const out: Fields = {}
    for (const [k, v] of Object.entries(value as Fields)) {
      out[k] = SENSITIVE_KEY.test(k) ? '[REDACTED]' : redact(v, depth + 1)
    }
    return out
  }
  return value
}

function write(level: Level, msg: string, fields?: Fields) {
  if (LEVELS[level] < LEVELS[minLevel]) return
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg: redactString(msg),
    ...(fields ? (redact(fields) as Fields) : {}),
  })
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n')
  else process.stdout.write(line + '\n')
}

export const log = {
  debug: (msg: string, fields?: Fields) => write('debug', msg, fields),
  info: (msg: string, fields?: Fields) => write('info', msg, fields),
  warn: (msg: string, fields?: Fields) => write('warn', msg, fields),
  error: (msg: string, fields?: Fields) => write('error', msg, fields),
}
