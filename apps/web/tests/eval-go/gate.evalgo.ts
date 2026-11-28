/**
 * The harness's ledger as Go's attempt gate (live-accounting.ts ledgerGate,
 * `lookly eval --gate`; docs/plan/B7.md, B7.4f): every attempt Go makes is
 * estimated, reserved and counted before it is sent; a refusal (budget,
 * circuit) is never sent and ends the case as `cancelled`.
 */
import { describe, expect, it } from 'vitest'
import { estimateTextAttempt, estimateVisionAttempt } from '../../scripts/ai-eval/cost-bounds'
import { GoPipeline, serveStandIn } from '../../scripts/ai-eval/go-pipeline'
import { CallBudget, CallLedger, estimateAsked, ledgerGate } from '../../scripts/ai-eval/live-accounting'
import type { AttemptGate, GateAsk, LLMProvider, LLMRequest, VisionProvider, VisionRequest } from '../../scripts/ai-eval/protocol'
import { stylistCases } from '../../scripts/ai-eval/stylist-cases'
import { ScriptedStylist, runStylistCaseGo } from '../../scripts/ai-eval/stylist-eval'
import { renderSynthetic, syntheticVisionItems } from '../../scripts/ai-eval/synthetic-vision'

if (!process.env.LOOKLY_BINARY) throw new Error('LOOKLY_BINARY is not set: build apps/api (go build -tags nodynamic -o <path> ./cmd/lookly) and point it there')

const CASE = stylistCases()[0]

/** A scripted stylist that fails its first `failures` attempts (unavailable), recording what it is sent. */
function flaky(failures: number) {
  const inner = new ScriptedStylist()
  const sent: LLMRequest[] = []
  const provider: LLMProvider = {
    name: 'scripted', model: 'offline',
    async generate(req) {
      sent.push(req)
      if (sent.length <= failures) throw Object.assign(new Error('busy'), { kind: 'unavailable' })
      return inner.generate(req)
    },
  }
  return { provider, sent }
}

async function stylistThroughGate(provider: LLMProvider, gate: AttemptGate, model = 'offline') {
  const standIn = await serveStandIn(provider)
  const go = new GoPipeline({ args: ['--provider=openai', `--model=${model}`, `--base-url=${standIn.url}`], gate })
  try {
    return await runStylistCaseGo(go, { name: 'scripted', model }, CASE)
  } finally {
    await go.close()
    await standIn.close()
  }
}

describe('the ledger decides every attempt Go makes', () => {
  it('a failure and its retry: both counted, one retry, the error kind', async () => {
    const { provider, sent } = flaky(1)
    const ledger = new CallLedger()
    const r = await stylistThroughGate(provider, ledgerGate(ledger))
    expect(r.outcome.kind).toBe('answer')
    expect([sent.length, r.calls, ledger.attempts, ledger.retries, ledger.attemptErrors]).toEqual([2, 2, 2, 1, { unavailable: 1 }])
    expect(ledger.endCase()).toEqual({ skip: null, attempts: 2 })
  })

  it('--max-calls of 1: the retry is refused before it is sent; the case ends cancelled, BUDGET_STOP', async () => {
    const { provider, sent } = flaky(1)
    const ledger = new CallLedger(new CallBudget(1, null))
    const r = await stylistThroughGate(provider, ledgerGate(ledger))
    expect(r.outcome).toEqual({ kind: 'error', error: 'cancelled' })
    expect([sent.length, r.calls, ledger.attempts, ledger.skipped.budget_stop]).toEqual([1, 1, 1, 1])
    expect(ledger.endCase()).toEqual({ skip: 'budget_stop', attempts: 1 })
  })

  it('an open circuit: nothing is sent, not an attempt', async () => {
    const { provider, sent } = flaky(0)
    const ledger = new CallLedger()
    ledger.fail({ kind: 'auth' })
    ledger.fail({ kind: 'auth' })
    expect(ledger.circuitOpen).toBe('auth')
    const r = await stylistThroughGate(provider, ledgerGate(ledger))
    expect(r.outcome).toEqual({ kind: 'error', error: 'cancelled' })
    expect([sent.length, r.calls, ledger.attempts, ledger.skipped.circuit_break]).toEqual([0, 0, 0, 1])
  })

  it("the estimate of an asked attempt is the in-process estimate of what was sent", async () => {
    const { provider, sent } = flaky(0)
    const asked: GateAsk[] = []
    const r = await stylistThroughGate(provider, { ask: (a) => (asked.push(a), true), attempted: () => {} }, 'gpt-5.4-mini')
    expect(r.outcome.kind).toBe('answer')
    expect(asked.length).toBe(sent.length)
    for (const [i, a] of asked.entries()) {
      expect(a.text?.messages).toEqual(sent[i].messages)
      expect(estimateAsked(a)).toEqual(estimateTextAttempt(sent[i]))
      expect(estimateAsked(a)).toMatchObject({ ok: true })
    }
  })

  it("a picture's estimate from its ask equals the estimate from the bytes sent", async () => {
    const received: VisionRequest[] = []
    const asked: GateAsk[] = []
    const vision: VisionProvider = {
      name: 'scripted-vision', model: 'gpt-5.4-mini',
      async analyzeImage(req) {
        received.push(req)
        return { output: {}, metadata: { provider: 'x', model: 'y', usage: {} } }
      },
    }
    const standIn = await serveStandIn(null, vision)
    const go = new GoPipeline({ args: ['--provider=openai', '--model=gpt-5.4-mini', `--base-url=${standIn.url}`], gate: { ask: (a) => (asked.push(a), true), attempted: () => {} } })
    try {
      const picture = Buffer.from(await renderSynthetic(syntheticVisionItems()[0])).toString('base64')
      await go.run('vision', { image: picture, maxSide: 768, openaiDetail: 'high' })
    } finally {
      await go.close()
      await standIn.close()
    }
    expect([asked.length, received.length]).toEqual([1, 1])
    const fromBytes = await estimateVisionAttempt('openai', 'gpt-5.4-mini', received[0])
    expect(fromBytes).toMatchObject({ ok: true })
    expect(estimateAsked(asked[0])).toEqual(fromBytes)
  })

  it('cases sent together through a gate go one at a time, each answered', async () => {
    const { provider } = flaky(0)
    const ledger = new CallLedger()
    const standIn = await serveStandIn(provider)
    const go = new GoPipeline({ args: ['--provider=openai', '--model=offline', `--base-url=${standIn.url}`], gate: ledgerGate(ledger) })
    try {
      const both = await Promise.all([runStylistCaseGo(go, { name: 'scripted', model: 'offline' }, CASE), runStylistCaseGo(go, { name: 'scripted', model: 'offline' }, CASE)])
      expect(both.map((r) => r.outcome.kind)).toEqual(['answer', 'answer'])
      expect(ledger.attempts).toBe(2)
    } finally {
      await go.close()
      await standIn.close()
    }
  })

  it('a gate that throws: the attempt is refused and the case fails with its error', async () => {
    const { provider, sent } = flaky(0)
    await expect(stylistThroughGate(provider, { ask: () => { throw new Error('ledger broke') }, attempted: () => {} })).rejects.toThrow(/ledger broke/)
    expect(sent.length).toBe(0)
  })
})
