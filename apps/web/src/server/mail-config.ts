/**
 * Outgoing e-mail settings (password reset links). MAIL_TRANSPORT selects:
 *
 *   smtp      SMTP_HOST, SMTP_PORT (default 587), SMTP_SECURE (1 = TLS from the
 *             first byte, usual on port 465; otherwise STARTTLS is required
 *             except for a relay on localhost), SMTP_USER and SMTP_PASSWORD
 *             (both or neither), MAIL_FROM. Any provider that offers SMTP works.
 *   outbox    each message is written as a JSON file to MAIL_OUTBOX_DIR
 *             (default ./storage/mail-outbox). Development and e2e only: a
 *             production build needs MAIL_ALLOW_OUTBOX_IN_PRODUCTION=1.
 *   disabled  nothing is sent; password reset answers PASSWORD_RESET_UNAVAILABLE.
 *
 * Unset: outbox in development, disabled in production. SMTP in production
 * needs PUBLIC_BASE_URL (the links' origin). Checked at startup
 * (assertServerConfig).
 * Kept apart from the transport so the config check does not load nodemailer.
 */
import path from 'path'
import { ConfigError, getPublicBaseUrl } from '@/lib/config'

export type MailConfig =
  | {
      transport: 'smtp'
      host: string
      port: number
      secure: boolean
      requireTls: boolean
      user: string | null
      password: string | null
      from: string
    }
  | { transport: 'outbox'; dir: string; from: string }
  | { transport: 'disabled' }

const TRANSPORTS = ['smtp', 'outbox', 'disabled'] as const
const DEFAULT_OUTBOX_FROM = 'Lookly <no-reply@localhost>'
const LOCAL_SMTP_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])
const ADDRESS = /^[^\s@<>"]+@[^\s@<>"]+$/
const DEV_ORIGIN = 'http://localhost:3000'

function parseFrom(raw: string | undefined): string {
  const value = raw?.trim() ?? ''
  if (!value) throw new ConfigError('MAIL_FROM is not set (for example: Lookly <no-reply@example.uz>)')
  if (value.length > 200 || /[\r\n]/.test(value)) throw new ConfigError('MAIL_FROM must be one line of at most 200 characters')
  const named = value.match(/^[^<>]*<([^<>]+)>$/)
  if (!ADDRESS.test((named ? named[1] : value).trim())) {
    throw new ConfigError('MAIL_FROM must be an address or "Name <address>" (for example: Lookly <no-reply@example.uz>)')
  }
  return value
}

function parseBool(name: string, raw: string | undefined): boolean | null {
  const value = raw?.trim().toLowerCase()
  if (!value) return null
  if (value === '1' || value === 'true') return true
  if (value === '0' || value === 'false') return false
  throw new ConfigError(`${name} must be 1 or 0`)
}

/** The mail settings from the environment. Throws ConfigError when they are incomplete or invalid. */
export function parseMailConfig(): MailConfig {
  const env = process.env
  const production = env.NODE_ENV === 'production'
  const transport = env.MAIL_TRANSPORT?.trim() || (production ? 'disabled' : 'outbox')
  if (!(TRANSPORTS as readonly string[]).includes(transport)) {
    throw new ConfigError(`MAIL_TRANSPORT must be one of: ${TRANSPORTS.join(', ')}`)
  }
  if (transport === 'disabled') return { transport }

  if (transport === 'outbox') {
    if (production && env.MAIL_ALLOW_OUTBOX_IN_PRODUCTION !== '1') {
      throw new ConfigError('MAIL_TRANSPORT=outbox only writes files; a production build needs MAIL_ALLOW_OUTBOX_IN_PRODUCTION=1 (local Docker / e2e only)')
    }
    return {
      transport,
      // Runtime data, never a build input (same hint as getLocalStorageDir).
      dir: path.resolve(/* turbopackIgnore: true */ env.MAIL_OUTBOX_DIR || './storage/mail-outbox'),
      from: env.MAIL_FROM?.trim() ? parseFrom(env.MAIL_FROM) : DEFAULT_OUTBOX_FROM,
    }
  }

  if (production && !getPublicBaseUrl()) {
    throw new ConfigError('PUBLIC_BASE_URL is not set: password reset links need the public address of the server')
  }
  const host = env.SMTP_HOST?.trim() ?? ''
  if (!host || /\s/.test(host)) throw new ConfigError('SMTP_HOST is not set')
  const rawPort = env.SMTP_PORT?.trim() || '587'
  const port = Number(rawPort)
  if (!/^\d{1,5}$/.test(rawPort) || port < 1 || port > 65535) throw new ConfigError('SMTP_PORT must be a port number')
  const secure = parseBool('SMTP_SECURE', env.SMTP_SECURE) ?? port === 465
  const user = env.SMTP_USER?.trim() || null
  const password = env.SMTP_PASSWORD || null
  if (!user !== !password) throw new ConfigError('Set both SMTP_USER and SMTP_PASSWORD, or neither')
  return {
    transport: 'smtp',
    host,
    port,
    secure,
    // Credentials and links never travel in clear text to a remote server.
    requireTls: !secure && !LOCAL_SMTP_HOSTS.has(host),
    user,
    password,
    from: parseFrom(env.MAIL_FROM),
  }
}

/** Whether password reset links can be sent at all. */
export function mailEnabled(): boolean {
  return parseMailConfig().transport !== 'disabled'
}

/** Origin of the links in e-mails: PUBLIC_BASE_URL (required for SMTP in production). */
export function mailLinkOrigin(): string {
  return getPublicBaseUrl() ?? DEV_ORIGIN
}
