/**
 * Cost reservation for the evaluation harnesses (scripts/ai-eval/cost-bounds.ts,
 * CallBudget / CallLedger in live-accounting.ts): every attempt is estimated
 * and reserved BEFORE it is dispatched; unknown cost is never zero; a budget
 * that cannot cover the next reservation stops the next dispatch.
 *
 * The real adapters run against a scripted fetch (fake key, no network); the
 * global fetch is watched to prove no request leaves the process.
 */
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bakeoffMarkdown, buildBakeoff } from '../../../scripts/ai-eval/bakeoff'
import {
  costOf,
  estimateTextAttempt,
  estimateVisionAttempt,
  INPUT_ESTIMATE_STATUS,
  openaiImageTokens,
  PER_MESSAGE_OVERHEAD_TOKENS,
  PER_REQUEST_OVERHEAD_TOKENS,
  SCHEMA_BYTES_MULTIPLIER,
  textInputHeuristic,
} from '../../../scripts/ai-eval/cost-bounds'
import { CallBudget, CallLedger, configuredPrice, costAccounting, COST_UNAVAILABLE, countedLLM, retryingVision } from '../../../scripts/ai-eval/live-accounting'
import { runValidation } from '../../../scripts/ai-eval/real-data/validate'
import { runStylistCase, ScriptedStylist } from '../../../scripts/ai-eval/stylist-eval'
import { stylistCases } from '../../../scripts/ai-eval/stylist-cases'
import { AiProviderError } from '@/lib/ai/providers/errors'
import { OpenAIProvider } from '@/lib/ai/providers/openai'
import type { FetchLike } from '@/lib/ai/providers/http'
import type { LLMProvider, LLMRequest, VisionRequest } from '@/lib/ai/providers/types'

const FAKE = 'fake-key-not-real-cost-01'
const MODEL = 'gpt-5.4-mini'
const PRICE = { inputUsdPerMTok: 1, outputUsdPerMTok: 2 }
const noSleep = async () => {}

const REQ: LLMRequest = {
  messages: [
    { role: 'system', content: 'S' },
    { role: 'user', content: 'U' },
  ],
  maxOutputTokens: 100,
  jsonSchema: { name: 'x', schema: { type: 'object' } },
  timeoutMs: 1_000,
}
const EST = (() => {
  const e = estimateTextAttempt(REQ)
  if (!e.ok) throw new Error('fixture has no estimate')
  return costOf(e.tokens, PRICE)
})()

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const completion = (content: string, usage?: { prompt_tokens: number; completion_tokens: number }) =>
  json({ choices: [{ finish_reason: 'stop', message: { content } }], ...(usage ? { usage: { ...usage, total_tokens: usage.prompt_tokens + usage.completion_tokens } } : {}) })

/** A scripted transport: `respond` decides each dispatch; `calls` counts them; `seen` records what the budget looked like at dispatch. */
function transport(respond: (n: number, init?: RequestInit) => Promise<Response> | Response, budget?: CallBudget) {
  const t = {
    calls: 0,
    seen: [] as Array<{ attemptsUsed: number; reservedUsd: number }>,
    fetch: (async (_url: string, init?: RequestInit) => {
      if (budget) t.seen.push({ attemptsUsed: budget.attemptsUsed, reservedUsd: budget.cost.reservedUsd })
      return respond(t.calls++, init)
    }) as FetchLike,
  }
  return t
}
const openai = (fetch: FetchLike, model = MODEL) => new OpenAIProvider({ apiKey: FAKE, model, fetch })

let globalFetch: ReturnType<typeof vi.fn>
beforeEach(() => {
  globalFetch = vi.fn(async () => {
    throw new Error('network is not allowed in this test')
  })
  vi.stubGlobal('fetch', globalFetch)
})
afterEach(() => {
  vi.unstubAllGlobals()
  expect(globalFetch).not.toHaveBeenCalled() // nothing ever left the process
})

