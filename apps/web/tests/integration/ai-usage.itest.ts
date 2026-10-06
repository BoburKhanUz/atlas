/**
 * AiUsage quota counters against real PostgreSQL: the increment is atomic
 * under concurrency, separate per user / feature / day, refundable, and the
 * rows disappear with the account.
 */
import crypto from 'crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { AI_DAILY_LIMITS, consumeAiQuota, getAiUsage, quotaDay, refundAiQuota } from '@/lib/ai/quota'
import { enabled } from './pg'

describe.skipIf(!enabled)('AI quota (real PostgreSQL)', () => {
  const users: string[] = []
  const newUser = async () => {
    const u = await db.user.create({ data: { email: `ai-${crypto.randomUUID()}@test.local`, passwordHash: 'x' } })
    users.push(u.id)
    return u.id
  }

  beforeAll(async () => {
    await db.$connect()
  })
  afterAll(async () => {
    await db.user.deleteMany({ where: { id: { in: users } } })
    await db.$disconnect()
  })

  it('limits are the approved ones', () => {
    expect(AI_DAILY_LIMITS).toEqual({ stylist_chat: 50, clothing_analysis: 50, color_analysis: 10 })
  })

  it('counts up to the limit, then refuses without counting', async () => {
    const u = await newUser()
    const now = new Date('2026-10-07T08:00:00Z')
    for (let i = 1; i <= 10; i++) expect(await consumeAiQuota(u, 'color_analysis', now)).toEqual({ allowed: true, used: i, limit: 10 })
    expect(await consumeAiQuota(u, 'color_analysis', now)).toEqual({ allowed: false, used: 10, limit: 10 })
    expect(await getAiUsage(u, 'color_analysis', now)).toBe(10)
  })

  it('is atomic: 80 concurrent requests against a limit of 50 allow exactly 50', async () => {
    const u = await newUser()
    const now = new Date('2026-10-07T08:00:00Z')
    const results = await Promise.all(Array.from({ length: 80 }, () => consumeAiQuota(u, 'stylist_chat', now)))
    expect(results.filter((r) => r.allowed)).toHaveLength(50)
    expect(results.filter((r) => !r.allowed)).toHaveLength(30)
    expect(new Set(results.filter((r) => r.allowed).map((r) => r.used)).size).toBe(50) // 1..50, each once
    expect(await getAiUsage(u, 'stylist_chat', now)).toBe(50)
  })

  it('is separate per user, per feature and per day (Uzbekistan time)', async () => {
    const a = await newUser()
    const b = await newUser()
    const lateDay1 = new Date('2026-10-07T18:59:59Z') // 23:59:59 in Tashkent
    const earlyDay2 = new Date('2026-10-07T19:00:00Z') // 00:00 next day in Tashkent
    expect(quotaDay(lateDay1)).toBe('2026-10-07')
    expect(quotaDay(earlyDay2)).toBe('2026-10-08')
    await consumeAiQuota(a, 'clothing_analysis', lateDay1)
    await consumeAiQuota(a, 'clothing_analysis', lateDay1)
    expect(await getAiUsage(a, 'clothing_analysis', lateDay1)).toBe(2)
    expect(await getAiUsage(a, 'clothing_analysis', earlyDay2)).toBe(0)
    expect(await getAiUsage(a, 'stylist_chat', lateDay1)).toBe(0)
    expect(await getAiUsage(b, 'clothing_analysis', lateDay1)).toBe(0)
    expect((await consumeAiQuota(a, 'clothing_analysis', earlyDay2)).used).toBe(1)
    const stored = await db.aiUsage.findMany({ where: { userId: a }, orderBy: { day: 'asc' } })
    expect(stored.map((r) => [r.feature, r.day.toISOString().slice(0, 10), r.count])).toEqual([
      ['clothing_analysis', '2026-10-07', 2],
      ['clothing_analysis', '2026-10-08', 1],
    ])
  })

  it('refund gives one call back and never goes below zero', async () => {
    const u = await newUser()
    const now = new Date('2026-10-07T08:00:00Z')
    await refundAiQuota(u, 'stylist_chat', now) // no row: no-op
    expect(await getAiUsage(u, 'stylist_chat', now)).toBe(0)
    await consumeAiQuota(u, 'stylist_chat', now)
    await refundAiQuota(u, 'stylist_chat', now)
    await refundAiQuota(u, 'stylist_chat', now)
    expect(await getAiUsage(u, 'stylist_chat', now)).toBe(0)
  })

  it('rows hold counts only and are deleted with the account', async () => {
    const u = await newUser()
    await consumeAiQuota(u, 'stylist_chat')
    const [row] = await db.aiUsage.findMany({ where: { userId: u } })
    expect(Object.keys(row).sort()).toEqual(['count', 'createdAt', 'day', 'feature', 'id', 'updatedAt', 'userId'])
    await db.user.delete({ where: { id: u } })
    expect(await db.aiUsage.count({ where: { userId: u } })).toBe(0)
  })

  it('an unknown feature is a programming error, not a silent no-limit', async () => {
    await expect(consumeAiQuota('u', 'outfit_generation' as never)).rejects.toThrow(/no AI quota/)
  })
})
