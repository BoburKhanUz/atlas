/**
 * STY: the stylist turn end to end against real PostgreSQL and the AiUsage
 * quota, with a scripted provider (no network, no paid API): atomic storage,
 * ownership, idempotent replay, refunds, the quota limit under concurrency
 * and the transaction rollback when the idempotency claim is lost.
 */
import crypto from 'crypto'
import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it } from 'vitest'
import { POST as chat } from '@/app/api/v1/stylist/chat/route'
import { signAccessToken } from '@/lib/auth'
import { db } from '@/lib/db'
import { setAiMonitoringSinks, type AiMonitoringEvent } from '@/lib/ai/monitoring'
import { setLLMProviderForTesting } from '@/lib/ai/providers'
import { AiProviderError } from '@/lib/ai/providers/errors'
import type { LLMProvider, LLMRequest } from '@/lib/ai/providers/types'
import { getAiUsage } from '@/lib/ai/quota'
import { APP_DB, enabled, sql } from './pg'

let seq = 0
async function newUser() {
  const id = `su_${process.pid}_${++seq}`
  sql(APP_DB, `INSERT INTO "User" ("id","email","passwordHash","updatedAt") VALUES ('${id}','${id}@test.local','x', now())`)
  sql(APP_DB, `INSERT INTO "WardrobeItem" ("id","userId","category","subcategory","colors","season","formality","updatedAt") VALUES
    ('${id}_w1','${id}','shirt','oxford_shirt','["white"]','["spring"]','smart_casual', now()),
    ('${id}_w2','${id}','pants','chinos','["navy"]','["spring"]','smart_casual', now()),
    ('${id}_w3','${id}','shoes','loafers','["brown"]','["spring"]','smart_casual', now())`)
  return { id, auth: { authorization: `Bearer ${await signAccessToken({ sub: id, email: `${id}@test.local` })}` } }
}

function post(body: unknown, headers: Record<string, string>) {
  const raw = JSON.stringify(body)
  return chat(
    new NextRequest('http://localhost/api/v1/stylist/chat', {
      method: 'POST',
      headers: { host: 'localhost', 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(raw)), ...headers },
      body: raw,
    }),
    undefined,
  )
}

class Scripted implements LLMProvider {
  readonly name = 'openai'
  readonly model = 'openai-test-llm'
  calls = 0
  constructor(private readonly step: (req: LLMRequest) => string | Promise<string>) {}
  async generate(req: LLMRequest) {
    this.calls++
    return { text: await this.step(req), metadata: { provider: this.name, model: this.model, usage: {} } }
  }
}
const good = () => JSON.stringify({ answer: 'Bugun [W1] va [W2] ni kiying.', referencedItems: ['W1', 'W2'], needsMoreInfo: false })
const usage = (userId: string) => getAiUsage(userId, 'stylist_chat')
const messages = (userId: string) => db.aiMessage.findMany({ where: { conversation: { userId } }, orderBy: { createdAt: 'asc' } })