describe('reservation before dispatch', () => {
  it('the attempt is admitted and its estimate reserved before the request is dispatched', async () => {
    const budget = new CallBudget(10, 1)
    const t = transport(() => completion('{"a":1}', { prompt_tokens: 10, completion_tokens: 5 }), budget)
    await countedLLM(openai(t.fetch), new CallLedger(budget, PRICE)).generate(REQ)
    expect(t.seen).toEqual([{ attemptsUsed: 1, reservedUsd: EST.totalUsd }])
  })

  it('a request whose reservation exceeds the remaining budget is never dispatched', async () => {
    const budget = new CallBudget(10, EST.totalUsd / 2)
    const t = transport(() => completion('{"a":1}'))
    await expect(countedLLM(openai(t.fetch), new CallLedger(budget, PRICE)).generate(REQ)).rejects.toMatchObject({ name: 'LocalRefusalError', reason: 'budget_stop' })
    expect([t.calls, budget.attemptsUsed, budget.exhausted]).toEqual([0, 0, 'max_cost'])
  })

  it('regression: once the budget is exhausted no further fetch is dispatched', async () => {
    const budget = new CallBudget(100, EST.totalUsd * 2)
    const t = transport(() => json({ error: {} }, 500))
    const p = countedLLM(openai(t.fetch), new CallLedger(budget, PRICE))
    for (let i = 0; i < 5; i++) await p.generate(REQ).catch(() => undefined)
    // Two failed attempts keep their whole reservation (2 × estimate = the cap); the third cannot be reserved.
    expect([t.calls, budget.attemptsUsed, budget.exhausted]).toEqual([2, 2, 'max_cost'])
    expect(budget.cost.chargedUsd).toBe(EST.totalUsd * 2)
  })

  it('concurrent attempts cannot reserve the same budget twice', async () => {
    const budget = new CallBudget(100, EST.totalUsd * 2)
    const release: Array<() => void> = []
    const t = transport(() => new Promise<Response>((resolve) => release.push(() => resolve(completion('{"a":1}', { prompt_tokens: 10, completion_tokens: 5 })))))
    const p = countedLLM(openai(t.fetch), new CallLedger(budget, PRICE))
    const all = Promise.allSettled([p.generate(REQ), p.generate(REQ), p.generate(REQ)])
    await vi.waitFor(() => expect(release.length).toBe(2))
    release.forEach((r) => r())
    const outcomes = await all
    expect(outcomes.map((o) => o.status)).toEqual(['fulfilled', 'fulfilled', 'rejected'])
    expect([t.calls, budget.attemptsUsed]).toEqual([2, 2])
  })
})

