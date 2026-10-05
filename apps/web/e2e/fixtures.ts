/**
 * Shared Playwright fixtures. OAS-05: every /api response the browser receives
 * during the UI tests is checked against the OpenAPI contract (the same Zod
 * schemas the document is generated from): a documented success status must
 * match its schema, anything else must be an ErrorResponse with a code
 * documented for that operation. Violations fail the test.
 */
import { test as base, expect } from '@playwright/test'
import { errorStatus } from '../src/server/http'
import { errorCodesFor } from '../src/server/openapi/document'
import { OPERATIONS, type Operation } from '../src/server/openapi/registry'
import { ErrorResponse } from '../src/server/schemas/responses'

const ROUTES = OPERATIONS.map((op) => ({
  op,
  re: new RegExp('^' + op.path.replace(/\{key\}/g, '.+').replace(/\{\w+\}/g, '[^/]+') + '$'),
}))

function operationFor(method: string, pathname: string): Operation | undefined {
  return ROUTES.find((r) => r.op.method === method && r.re.test(pathname))?.op
}

export const test = base.extend<{ apiContract: void }>({
  apiContract: [
    async ({ page }, use) => {
      const violations: string[] = []
      const pending: Promise<void>[] = []
      page.on('response', (res) => {
        const url = new URL(res.url())
        if (!url.pathname.startsWith('/api/')) return
        const method = res.request().method()
        const op = operationFor(method, url.pathname)
        if (!op) return void violations.push(`${method} ${url.pathname}: not in the OpenAPI registry`)
        pending.push(
          (async () => {
            const status = res.status()
            const success = op.success.find((s) => s.status === status)
            if (success && !success.schema) return // binary (media, the document itself)
            let body: unknown
            try {
              body = await res.json()
            } catch {
              return // navigated away before the body arrived
            }
            if (success?.schema) {
              const parsed = success.schema.safeParse(body)
              if (!parsed.success) violations.push(`${method} ${url.pathname} ${status}: ${JSON.stringify(parsed.error.issues.slice(0, 2))}`)
              return
            }
            const err = ErrorResponse.safeParse(body)
            if (!err.success) return void violations.push(`${method} ${url.pathname} ${status}: not an ErrorResponse`)
            if (!errorCodesFor(op).includes(err.data.code) || errorStatus(err.data.code) !== status) {
              violations.push(`${method} ${url.pathname} ${status}: undocumented error code ${err.data.code}`)
            }
          })(),
        )
      })
      await use()
      await Promise.all(pending)
      expect(violations, 'API responses that do not match docs/api/openapi.json').toEqual([])
    },
    { auto: true },
  ],
})

export { expect }
