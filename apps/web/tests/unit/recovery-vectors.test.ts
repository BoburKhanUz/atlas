/**
 * CLI-F1: docs/api/client-recovery-vectors.json — every server response in the
 * vectors is documented for POST /api/v1/auth/refresh, and the web reference
 * implementation behaves exactly as each vector expects. (The contract test
 * tests/integration/contract.itest.ts makes the real server produce each code.)
 */
import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { COOL_DOWN_MS, MAX_REFRESH_ATTEMPTS, NETWORK_RETRY_WINDOW_MS, TERMINAL_CODES, classifyRefreshResponse, runEpisode } from '@/lib/session-recovery'
import { errorCodesFor } from '@/server/openapi/document'
import { OPERATIONS } from '@/server/openapi/registry'
import { errorStatus } from '@/server/http'

type Step = { status?: number; code?: string; retryAfterSeconds?: number; network?: string }
interface Vector {
  id: string
  refreshResponses: Step[]
  refreshResponsesEachOf?: string[]
  originalRetryStatuses?: number[]
  expected: { episode: string; refreshCalls: number; originalRetries: number }
  web: string
  mobile: string
}
const doc = JSON.parse(readFileSync(path.resolve(__dirname, '../../../../docs/api/client-recovery-vectors.json'), 'utf8')) as {
  rules: { maxRefreshAttemptsPerEpisode: number; coolDownAfterFailedEpisodeMs: number; networkRetryWindowMs: number; terminalCodes: string[] }
  vectors: Vector[]
}
const refreshOp = OPERATIONS.find((o) => o.operationId === 'refreshSession')!

function expand(v: Vector): Step[][] {
  if (!v.refreshResponsesEachOf) return [v.refreshResponses]
  return v.refreshResponsesEachOf.map((code) => v.refreshResponses.map((s) => (s.code === '<each terminal code>' ? { ...s, code } : s)))
}

const toResponse = (s: Step) =>
  s.network
    ? null
    : new Response(JSON.stringify(s.status === 200 ? { user: {} } : { code: s.code, error: 'x' }), {
        status: s.status,
        headers: { 'content-type': 'application/json', ...(s.retryAfterSeconds ? { 'retry-after': String(s.retryAfterSeconds) } : {}) },
      })

describe('CLI-F1: client recovery vectors', () => {
  it('the rules match the implementation', () => {
    expect(doc.rules.maxRefreshAttemptsPerEpisode).toBe(MAX_REFRESH_ATTEMPTS)
    expect(doc.rules.coolDownAfterFailedEpisodeMs).toBe(COOL_DOWN_MS)
    expect(doc.rules.networkRetryWindowMs).toBe(NETWORK_RETRY_WINDOW_MS)
    expect([...doc.rules.terminalCodes].sort()).toEqual([...TERMINAL_CODES].sort())
  })

  it('every vector response is a documented response of POST /api/v1/auth/refresh', () => {
    const documented = errorCodesFor(refreshOp)
    for (const v of doc.vectors) {
      for (const steps of expand(v)) {
        for (const s of steps) {
          if (s.network || s.status === 200) continue
          expect(documented, `${v.id}: ${s.code}`).toContain(s.code)
          expect(errorStatus(s.code as never), `${v.id}: ${s.code}`).toBe(s.status)
        }
      }
    }
  })

  it('the web reference implementation does what each vector expects', async () => {
    for (const v of doc.vectors) {
      for (const steps of expand(v)) {
        const queue = [...steps]
        const retries = [...(v.originalRetryStatuses ?? [])]
        let refreshCalls = 0
        let originalRetries = 0
        let t = 0
        const result = await runEpisode({
          refresh: async () => {
            refreshCalls++
            const step = queue.shift()
            if (!step) throw new Error(`${v.id}: more refresh calls than the vector lists`)
            return classifyRefreshResponse(toResponse(step))
          },
          retryOriginal: async () => {
            originalRetries++
            return new Response(null, { status: retries.shift() ?? 200 })
          },
          sleep: async (ms) => {
            t += ms
          },
          now: () => t,
          random: () => 0.5,
        })
        // the caller retries its request once more after a refresh-based recovery
        if (result.kind === 'recovered' && !result.response) originalRetries++
        expect({ episode: result.kind, refreshCalls, originalRetries }, v.id).toEqual(v.expected)
      }
    }
  })
})
