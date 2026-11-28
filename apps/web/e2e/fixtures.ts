/**
 * Shared Playwright fixtures: every /api answer the browser receives is checked
 * against docs/api/openapi.json (api-e2e/contract.ts, the API journey suite's
 * checker); a violation fails the test.
 */
import { test as base, expect } from '@playwright/test'
import { contractViolation } from '../api-e2e/contract'

export const test = base.extend<{ apiContract: void }>({
  apiContract: [
    async ({ page }, provide) => {
      const violations: string[] = []
      const pending: Promise<void>[] = []
      page.on('response', (res) => {
        const url = new URL(res.url())
        if (!url.pathname.startsWith('/api/')) return
        pending.push(
          (async () => {
            let body: unknown = null
            const type = res.headers()['content-type'] ?? ''
            if (type.includes('application/json')) {
              try {
                body = await res.json()
              } catch {
                return // navigated away before the body arrived
              }
            }
            const wrong = contractViolation(res.request().method(), url.pathname, res.status(), type, body)
            if (wrong) violations.push(wrong)
          })(),
        )
      })
      await provide()
      await Promise.all(pending)
      expect(violations, 'API answers that do not match docs/api/openapi.json').toEqual([])
    },
    { auto: true },
  ],
})

export { expect }
