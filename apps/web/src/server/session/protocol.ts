/**
 * Family-first session protocol (server only). One transaction per request:
 *
 *   BEGIN (READ COMMITTED, primary database only)
 *   SET LOCAL lock_timeout = 5s, statement_timeout = 10s
 *   t := atlas_now()                         -- request time, read BEFORE any lock wait
 *   R0 := session by token hash (no lock)    -- finds the family
 *   F  := SessionFamily FOR UPDATE           -- lock order: family first …
 *   R  := Session FOR UPDATE                 -- … then the session (then its successor)
 *   classifyRefresh(t, F, R) and act; COMMIT
 *
 * Every refresh, grace replay and revocation of a family takes the family lock
 * first, so they are serialised per family and never deadlock each other (no
 * operation locks two families). All times come from the database clock.
 * A family-level revocation also stamps `revokedAt` on every live session of
 * the family (session rows alone are always enough to enforce it) and clears
 * stored successor ciphertexts.
 *
 * Lock or pool timeouts and deadlocks become SESSION_BUSY (503) with no side
 * effects: the transaction is rolled back before anything is returned.
 */
import { Prisma, type PrismaClient } from '@prisma/client'
import { generateRefreshToken, hashToken, signAccessToken } from '@/lib/auth'
import { getAccessTokenTtlSeconds, getRefreshTokenTtlSeconds, getSessionEncKeys } from '@/lib/config'
import { log } from '@/server/log'
import { classifyRefresh, type ClientType } from '@/server/session/classify'
import { decryptSuccessor, encryptSuccessor, successorAad } from '@/server/session/successor-crypto'

export type { ClientType } from '@/server/session/classify'

/**
 * Absolute session lifetime: a family created by login can never be refreshed
 * past createdAt + 90 days. Families migrated at the cutover have a bounded
 * transition limit instead (docs/database/cutover.md, "Legacy session lifetime").
 */
export const SESSION_ABSOLUTE_TTL_DAYS = 90

export const REFRESH_TOKEN_MAX_LENGTH = 128
const USER_AGENT_MAX = 200
export const DEVICE_NAME_MAX = 100

const LOCK_TIMEOUT = '5s'
const STATEMENT_TIMEOUT = '10s'
const TX_OPTIONS = { maxWait: 5_000, timeout: 20_000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }

export type SessionErrorCode =
  | 'INVALID_TOKEN'
  | 'SESSION_EXPIRED'
  | 'SESSION_REVOKED'
  | 'REFRESH_REUSED'
  | 'SESSION_RACE'
  | 'CLIENT_MISMATCH'
  | 'SESSION_BUSY'

/** Codes after which a client must discard its tokens (no retry). */
export const TERMINAL_SESSION_CODES: ReadonlySet<SessionErrorCode> = new Set([
  'INVALID_TOKEN',
  'SESSION_EXPIRED',
  'SESSION_REVOKED',
  'REFRESH_REUSED',
  'CLIENT_MISMATCH',
])

export interface SessionUser {
  id: string
  email: string
  name: string | null
}

export interface IssuedSession {
  sessionId: string
  familyId: string
  /** Database time the tokens were issued at (cookie lifetimes are relative to it). */
  issuedAt: Date
  accessToken: string
  accessTokenExpiresAt: Date
  refreshToken: string
  refreshTokenExpiresAt: Date
  /** The family's absolute limit. */
  sessionExpiresAt: Date
}

export type RefreshResult =
  | { ok: true; user: SessionUser; issued: IssuedSession; replay: boolean }
  | { ok: false; code: SessionErrorCode }

type Tx = Prisma.TransactionClient

interface FamilyRow {
  id: string
  userId: string
  clientType: string
  absoluteExpiresAt: Date
  revokedAt: Date | null
}

interface SessionRow {
  id: string
  userId: string
  familyId: string
  tokenHash: string
  expiresAt: Date
  revokedAt: Date | null
  replacedById: string | null
  rotatedAt: Date | null
  rotatedAtSource: string | null
  successorTokenEnc: string | null
  userAgent: string | null
  deviceName: string | null
}

