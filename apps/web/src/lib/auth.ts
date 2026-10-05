import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { SignJWT, jwtVerify } from 'jose'
import { ConfigError, getAccessTokenTtlSeconds, getJwtSecret } from '@/lib/config'

// The signing secret comes from config.ts, which throws if it is missing or
// insecure. There is deliberately no fallback value.

const ISSUER = 'ai-fashion-stylist'

const enc = (s: string) => new TextEncoder().encode(s)

export interface JwtPayload {
  sub: string // user id
  email: string
  /** Session id (Session.id) the access token was issued for. Absent on legacy/test tokens. */
  sid?: string
}

/** Hash a password using bcrypt with cost factor 10. */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10)
}

/** Verify a password against its stored hash. */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

/**
 * Sign a short-lived access token (15 min by default, ACCESS_TOKEN_TTL_SECONDS).
 * `expiresAt` sets the expiry explicitly (the session protocol caps it at the
 * session family's absolute limit, computed from the database clock).
 */
export async function signAccessToken(payload: JwtPayload, opts: { expiresAt?: Date } = {}): Promise<string> {
  const claims: Record<string, string> = { sub: payload.sub, email: payload.email }
  if (payload.sid) claims.sid = payload.sid
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setExpirationTime(opts.expiresAt ? Math.floor(opts.expiresAt.getTime() / 1000) : `${getAccessTokenTtlSeconds()}s`)
    .sign(enc(getJwtSecret()))
}

/** Verify access token; throws on invalid/expired. */
export async function verifyAccessToken(token: string): Promise<JwtPayload> {
  const { payload } = await jwtVerify(token, enc(getJwtSecret()), {
    issuer: ISSUER,
    algorithms: ['HS256'],
  })
  if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
    throw new Error('malformed access token')
  }
  return {
    sub: payload.sub,
    email: payload.email,
    ...(typeof payload.sid === 'string' ? { sid: payload.sid } : {}),
  }
}

/**
 * Verify an access token, returning null for any invalid/expired token.
 * A missing/insecure secret is a server misconfiguration, not a bad token,
 * so ConfigError is rethrown.
 */
export async function verifyAccessTokenOrNull(token: string | null | undefined): Promise<JwtPayload | null> {
  if (!token) return null
  try {
    return await verifyAccessToken(token)
  } catch (err) {
    if (err instanceof ConfigError) throw err
    return null
  }
}

/** Opaque refresh token: 32 random bytes, base64url. */
export function generateRefreshToken(): string {
  return crypto.randomBytes(32).toString('base64url')
}

/** SHA-256 hex digest — what the Session table stores instead of the token. */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/** The token from an `Authorization: Bearer <token>` header, or null. */
export function bearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  return match ? match[1].trim() : null
}

/**
 * Extract & verify the bearer token from an Authorization header.
 * Returns null if missing or invalid (does NOT throw — caller decides).
 */
export async function getUserFromAuthHeader(authHeader: string | null): Promise<JwtPayload | null> {
  return verifyAccessTokenOrNull(bearerToken(authHeader))
}