describe('failed and incomplete attempts are never free', () => {
  const run = async (respond: (n: number, init?: RequestInit) => Promise<Response> | Response, req: LLMRequest = REQ) => {
    const budget = new CallBudget(10, 1)
    const ledger = new CallLedger(budget, PRICE)
    const t = transport(respond)
    const err = await countedLLM(openai(t.fetch), ledger)
      .generate(req)
      .then(() => null, (e: unknown) => e)
    return { budget, ledger, t, err }
  }

  it('a timeout keeps the full reservation', async () => {
    const { budget, ledger, err } = await run(
      (_n, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
      { ...REQ, timeoutMs: 20 },
    )
    expect(err).toMatchObject({ kind: 'timeout' })
    expect(costAccounting(budget.cost)).toMatchObject({ retainedReservationAttempts: 1, retainedReservationUsd: EST.totalUsd, providerReportedCostUsd: COST_UNAVAILABLE, conservativeCostUsd: EST.totalUsd })
    expect(ledger.timeouts).toBe(1)
  })

  it('a network failure keeps the full reservation', async () => {
    const { budget, err } = await run(() => {
      throw new TypeError('connection reset')
    })
    expect(err).toMatchObject({ kind: 'network' })
    expect(budget.cost).toMatchObject({ retainedReservationAttempts: 1, retainedReservationUsd: EST.totalUsd, providerReportedAttempts: 0 })
  })

  it('a malformed response keeps the full reservation, even though the body carried usage', async () => {
    const { budget, err } = await run(() => completion('not json at all', { prompt_tokens: 10, completion_tokens: 5 }))
    expect(err).toMatchObject({ kind: 'malformed_response' })
    expect(budget.cost).toMatchObject({ retainedReservationAttempts: 1, retainedReservationUsd: EST.totalUsd, providerReportedAttempts: 0 })
  })

  it('a successful response without usage is not treated as zero cost', async () => {
    const { budget, err } = await run(() => completion('{"a":1}'))
    expect(err).toBeNull()
    expect(costAccounting(budget.cost)).toMatchObject({ providerReportedCostUsd: COST_UNAVAILABLE, retainedReservationAttempts: 1, conservativeCostUsd: EST.totalUsd })
    expect(budget.cost.chargedUsd).toBeGreaterThan(0)
  })

  it('without a price there is no estimate either: the cost is reported as unknown, never $0', () => {
    const ledger = new CallLedger(new CallBudget(10, null), null)
    ledger.fail(new AiProviderError('timeout', 'p'), ledger.before('p'))
    expect(costAccounting(ledger.cost)).toMatchObject({ unpricedOrUnknownCostAttempts: 1, conservativeCostUsd: COST_UNAVAILABLE, providerReportedCostUsd: COST_UNAVAILABLE })
  })
})

describe('settlement', () => {
  it('complete provider usage settles at the exact-model price and releases the rest of the reservation', async () => {
    const budget = new CallBudget(10, 1)
    const t = transport(() => completion('{"a":1}', { prompt_tokens: 100, completion_tokens: 20 }))
    await countedLLM(openai(t.fetch), new CallLedger(budget, PRICE)).generate(REQ)
    const reported = (100 * 1 + 20 * 2) / 1e6
    expect(costAccounting(budget.cost)).toMatchObject({ providerReportedCostUsd: reported, providerReportedAttempts: 1, retainedReservationAttempts: 0, conservativeCostUsd: reported, reservedCostUsd: EST.totalUsd })
    expect(budget.costSpentUsd).toBe(reported)
    expect(budget.exhausted).toBeNull()
  })

  it('reported cost above the reservation stops every later request immediately', async () => {
    const budget = new CallBudget(10, 1)
    const t = transport(() => completion('{"a":1}', { prompt_tokens: 100_000, completion_tokens: 20 }))
    const p = countedLLM(openai(t.fetch), new CallLedger(budget, PRICE))
    await p.generate(REQ) // the call happened: its result stands, but nothing more is sent
    await expect(p.generate(REQ)).rejects.toMatchObject({ reason: 'budget_stop' })
    expect([t.calls, budget.exhausted, budget.cost.estimateExceededAttempts]).toEqual([1, 'estimate_exceeded', 1])
    expect(budget.stopDetail).toMatch(/exceeded its pre-request estimate/)
  })

  it('reported output tokens above the documented output limit also stop the run', async () => {
    const budget = new CallBudget(10, 1)
    const t = transport(() => completion('{"a":1}', { prompt_tokens: 1, completion_tokens: 101 }))
    const p = countedLLM(openai(t.fetch), new CallLedger(budget, PRICE))
    await p.generate(REQ)
    await expect(p.generate(REQ)).rejects.toMatchObject({ reason: 'budget_stop' })
    expect([t.calls, budget.exhausted]).toEqual([1, 'estimate_exceeded'])
  })
})

describe('retries and corrections', () => {
  it('every retry and every correction is its own reservation and its own call from --max-calls', async () => {
    const budget = new CallBudget(10, 1)
    const ledger = new CallLedger(budget, PRICE)
    const good = new ScriptedStylist()
    // 503 (retried once by the app policy), then an answer with an unknown reference (→ correction), then a valid one.
    const steps = ['unavailable', 'bad_ref', 'ok'] as const
    let n = 0
    const inner: LLMProvider = {
      name: 'scripted',
      model: 'm',
      async generate(req) {
        const step = steps[Math.min(n++, steps.length - 1)]
        if (step === 'unavailable') throw new AiProviderError('unavailable', 'scripted', { status: 503 })
        const out = JSON.parse((await good.generate(req)).text)
        if (step === 'bad_ref') out.referencedItems = ['W999']
        return { text: JSON.stringify(out), metadata: { provider: 'scripted', model: 'm', usage: { inputTokens: 10, outputTokens: 5 } } }
      },
    }
    const r = await runStylistCase(countedLLM(inner, ledger), stylistCases().find((c) => c.id === 'casual')!)
    expect(r.requests).toBe(2) // first request + correction
    expect([n, ledger.attempts, ledger.retries, budget.attemptsUsed, budget.cost.estimatedAttempts]).toEqual([3, 3, 1, 3, 3])
    expect(budget.cost).toMatchObject({ retainedReservationAttempts: 1, providerReportedAttempts: 2 }) // the 503 keeps its reservation
  })

  it('--max-calls stays an independent hard limit, whatever the dollar budget', async () => {
    const budget = new CallBudget(2, 1_000)
    const t = transport(() => completion('{"a":1}', { prompt_tokens: 1, completion_tokens: 1 }))
    const p = countedLLM(openai(t.fetch), new CallLedger(budget, PRICE))
    await p.generate(REQ)
    await p.generate(REQ)
    await expect(p.generate(REQ)).rejects.toMatchObject({ reason: 'budget_stop' })
    expect([t.calls, budget.exhausted]).toEqual([2, 'max_calls'])
  })
})

describe('fail closed with a dollar budget', () => {
  it('no price for the provider and exact model: refused before dispatch', async () => {
    const budget = new CallBudget(10, 1)
    const t = transport(() => completion('{"a":1}'))
    await expect(countedLLM(openai(t.fetch), new CallLedger(budget, null)).generate(REQ)).rejects.toMatchObject({ reason: 'budget_stop' })
    expect([t.calls, budget.exhausted]).toEqual([0, 'unpriced'])
  })

  it('no output-token limit on the request: refused before dispatch', async () => {
    const budget = new CallBudget(10, 1)
    const t = transport(() => completion('{"a":1}'))
    await expect(countedLLM(openai(t.fetch), new CallLedger(budget, PRICE)).generate({ ...REQ, maxOutputTokens: undefined })).rejects.toMatchObject({ reason: 'budget_stop' })
    expect([t.calls, budget.exhausted, budget.stopDetail]).toEqual([0, 'unbounded', 'no output-token limit on the request'])
  })

  it('a mismatched price model is refused by the bake-off before any provider is built', async () => {
    let built = 0
    const env = { OPENAI_API_KEY: FAKE, AI_EVAL_OPENAI_MODEL: MODEL, AI_LLM_PROVIDER: 'openai', AI_LLM_MODEL: 'gpt-5.4', AI_LLM_PRICE_INPUT_USD_PER_MTOK: '0.75', AI_LLM_PRICE_OUTPUT_USD_PER_MTOK: '4.5' }
    const llm = () => {
      built++
      return new ScriptedStylist()
    }
    await expect(buildBakeoff(env, { maxCalls: 500, maxCostUsd: 1, providers: { llm } })).rejects.toThrow(/cannot be enforced: openai\/stylist: no price above zero for this provider and exact model/)
    expect(built).toBe(0)
  })

  it('Gemini vision has no documented image bound: refused by the bake-off before any provider is built', async () => {
    const env = { GEMINI_API_KEY: FAKE, AI_EVAL_GEMINI_VISION_MODEL: 'g-vision', AI_VISION_PROVIDER: 'gemini', AI_VISION_MODEL: 'g-vision', AI_VISION_PRICE_INPUT_USD_PER_MTOK: '1', AI_VISION_PRICE_OUTPUT_USD_PER_MTOK: '1' }
    const { assertCostBudgetable } = await import('../../../scripts/ai-eval/bakeoff')
    expect(() => assertCostBudgetable({ runs: 1, sections: [{ provider: 'gemini', feature: 'vision', cases: 1, upperBoundCalls: 2 }], upperBoundCalls: 2, maxCalls: 2, maxCostUsd: 1 }, env)).toThrow(/gemini\/vision: no documented image-token bound/)
  })

  it('the real-data validator refuses an unpriced dollar budget before any provider is built', async () => {
    let built = 0
    const env = { OPENAI_API_KEY: FAKE, AI_EVAL_OPENAI_MODEL: MODEL, AI_LLM_PROVIDER: 'openai' }
    const llm = () => {
      built++
      return new ScriptedStylist()
    }
    await expect(
      runValidation(env, { root: null, purpose: 'evaluation', maxCalls: 1_000, maxCostUsd: 1, transmitConstructed: true, now: new Date('2026-10-09T00:00:00Z'), runId: 'cost-test', appCommit: { sha: null, clean: null }, providers: { llm } }),
    ).rejects.toThrow(/needs a price above zero for the exact model.*openai/)
    expect(built).toBe(0)
  })
})

describe('audit regressions', () => {
  it('a model id that is an inherited object key never gets an image bound (no NaN reservation)', async () => {
    for (const model of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) expect(openaiImageTokens(model, 'high', 64, 64)).toBeNull()
    const env = { OPENAI_API_KEY: FAKE, AI_VISION_PROVIDER: 'openai', AI_VISION_MODEL: 'constructor', AI_EVAL_OPENAI_VISION_MODEL: 'constructor', AI_VISION_PRICE_INPUT_USD_PER_MTOK: '1', AI_VISION_PRICE_OUTPUT_USD_PER_MTOK: '1' }
    const { assertCostBudgetable } = await import('../../../scripts/ai-eval/bakeoff')
    expect(() => assertCostBudgetable({ runs: 1, sections: [{ provider: 'openai', feature: 'vision', cases: 1, upperBoundCalls: 2 }], upperBoundCalls: 2, maxCalls: 2, maxCostUsd: 1 }, env)).toThrow(/no documented image-token bound/)
  })

  it('a NaN or negative estimate is refused before dispatch, never admitted', () => {
    const budget = new CallBudget(10, 1)
    expect(budget.admit(costOf({ textInputTokens: 1, imageInputTokens: Number.NaN, outputTokens: 1 }, PRICE))).toBeNull()
    expect([budget.attemptsUsed, budget.exhausted]).toEqual([0, 'unbounded'])
  })

  it('with a dollar budget a zero price is not a price: refused before dispatch, and by the bake-off pre-check', async () => {
    const budget = new CallBudget(100, 0.01)
    const t = transport(() => completion('{"a":1}', { prompt_tokens: 1, completion_tokens: 1 }))
    await expect(countedLLM(openai(t.fetch), new CallLedger(budget, { inputUsdPerMTok: 0, outputUsdPerMTok: 4.5 })).generate(REQ)).rejects.toMatchObject({ reason: 'budget_stop' })
    expect([t.calls, budget.exhausted]).toEqual([0, 'unpriced'])
    const env = { OPENAI_API_KEY: FAKE, AI_EVAL_OPENAI_MODEL: MODEL, AI_LLM_PROVIDER: 'openai', AI_LLM_MODEL: MODEL, AI_LLM_PRICE_INPUT_USD_PER_MTOK: '0', AI_LLM_PRICE_OUTPUT_USD_PER_MTOK: '0' }
    await expect(buildBakeoff(env, { maxCalls: 500, maxCostUsd: 1, providers: { llm: () => new ScriptedStylist() } })).rejects.toThrow(/no price above zero/)
    // Without a dollar budget a zero price is still just a price (legacy reporting).
    expect(configuredPrice('openai', MODEL, 'llm', env)).toEqual({ inputUsdPerMTok: 0, outputUsdPerMTok: 0 })
  })
})

describe('pricing is matched on provider AND exact model', () => {
  const env = { AI_LLM_PROVIDER: 'OpenAI', AI_LLM_MODEL: MODEL, AI_LLM_PRICE_INPUT_USD_PER_MTOK: '0.75', AI_LLM_PRICE_OUTPUT_USD_PER_MTOK: '4.50' }
  it('the exact model gets the price; another model of the same provider never does', () => {
    expect(configuredPrice('openai', MODEL, 'llm', env)).toEqual({ inputUsdPerMTok: 0.75, outputUsdPerMTok: 4.5 })
    for (const other of ['gpt-5.4', 'gpt-5.4-nano', 'GPT-5.4-MINI', `${MODEL}-2026`, '']) expect(configuredPrice('openai', other, 'llm', env)).toBeNull()
    expect(configuredPrice('openai', null, 'llm', env)).toBeNull()
    expect(configuredPrice('gemini', MODEL, 'llm', env)).toBeNull()
    expect(configuredPrice('openai', MODEL, 'vision', env)).toBeNull() // the text price is never the vision price
    expect(configuredPrice('openai', MODEL, 'llm', { ...env, AI_LLM_MODEL: undefined })).toBeNull()
    expect(() => configuredPrice('openai', MODEL, 'llm', { ...env, AI_LLM_PRICE_OUTPUT_USD_PER_MTOK: '-1' })).toThrow(/non-negative/)
  })
})

describe('estimates', () => {
  it('the text-input estimate is the documented heuristic (bytes, schema × multiplier, fixed allowances) and labelled as such', () => {
    // 'S' + 'U' = 2 bytes; schema 'x' + '{"type":"object"}' = 18 bytes × 2.
    expect(textInputHeuristic(['S', 'U'], REQ.jsonSchema)).toBe(2 + 18 * SCHEMA_BYTES_MULTIPLIER + 2 * PER_MESSAGE_OVERHEAD_TOKENS + PER_REQUEST_OVERHEAD_TOKENS)
    // UTF-8 bytes, not characters: Uzbek apostrophe letters and emoji count every byte.
    expect(textInputHeuristic(['oʻzbek 👗'], undefined)).toBe(Buffer.byteLength('oʻzbek 👗') + PER_MESSAGE_OVERHEAD_TOKENS + PER_REQUEST_OVERHEAD_TOKENS)
    expect(EST.tokens).toEqual({ textInputTokens: 326, imageInputTokens: 0, outputTokens: 100 })
    expect(INPUT_ESTIMATE_STATUS).toBe('HEURISTIC_NOT_GUARANTEE')
  })

  it('OpenAI gpt-5.4 family image tokens follow the documented 32 px patch formula; anything else has no bound', () => {
    expect(openaiImageTokens(MODEL, 'high', 1024, 768)).toBe(Math.ceil(32 * 24 * 1.2) + 1)
    expect(openaiImageTokens(MODEL, 'auto', 1024, 1024)).toBe(Math.ceil(1024 * 1.2) + 1)
    expect(openaiImageTokens(MODEL, 'high', 1000, 1000)).toBe(Math.ceil(32 * 32 * 1.2) + 1) // partial patches count whole
    expect(openaiImageTokens(MODEL, 'low', 1024, 1024)).toBeNull()
    expect(openaiImageTokens(MODEL, 'original', 1024, 1024)).toBeNull()
    expect(openaiImageTokens(MODEL, 'high', 2049, 10)).toBeNull()
    expect(openaiImageTokens('gpt-4o', 'high', 1024, 1024)).toBeNull()
  })

  it('a vision estimate reads the dimensions of the bytes actually sent and fails closed outside the documented settings', async () => {
    const image = new Uint8Array(await sharp({ create: { width: 640, height: 480, channels: 3, background: '#888' } }).jpeg().toBuffer())
    const req: VisionRequest = { image, mimeType: 'image/jpeg', instruction: 'Describe.', maxSide: 1024, maxOutputTokens: 1024, options: { openaiDetail: 'high' }, timeoutMs: 1_000 }
    const ok = await estimateVisionAttempt('openai', MODEL, req)
    expect(ok).toMatchObject({ ok: true, tokens: { imageInputTokens: Math.ceil(20 * 15 * 1.2) + 1, outputTokens: 1024 } })
    expect(await estimateVisionAttempt('openai', MODEL, { ...req, options: { openaiDetail: 'low' } })).toMatchObject({ ok: false })
    expect(await estimateVisionAttempt('gemini', 'g', req)).toMatchObject({ ok: false, reason: 'no documented image-token bound for gemini' })
    expect(await estimateVisionAttempt('openai', 'gpt-4o', req)).toMatchObject({ ok: false })
    expect(await estimateVisionAttempt('openai', MODEL, { ...req, maxOutputTokens: undefined })).toMatchObject({ ok: false })
    expect(await estimateVisionAttempt('openai', MODEL, { ...req, image: new Uint8Array([1, 2, 3]) })).toMatchObject({ ok: false, reason: 'image dimensions unreadable' })
    const big = new Uint8Array(await sharp({ create: { width: 2100, height: 10, channels: 3, background: '#888' } }).jpeg().toBuffer())
    expect(await estimateVisionAttempt('openai', MODEL, { ...req, image: big })).toMatchObject({ ok: false })
  })

  it('an unsupported image configuration is refused before dispatch; a supported one reserves the image estimate separately', async () => {
    const image = new Uint8Array(await sharp({ create: { width: 64, height: 64, channels: 3, background: '#888' } }).jpeg().toBuffer())
    const req: VisionRequest = { image, mimeType: 'image/jpeg', instruction: 'Describe.', maxSide: 1024, maxOutputTokens: 1024, options: { openaiDetail: 'low' }, timeoutMs: 1_000 }
    const budget = new CallBudget(10, 1)
    const t = transport(() => completion('{"a":1}', { prompt_tokens: 10, completion_tokens: 5 }))
    await expect(retryingVision(openai(t.fetch), new CallLedger(budget, PRICE), noSleep).analyzeImage(req)).rejects.toMatchObject({ reason: 'budget_stop' })
    expect([t.calls, budget.exhausted]).toEqual([0, 'unbounded'])

    const budget2 = new CallBudget(10, 1)
    await retryingVision(openai(t.fetch), new CallLedger(budget2, PRICE), noSleep).analyzeImage({ ...req, options: { openaiDetail: 'high' } })
    expect(t.calls).toBe(1)
    expect(costAccounting(budget2.cost)).toMatchObject({ estimatedImageCostUsd: (Math.ceil(4 * 1.2) + 1) / 1e6, boundedOutputCostUsd: (1024 * 2) / 1e6 })
  })
})

describe('without --max-cost-usd (legacy behaviour)', () => {
  it('nothing is refused for a missing price or output limit; the estimate is only made when there is a price', async () => {
    const budget = new CallBudget(10, null)
    const t = transport(() => completion('{"a":1}', { prompt_tokens: 10, completion_tokens: 5 }))
    await countedLLM(openai(t.fetch), new CallLedger(budget, null)).generate({ ...REQ, maxOutputTokens: undefined })
    await countedLLM(openai(t.fetch), new CallLedger(budget, PRICE)).generate({ ...REQ, maxOutputTokens: undefined })
    expect([t.calls, budget.exhausted, budget.cost.estimatedAttempts]).toEqual([2, null, 0])
    // A vision request without a price is never inspected (no estimate), exactly as before.
    let inspected = false
    const v = { name: 'v', model: 'm', analyzeImage: async () => ((inspected = true), { output: {}, metadata: { provider: 'v', model: 'm', usage: {} } }) }
    await retryingVision(v, new CallLedger(new CallBudget(10, null), null), noSleep).analyzeImage({} as VisionRequest)
    expect(inspected).toBe(true)
  })

  it('a price without a budget still reports reservations and provider-reported cost, and never stops the run', async () => {
    const budget = new CallBudget(10, null)
    const t = transport(() => completion('{"a":1}', { prompt_tokens: 100_000, completion_tokens: 5 }))
    const p = countedLLM(openai(t.fetch), new CallLedger(budget, PRICE))
    await p.generate(REQ)
    await p.generate(REQ)
    expect([t.calls, budget.exhausted, budget.cost.estimateExceededAttempts]).toEqual([2, null, 2])
  })
})

describe('reports', () => {
  it('the bake-off report keeps estimates, provider-reported cost and unknowns apart, and says the estimate is a heuristic', async () => {
    const env = { GEMINI_API_KEY: FAKE, AI_EVAL_GEMINI_MODEL: 'g', AI_LLM_PROVIDER: 'gemini', AI_LLM_MODEL: 'g', AI_LLM_PRICE_INPUT_USD_PER_MTOK: '1', AI_LLM_PRICE_OUTPUT_USD_PER_MTOK: '2' }
    const r = await buildBakeoff(env, { maxCalls: 500, maxCostUsd: 5, providers: { llm: () => new ScriptedStylist() } })
    const c = r.execution.budget.costAccounting
    expect(c).toMatchObject({ inputEstimateStatus: 'HEURISTIC_NOT_GUARANTEE', retainedReservationAttempts: r.execution.budget.attemptsUsed, providerReportedCostUsd: COST_UNAVAILABLE })
    expect(c.reservedCostUsd).toBeGreaterThan(0)
    expect(c.estimatedInputCostUsd + c.estimatedImageCostUsd + c.boundedOutputCostUsd).toBeCloseTo(c.reservedCostUsd, 6)
    expect(c.note).toMatch(/not a guaranteed maximum charge/)
    const st = r.live[0].accounting.find((a) => a.feature === 'stylist')!
    expect(st.costAccounting.inputEstimateStatus).toBe('HEURISTIC_NOT_GUARANTEE')
    const md = bakeoffMarkdown(r)
    expect(md).toContain('input estimate HEURISTIC_NOT_GUARANTEE')
    expect(md).toContain('not a guaranteed maximum charge')
  })
})
