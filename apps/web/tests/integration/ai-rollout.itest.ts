/**
 * ROL: Phase 5.0 rollout against real PostgreSQL and the AiUsage quota, with a
 * counting scripted provider (no network): an allowlisted user is answered and
 * charged; a user outside the rollout is refused, never charged, and nothing is
 * stored; turning the feature off refuses everyone, allowlisted or not.
 */
import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it } from 'vitest'
import { POST as chat } from '@/app/api/v1/stylist/chat/route'
import { signAccessToken } from '@/lib/auth'
import { db } from '@/lib/db'
import { resetAiConfigForTesting } from '@/lib/ai/config'
import { setLLMProviderForTesting } from '@/lib/ai/providers'
import type { LLMProvider } from '@/lib/ai/providers/types'
import { getAiUsage } from '@/lib/ai/quota'
import { allowlistDigest } from '@/lib/ai/rollout'
import { APP_DB, enabled, sql } from './pg'

let seq = 0
async function newUser() {
  const id = `ro_${process.pid}_${++seq}`
  sql(APP_DB, `INSERT INTO "User" ("id","email","passwordHash","updatedAt") VALUES ('${id}','${id}@test.local','x', now())`)
  sql(APP_DB, `INSERT INTO "WardrobeItem" ("id","userId","category","subcategory","colors","season","formality","updatedAt") VALUES
    ('${id}_w1','${id}','shirt','oxford_shirt','["white"]','[]','smart_casual', now()),
    ('${id}_w2','${id}','pants','chinos','["navy"]','[]','smart_casual', now()),
    ('${id}_w3','${id}','shoes','loafers','["brown"]','[]','smart_casual', now())`)
  return { id, auth: { authorization: `Bearer ${await signAccessToken({ sub: id, email: `${id}@test.local` })}` } }
}
const post = (headers: Record<string, string>) => {
  const raw = JSON.stringify({ message: 'Bugun nima kiyay?' })
  return chat(new NextRequest('http://localhost/api/v1/stylist/chat', { method: 'POST', headers: { host: 'localhost', 'content-type': 'application/json', 'content-length': String(raw.length), ...headers }, body: raw }), undefined)
}
class Counting implements LLMProvider {
  readonly name = 'openai'
  readonly model = 'openai-test-llm'
  calls = 0
  async generate() {
    this.calls++
    return { text: JSON.stringify({ answer: 'Oq ko‘ylak kiying.', referencedItems: [], needsMoreInfo: false }), metadata: { provider: this.name, model: this.model, usage: {} } }
  }
}
const ENV = ['AI_STYLIST_ENABLED', 'AI_ROLLOUT_PERCENT', 'AI_ROLLOUT_ALLOWLIST']
const setRollout = (env: Record<string, string>) => {
  for (const k of ENV) delete process.env[k]
  Object.assign(process.env, env)
  resetAiConfigForTesting()
}
const stored = (userId: string) => db.aiMessage.count({ where: { conversation: { userId } } })

describe.skipIf(!enabled)('ROL: AI rollout (real PostgreSQL + quota)', () => {
  afterEach(() => {
    setRollout({})
    setLLMProviderForTesting(null)
  })

  it('ROL-01: at 0 %, the allowlisted user is answered and charged; another user is refused, uncharged, nothing stored', async () => {
    const insider = await newUser()
    const outsider = await newUser()
    const p = new Counting()
    setLLMProviderForTesting(p)
    setRollout({ AI_ROLLOUT_PERCENT: '0', AI_ROLLOUT_ALLOWLIST: allowlistDigest(insider.id) })

    expect((await post(insider.auth)).status).toBe(200)
    expect(await getAiUsage(insider.id, 'stylist_chat')).toBe(1)
    expect(await stored(insider.id)).toBe(2)

    const refused = await post(outsider.auth)
    expect(refused.status).toBe(503)
    expect((await refused.json()).code).toBe('AI_UNAVAILABLE')
    expect(await getAiUsage(outsider.id, 'stylist_chat')).toBe(0)
    expect(await stored(outsider.id)).toBe(0)
    expect(p.calls).toBe(1)
  })

  it('ROL-02: the feature switch off refuses everyone, allowlisted or not; no charge, nothing stored', async () => {
    const insider = await newUser()
    const p = new Counting()
    setLLMProviderForTesting(p)
    setRollout({ AI_STYLIST_ENABLED: 'false', AI_ROLLOUT_PERCENT: '100', AI_ROLLOUT_ALLOWLIST: allowlistDigest(insider.id) })
    expect((await post(insider.auth)).status).toBe(503)
    expect(await getAiUsage(insider.id, 'stylist_chat')).toBe(0)
    expect(await stored(insider.id)).toBe(0)
    expect(p.calls).toBe(0)
  })
})