describe.skipIf(!enabled)('STY: stylist chat (real PostgreSQL + quota)', () => {
  afterEach(() => setLLMProviderForTesting(null))

  it('STY-01: success stores the user message and the grounded answer together; an idempotent replay returns it without a second call or charge', async () => {
    const u = await newUser()
    const p = new Scripted(good)
    setLLMProviderForTesting(p)
    const key = { ...u.auth, 'idempotency-key': `sty-${crypto.randomUUID()}` }
    const first = await post({ message: 'Bugun nima kiyay?' }, key)
    expect(first.status).toBe(200)
    const a = await first.json()
    expect(a.assistantMessage).toMatch(/^Bugun .+ va .+ ni kiying\.$/)
    expect(a.assistantMessage).not.toMatch(/W\d/)
    const stored = await messages(u.id)
    expect(stored.map((m) => [m.role, m.content])).toEqual([
      ['user', 'Bugun nima kiyay?'],
      ['assistant', a.assistantMessage],
    ])
    const meta = JSON.parse(stored[1].metadataJson)
    expect(meta).toMatchObject({ provider: 'openai', model: 'openai-test-llm', promptVersion: 'v1' })
    expect(meta.referencedItemIds.every((id: string) => id.startsWith(u.id))).toBe(true)
    expect(await usage(u.id)).toBe(1)

    // Monitoring: the replay is visible as such (no provider call, no charge).
    const seen: AiMonitoringEvent[] = []
    setAiMonitoringSinks([{ emit: (e) => seen.push(e) }])
    const replay = await post({ message: 'Bugun nima kiyay?' }, key)
    expect(replay.status).toBe(200)
    expect(replay.headers.get('idempotent-replayed')).toBe('true')
    expect(await replay.json()).toEqual(a)
    expect(p.calls).toBe(1)
    expect(await usage(u.id)).toBe(1)
    expect(await messages(u.id)).toHaveLength(2)
    setAiMonitoringSinks(null)
    expect(seen.map((e) => `${e.event}:${e.feature}:${e.outcome}:${e.billable}`)).toEqual(['ai.request:stylist_chat:replay:false'])
  })

  it('STY-02: AI_UNAVAILABLE → nothing stored (no conversation, no user message), refunded, key released (the same key works later)', async () => {
    const u = await newUser()
    setLLMProviderForTesting(new Scripted(() => {
      throw new AiProviderError('auth', 'openai', { status: 401 })
    }))
    const key = { ...u.auth, 'idempotency-key': `sty-${crypto.randomUUID()}` }
    const res = await post({ message: 'Salom' }, key)
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('AI_UNAVAILABLE')
    expect(await db.aiConversation.count({ where: { userId: u.id } })).toBe(0)
    expect(await usage(u.id)).toBe(0)
    setLLMProviderForTesting(new Scripted(good))
    expect((await post({ message: 'Salom' }, key)).status).toBe(200)
    expect(await messages(u.id)).toHaveLength(2)
  })

  it('STY-03: an existing conversation is continued; a foreign one is 404 without quota, storage or a new conversation', async () => {
    const owner = await newUser()
    const intruder = await newUser()
    setLLMProviderForTesting(new Scripted(good))
    const { conversationId } = await (await post({ message: 'Birinchi' }, owner.auth)).json()
    const p = new Scripted((req) => {
      expect(req.messages.some((m) => m.role === 'user' && m.content === 'Birinchi')).toBe(true) // history
      return good()
    })
    setLLMProviderForTesting(p)
    const second = await post({ message: 'Ikkinchi', conversationId }, owner.auth)
    expect((await second.json()).conversationId).toBe(conversationId)
    expect(await messages(owner.id)).toHaveLength(4)

    const res = await post({ message: 'Menga ham', conversationId }, intruder.auth)
    expect(res.status).toBe(404)
    expect(await db.aiConversation.count({ where: { userId: intruder.id } })).toBe(0)
    expect(await usage(intruder.id)).toBe(0)
    expect(await messages(owner.id)).toHaveLength(4)
    expect((await post({ message: 'x', conversationId: 'conv_does_not_exist' }, owner.auth)).status).toBe(404)
    expect(p.calls).toBe(1)
  })

  it('STY-04: at 48 of 50, five concurrent turns → exactly two answers and three 429s with Retry-After; never more than 50', async () => {
    const u = await newUser()
    const p = new Scripted(async () => {
      await new Promise((r) => setTimeout(r, 30))
      return good()
    })
    setLLMProviderForTesting(p)
    sql(APP_DB, `INSERT INTO "AiUsage" ("id","userId","feature","day","count","updatedAt") VALUES ('${crypto.randomUUID()}','${u.id}','stylist_chat', (now() AT TIME ZONE 'Asia/Tashkent')::date, 48, now())`)
    const results = await Promise.all(Array.from({ length: 5 }, () => post({ message: 'Nima kiyay?' }, u.auth)))
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 429, 429, 429])
    expect(p.calls).toBe(2)
    expect(await usage(u.id)).toBe(50)
    const limited = results.find((r) => r.status === 429)!
    expect((await limited.json()).code).toBe('AI_QUOTA_EXCEEDED')
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(await messages(u.id)).toHaveLength(4)
  })

  it('STY-05: if the idempotency claim is lost mid-turn, the transaction rolls back: no messages, no conversation, refunded', async () => {
    const u = await newUser()
    const key = `sty-${crypto.randomUUID()}`
    setLLMProviderForTesting(new Scripted(async () => {
      // Another request takes the claim over while the provider is answering.
      await db.idempotencyKey.updateMany({ where: { userId: u.id, key }, data: { createdAt: new Date(Date.now() + 1000) } })
      return good()
    }))
    const res = await post({ message: 'Salom' }, { ...u.auth, 'idempotency-key': key })
    expect(res.status).toBe(500)
    expect(await db.aiConversation.count({ where: { userId: u.id } })).toBe(0)
    expect(await db.aiMessage.count({ where: { conversation: { userId: u.id } } })).toBe(0)
    expect(await usage(u.id)).toBe(0)
  })

  it('STY-06: an ungrounded answer is corrected once; still ungrounded → 503, nothing stored, refunded', async () => {
    const u = await newUser()
    const p = new Scripted(() => JSON.stringify({ answer: 'Bugun [W40] kiying.', referencedItems: [], needsMoreInfo: false }))
    setLLMProviderForTesting(p)
    const res = await post({ message: 'Salom' }, u.auth)
    expect(res.status).toBe(503)
    expect(p.calls).toBe(2)
    expect(await messages(u.id)).toHaveLength(0)
    expect(await usage(u.id)).toBe(0)
  })

  it('STY-07: the mock provider answers (labelled demo) and never uses quota', async () => {
    const u = await newUser()
    const res = await post({ message: 'Salom' }, u.auth) // default provider: the mock
    expect(res.status).toBe(200)
    expect((await res.json()).assistantMessage).toMatch(/^Demo rejim: /)
    expect(await db.aiUsage.count({ where: { userId: u.id } })).toBe(0)
  })
})
