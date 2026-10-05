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
  return path.resolve(process.env.STORAGE_LOCAL_DIR || './storage/uploads')
}

/** Lifetime of signed media URLs, in seconds (default 1 hour). */
export function getMediaUrlTtlSeconds(): number {
  const raw = Number(process.env.MEDIA_URL_TTL_SECONDS)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 3600
}

/** Throws if any required secret is missing or insecure. */
export function assertServerConfig(): void {
  if (!process.env.DATABASE_URL) throw new ConfigError('DATABASE_URL is not set')
  getJwtSecret()
  getMediaSigningSecret()
}
