/**
 * Per-user, per-feature daily AI quota (foundation). Counters live in the
 * AiUsage table, one row per (user, feature, day); a single INSERT … ON
 * CONFLICT … WHERE count < limit statement increments atomically, so
 * concurrent requests can never exceed the limit.
 *
 * The day is the calendar day in Uzbekistan (UTC+5, no daylight saving).
 * Enforced with a real provider only: clothing analysis (Phase 4.1) and
 * stylist chat (Phase 4.2) answer 429 AI_QUOTA_EXCEEDED; the optional outfit
 * explanation (Phase 4.4) falls back to the deterministic explanation instead
 * (never an error). Colour analysis is deterministic and uses no quota.
 */
import crypto from 'crypto'
import { db } from '@/lib/db'

export const AI_DAILY_LIMITS = {
  stylist_chat: 50,
  clothing_analysis: 50,
  color_analysis: 10,
  /** Optional AI reranking/explanation of generated outfits: conservative for the MVP (one call per generation). */
  outfit_explanation: 30,
} as const

export type QuotaFeature = keyof typeof AI_DAILY_LIMITS

const UZBEKISTAN_OFFSET_MS = 5 * 60 * 60 * 1000

/** The quota day (YYYY-MM-DD) for `now`, in Uzbekistan time. */
export function quotaDay(now: Date = new Date()): string {
  return new Date(now.getTime() + UZBEKISTAN_OFFSET_MS).toISOString().slice(0, 10)
}

/** Seconds until the next quota day starts (midnight in Uzbekistan), at least 1. */
export function secondsUntilNextQuotaDay(now: Date = new Date()): number {
  const local = now.getTime() + UZBEKISTAN_OFFSET_MS
  const nextLocalMidnight = Math.floor(local / 86_400_000) * 86_400_000 + 86_400_000
  return Math.max(1, Math.ceil((nextLocalMidnight - local) / 1000))
}

export interface QuotaDecision {
  allowed: boolean
  /** Calls counted today, including this one when allowed. */
  used: number
  limit: number
}

function limitOf(feature: QuotaFeature): number {
  const limit = AI_DAILY_LIMITS[feature]
  if (limit === undefined) throw new Error(`no AI quota defined for ${String(feature)}`)
  return limit
}

/** Counts one call; refuses (without counting) once today's limit is reached. */
export async function consumeAiQuota(userId: string, feature: QuotaFeature, now: Date = new Date()): Promise<QuotaDecision> {
  const limit = limitOf(feature)
  const day = quotaDay(now)
  const rows = await db.$queryRaw<Array<{ count: number }>>`
    INSERT INTO "AiUsage" ("id", "userId", "feature", "day", "count", "updatedAt")
    VALUES (${crypto.randomUUID()}, ${userId}, ${feature}, ${day}::date, 1, now())
    ON CONFLICT ("userId", "feature", "day")
    DO UPDATE SET "count" = "AiUsage"."count" + 1, "updatedAt" = now()
    WHERE "AiUsage"."count" < ${limit}
    RETURNING "count"`
  if (rows.length === 0) return { allowed: false, used: limit, limit }
  return { allowed: true, used: Number(rows[0].count), limit }
}

/** Gives one call back (e.g. when the provider failed before doing any work). */
export async function refundAiQuota(userId: string, feature: QuotaFeature, now: Date = new Date()): Promise<void> {
  limitOf(feature)
  await db.$executeRaw`
    UPDATE "AiUsage" SET "count" = "count" - 1, "updatedAt" = now()
    WHERE "userId" = ${userId} AND "feature" = ${feature} AND "day" = ${quotaDay(now)}::date AND "count" > 0`
}

/** Today's count for a user and feature (0 when there is no row). */
export async function getAiUsage(userId: string, feature: QuotaFeature, now: Date = new Date()): Promise<number> {
  limitOf(feature)
  const rows = await db.$queryRaw<Array<{ count: number }>>`
    SELECT "count" FROM "AiUsage" WHERE "userId" = ${userId} AND "feature" = ${feature} AND "day" = ${quotaDay(now)}::date`
  return rows.length ? Number(rows[0].count) : 0
}