/** Thrown by startSession when the database is too busy (maps to 503 SESSION_BUSY). */
export class SessionBusyError extends Error {}

const minDate = (a: Date, b: Date) => (a.getTime() <= b.getTime() ? a : b)
const addMs = (d: Date, ms: number) => new Date(d.getTime() + ms)

function truncate(value: string | null | undefined, max: number): string | null {
  return value ? value.slice(0, max) : null
}

/** Lock timeout, statement timeout, deadlock, serialization failure, pool or transaction timeout. */
export function isBusyError(err: unknown): boolean {
  if (err instanceof SessionBusyError) return true
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (['P2024', 'P2028', 'P2034'].includes(err.code)) return true
    const pgCode = (err.meta as { code?: string } | undefined)?.code
    if (pgCode && ['55P03', '57014', '40P01', '40001'].includes(pgCode)) return true
  }
  const message = err instanceof Error ? err.message : ''
  return /lock timeout|statement timeout|deadlock detected|could not serialize|could not obtain lock|Transaction already closed|Unable to start a transaction/i.test(
    message,
  )
}

async function begin(tx: Tx): Promise<Date> {
  await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`)
  await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`)
  const [{ t }] = await tx.$queryRaw<{ t: Date }[]>`SELECT atlas_now() AS t`
  return t
}

async function lockFamily(tx: Tx, familyId: string): Promise<FamilyRow | null> {
  const rows = await tx.$queryRaw<FamilyRow[]>`
    SELECT "id", "userId", "clientType", "absoluteExpiresAt", "revokedAt"
      FROM "SessionFamily" WHERE "id" = ${familyId} FOR UPDATE`
  return rows[0] ?? null
}

async function lockSession(tx: Tx, sessionId: string): Promise<SessionRow | null> {
  const rows = await tx.$queryRaw<SessionRow[]>`
    SELECT "id", "userId", "familyId", "tokenHash", "expiresAt", "revokedAt", "replacedById",
           "rotatedAt", "rotatedAtSource", "successorTokenEnc", "userAgent", "deviceName"
      FROM "Session" WHERE "id" = ${sessionId} FOR UPDATE`
  return rows[0] ?? null
}

/** Revoke a family (caller holds its lock) and stamp every live session in it. */
async function revokeFamily(tx: Tx, familyId: string, t: Date, reason: 'logout' | 'reuse' | 'expired') {
  await tx.sessionFamily.updateMany({ where: { id: familyId, revokedAt: null }, data: { revokedAt: t, revokeReason: reason } })
  await tx.session.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: t } })
  await tx.session.updateMany({ where: { familyId, successorTokenEnc: { not: null } }, data: { successorTokenEnc: null } })
}

async function mintAccess(user: SessionUser, sessionId: string, t: Date, family: { absoluteExpiresAt: Date }) {
  const expiresAt = minDate(addMs(t, getAccessTokenTtlSeconds() * 1000), family.absoluteExpiresAt)
  const token = await signAccessToken({ sub: user.id, email: user.email, sid: sessionId }, { expiresAt })
  return { token, expiresAt: new Date(Math.floor(expiresAt.getTime() / 1000) * 1000) }
}

async function run<T>(client: PrismaClient, fn: (tx: Tx) => Promise<T>): Promise<T | { ok: false; code: 'SESSION_BUSY' }> {
  try {
    return await client.$transaction(fn, TX_OPTIONS)
  } catch (err) {
    if (isBusyError(err)) {
      log.warn('session operation busy', { err: err instanceof Error ? err.message.slice(0, 200) : String(err) })
      return { ok: false, code: 'SESSION_BUSY' }
    }
    throw err
  }
}

