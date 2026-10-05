/**
 * Server configuration. Secrets are read lazily (on first use) so `next build`
 * can run without them, but any request that needs one fails closed — there
 * are NO hard-coded fallbacks. `instrumentation.ts` calls
 * `assertServerConfig()` at startup so a misconfigured server refuses to boot.
 */

import path from 'path'

const MIN_SECRET_LENGTH = 32

/** Values that shipped as defaults in the original Z.ai export. Never accept them. */
const KNOWN_INSECURE_SECRETS = new Set([
  'dev-secret-change-in-production-please-use-env',
  'dev-refresh-secret-change-in-production-please-use-env',
])

export class ConfigError extends Error {}

function requireSecret(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new ConfigError(`${name} is not set. Generate one with: openssl rand -base64 48`)
  }
  if (value.length < MIN_SECRET_LENGTH) {
    throw new ConfigError(`${name} must be at least ${MIN_SECRET_LENGTH} characters long`)
  }
  if (KNOWN_INSECURE_SECRETS.has(value)) {
    throw new ConfigError(`${name} uses a known insecure default value`)
  }
  return value
}

export function getJwtSecret(): string {
  return requireSecret('JWT_SECRET')
}

// Refresh tokens are opaque random values stored hashed in the Session table,
// so there is no separate refresh-signing secret (JWT_REFRESH_SECRET is gone).

const DEFAULT_ACCESS_TTL_SECONDS = 15 * 60
const MIN_ACCESS_TTL_SECONDS = 10
const MAX_ACCESS_TTL_SECONDS = 24 * 60 * 60

/** Access JWT / access cookie lifetime. ACCESS_TOKEN_TTL_SECONDS (min 10) overrides 15 min. */
export function getAccessTokenTtlSeconds(): number {
  const raw = Number(process.env.ACCESS_TOKEN_TTL_SECONDS)
  if (!process.env.ACCESS_TOKEN_TTL_SECONDS || !Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_ACCESS_TTL_SECONDS
  }
  return Math.min(MAX_ACCESS_TTL_SECONDS, Math.max(MIN_ACCESS_TTL_SECONDS, Math.floor(raw)))
}

/** Refresh session lifetime in seconds. REFRESH_TOKEN_TTL_DAYS overrides 30 days. */
export function getRefreshTokenTtlSeconds(): number {
  const raw = Number(process.env.REFRESH_TOKEN_TTL_DAYS)
  const days = process.env.REFRESH_TOKEN_TTL_DAYS && Number.isFinite(raw) && raw > 0 ? Math.min(raw, 365) : 30
  return Math.floor(days * 24 * 60 * 60)
}

/**
 * Whether auth cookies get the `Secure` flag. Default: on in production.
 * COOKIE_SECURE=0 turns it off (plain-http local Docker / e2e only);
 * COOKIE_SECURE=1 forces it on elsewhere.
 */
export function secureCookiesEnabled(): boolean {
  if (process.env.COOKIE_SECURE === '0') return false
  if (process.env.COOKIE_SECURE === '1') return true
  return process.env.NODE_ENV === 'production'
}

export function getMediaSigningSecret(): string {
  return requireSecret('MEDIA_SIGNING_SECRET')
}

/** Absolute directory for the local storage driver. Outside `public/` by default. */
export function getLocalStorageDir(): string {
  // Runtime data, never a build input: without the hint Turbopack (Next 16.3)
  // cannot resolve this dynamic path at build time and traces the whole
  // project (sources, tests, and any local storage/ or .env files) into
  // .next/standalone. Same marker Next.js uses for its own runtime directories.
  return path.resolve(/* turbopackIgnore: true */ process.env.STORAGE_LOCAL_DIR || './storage/uploads')
}

/** Lifetime of signed media URLs, in seconds (default 1 hour). */
export function getMediaUrlTtlSeconds(): number {
  const raw = Number(process.env.MEDIA_URL_TTL_SECONDS)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 3600
}

const SESSION_ENC_KEY_BYTES = 32
const MAX_DECRYPT_ONLY_KEYS = 2

function decodeSessionKey(name: string, raw: string): Buffer {
  const value = raw.trim()
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new ConfigError(`${name} must be base64. Generate one with: openssl rand -base64 32`)
  }
  const key = Buffer.from(value, 'base64')
  if (key.length !== SESSION_ENC_KEY_BYTES) {
    throw new ConfigError(`${name} must decode to exactly ${SESSION_ENC_KEY_BYTES} bytes (openssl rand -base64 32)`)
  }
  for (const other of ['JWT_SECRET', 'MEDIA_SIGNING_SECRET']) {
    const o = process.env[other]
    if (o && (o.trim() === value || Buffer.from(o, 'utf8').equals(key))) {
      throw new ConfigError(`${name} must be independent of ${other}`)
    }
  }
  return key
}

export interface SessionEncKeys {
  /** Encrypts new successor tokens (and decrypts). */
  active: Buffer
  /** Decrypt-only keys for staged rotation (SESSION_ENC_DECRYPT_KEYS, comma-separated, ≤ 2). */
  decryptOnly: Buffer[]
}

/**
 * Keys for the encrypted successor refresh token kept on a rotated session
 * (grace replay). SESSION_ENC_KEY is independent of every other secret.
 * Rotation: stage the new key in SESSION_ENC_DECRYPT_KEYS on every instance,
 * then make it SESSION_ENC_KEY (old key moves to the decrypt list), then drop
 * the old key after the grace window (60 s) has passed.
 */
export function getSessionEncKeys(): SessionEncKeys {
  const raw = process.env.SESSION_ENC_KEY
  if (!raw) throw new ConfigError('SESSION_ENC_KEY is not set. Generate one with: openssl rand -base64 32')
  const active = decodeSessionKey('SESSION_ENC_KEY', raw)
  const list = (process.env.SESSION_ENC_DECRYPT_KEYS ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
  if (list.length > MAX_DECRYPT_ONLY_KEYS) {
    throw new ConfigError(`SESSION_ENC_DECRYPT_KEYS accepts at most ${MAX_DECRYPT_ONLY_KEYS} keys`)
  }
  const decryptOnly = list.map((k) => decodeSessionKey('SESSION_ENC_DECRYPT_KEYS', k)).filter((k) => !k.equals(active))
  return { active, decryptOnly }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Public origin used to build ABSOLUTE media URLs (mobile clients need them).
 * Never derived from the request's Host header. Unset → relative URLs.
 * Must be an origin only (no path, query, fragment or credentials); https in
 * production except for localhost.
 */
export function getPublicBaseUrl(): string | null {
  const raw = process.env.PUBLIC_BASE_URL?.trim()
  if (!raw) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new ConfigError('PUBLIC_BASE_URL must be an absolute URL such as https://atlas.example')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new ConfigError('PUBLIC_BASE_URL must use http(s)')
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new ConfigError('PUBLIC_BASE_URL must be an origin only (no path, query, fragment or credentials)')
  }
  if (raw.replace(/\/$/, '').toLowerCase() !== url.origin) {
    throw new ConfigError('PUBLIC_BASE_URL must be an origin only (no path, query, fragment or credentials)')
  }
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:' && !LOCAL_HOSTS.has(url.hostname)) {
    throw new ConfigError('PUBLIC_BASE_URL must use https in production')
  }
  return url.origin
}

/** Throws if any required secret is missing or insecure. */
export function assertServerConfig(): void {
  if (!process.env.DATABASE_URL) throw new ConfigError('DATABASE_URL is not set')
  getJwtSecret()
  getMediaSigningSecret()
  getSessionEncKeys()
  getPublicBaseUrl()
}