/** Login / register: a new family and its first session, in one transaction. */
export async function startSession(
  client: PrismaClient,
  user: SessionUser,
  opts: { clientType: ClientType; userAgent?: string | null; deviceName?: string | null },
): Promise<IssuedSession> {
  const refreshToken = generateRefreshToken()
  const result = await run(client, async (tx) => {
    const t = await begin(tx)
    const absoluteExpiresAt = addMs(t, SESSION_ABSOLUTE_TTL_DAYS * 24 * 3600 * 1000)
    const family = await tx.sessionFamily.create({
      data: { userId: user.id, clientType: opts.clientType, createdAt: t, absoluteExpiresAt },
      select: { id: true },
    })
    const expiresAt = minDate(addMs(t, getRefreshTokenTtlSeconds() * 1000), absoluteExpiresAt)
    const session = await tx.session.create({
      data: {
        userId: user.id,
        familyId: family.id,
        tokenHash: hashToken(refreshToken),
        createdAt: t,
        lastUsedAt: t,
        expiresAt,
        userAgent: truncate(opts.userAgent, USER_AGENT_MAX),
        deviceName: opts.clientType === 'mobile' ? truncate(opts.deviceName, DEVICE_NAME_MAX) : null,
      },
      select: { id: true },
    })
    const access = await mintAccess(user, session.id, t, { absoluteExpiresAt })
    return {
      sessionId: session.id,
      familyId: family.id,
      issuedAt: t,
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken,
      refreshTokenExpiresAt: expiresAt,
      sessionExpiresAt: absoluteExpiresAt,
    }
  })
  if ('ok' in result) throw new SessionBusyError('session store busy')
  return result
}

/** Exchange a refresh token (rotation, grace replay, or a classified failure). */
export async function refreshSession(
  client: PrismaClient,
  refreshToken: string | null | undefined,
  opts: { clientType: ClientType; userAgent?: string | null },
): Promise<RefreshResult> {
  if (!refreshToken || refreshToken.length > REFRESH_TOKEN_MAX_LENGTH) return { ok: false, code: 'INVALID_TOKEN' }
  const tokenHash = hashToken(refreshToken)

  return run(client, async (tx): Promise<RefreshResult> => {
    const t = await begin(tx)
    const found = await tx.session.findUnique({ where: { tokenHash }, select: { id: true, familyId: true } })
    if (!found) return { ok: false, code: 'INVALID_TOKEN' }

    const family = await lockFamily(tx, found.familyId)
    const current = family ? await lockSession(tx, found.id) : null
    if (!family || !current) return { ok: false, code: 'INVALID_TOKEN' } // deleted meanwhile (account deletion)

    const legacyCutoverAt =
      current.rotatedAtSource === 'legacy' || (current.replacedById && current.rotatedAt === null)
        ? ((await tx.systemMarker.findUnique({ where: { key: 'legacyCutoverAt' } }))?.value ?? null)
        : null

    const decision = classifyRefresh({ t, family, session: current, clientType: opts.clientType, legacyCutoverAt })
    const ids = { userId: current.userId, familyId: family.id, sessionId: current.id }

    switch (decision.kind) {
      case 'revoked':
        return { ok: false, code: 'SESSION_REVOKED' }
      case 'client_mismatch':
        log.warn('refresh token used with the wrong client type', { ...ids, clientType: opts.clientType })
        return { ok: false, code: 'CLIENT_MISMATCH' }
      case 'expired':
        await revokeFamily(tx, family.id, t, 'expired')
        return { ok: false, code: 'SESSION_EXPIRED' }
      case 'race':
        return { ok: false, code: 'SESSION_RACE' }
      case 'reuse':
        await revokeFamily(tx, family.id, t, 'reuse')
        log.warn('refresh token reuse detected; session family revoked', ids)
        return { ok: false, code: 'REFRESH_REUSED' }
      case 'grace':
        return graceReplay(tx, t, family, current)
      case 'rotate':
        return rotate(tx, t, family, current, opts.userAgent)
    }
  })
}

async function loadUser(tx: Tx, userId: string): Promise<SessionUser | null> {
  return tx.user.findUnique({ where: { id: userId }, select: { id: true, email: true, name: true } })
}

async function rotate(tx: Tx, t: Date, family: FamilyRow, current: SessionRow, userAgent?: string | null): Promise<RefreshResult> {
  const user = await loadUser(tx, current.userId)
  if (!user) return { ok: false, code: 'INVALID_TOKEN' }
  const keys = getSessionEncKeys()
  const nextToken = generateRefreshToken()
  const expiresAt = minDate(addMs(t, getRefreshTokenTtlSeconds() * 1000), family.absoluteExpiresAt)
  const next = await tx.session.create({
    data: {
      userId: current.userId,
      familyId: family.id,
      tokenHash: hashToken(nextToken),
      createdAt: t,
      lastUsedAt: t,
      expiresAt,
      userAgent: truncate(userAgent, USER_AGENT_MAX) ?? current.userAgent,
      deviceName: current.deviceName,
    },
    select: { id: true },
  })
  await tx.session.update({
    where: { id: current.id },
    data: {
      revokedAt: t,
      rotatedAt: t,
      rotatedAtSource: 'db',
      replacedById: next.id,
      lastUsedAt: t,
      successorTokenEnc: encryptSuccessor(nextToken, successorAad(current.id, next.id), keys),
    },
  })
  const access = await mintAccess(user, next.id, t, family)
  return {
    ok: true,
    replay: false,
    user,
    issued: {
      sessionId: next.id,
      familyId: family.id,
      issuedAt: t,
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken: nextToken,
      refreshTokenExpiresAt: expiresAt,
      sessionExpiresAt: family.absoluteExpiresAt,
    },
  }
}

/**
 * The presented token was rotated ≤ 60 s ago (a concurrent request, or a lost
 * response being retried). Return the SAME successor refresh token and a new
 * access token — only if the successor is still the live tail of this family
 * and its stored ciphertext decrypts to a token whose hash matches.
 */
async function graceReplay(tx: Tx, t: Date, family: FamilyRow, current: SessionRow): Promise<RefreshResult> {
  const race = { ok: false as const, code: 'SESSION_RACE' as const }
  if (!current.replacedById || !current.successorTokenEnc) return race
  const successor = await lockSession(tx, current.replacedById)
  if (
    !successor ||
    successor.familyId !== family.id ||
    successor.userId !== current.userId ||
    successor.revokedAt !== null ||
    successor.replacedById !== null ||
    t.getTime() >= successor.expiresAt.getTime()
  ) {
    return race
  }
  const token = decryptSuccessor(current.successorTokenEnc, successorAad(current.id, successor.id), getSessionEncKeys())
  if (!token || hashToken(token) !== successor.tokenHash) {
    log.warn('grace replay: successor token could not be recovered', { familyId: family.id, sessionId: current.id })
    return race
  }
  const user = await loadUser(tx, current.userId)
  if (!user) return { ok: false, code: 'INVALID_TOKEN' }
  const access = await mintAccess(user, successor.id, t, family)
  return {
    ok: true,
    replay: true,
    user,
    issued: {
      sessionId: successor.id,
      familyId: family.id,
      issuedAt: t,
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken: token,
      refreshTokenExpiresAt: successor.expiresAt,
      sessionExpiresAt: family.absoluteExpiresAt,
    },
  }
}

/**
 * Logout: revoke the whole family of the session identified by a refresh
 * token or by an access token's `sid` (scoped to its user). Idempotent.
 */
export async function endSession(
  client: PrismaClient,
  opts: { refreshToken?: string | null; sid?: string | null; userId?: string | null },
): Promise<{ ok: true } | { ok: false; code: 'SESSION_BUSY' }> {
  let familyId: string | null = null
  if (opts.refreshToken && opts.refreshToken.length <= REFRESH_TOKEN_MAX_LENGTH) {
    familyId = (await client.session.findUnique({ where: { tokenHash: hashToken(opts.refreshToken) }, select: { familyId: true } }))?.familyId ?? null
  }
  if (!familyId && opts.sid && opts.userId) {
    familyId = (await client.session.findFirst({ where: { id: opts.sid, userId: opts.userId }, select: { familyId: true } }))?.familyId ?? null
  }
  if (!familyId) return { ok: true }
  const id = familyId
  return run(client, async (tx) => {
    const t = await begin(tx)
    if (await lockFamily(tx, id)) await revokeFamily(tx, id, t, 'logout')
    return { ok: true as const }
  })
}
