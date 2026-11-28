/**
 * Browser-side calls to the Go API on the same origin: `/api/*` is the Go
 * server's (behind Caddy in the deployment, B7.7; behind e2e/go-front.mjs in the
 * browser suite). The web app keeps no session: its only call is the password
 * reset an e-mailed link opens, a POST.
 *
 * Errors are thrown as ApiError with the server's Uzbek `error` message and
 * machine-readable `code` (the envelope { error, code, details?, requestId? }).
 */

import { createTranslator } from 'next-intl'
import uzMessages from '../../messages/uz.json'

// Fallback strings come from the message catalogue (errors namespace). The
// client runs outside React here, so we build a translator directly.
const tErrors = createTranslator({ locale: 'uz', messages: uzMessages, namespace: 'errors' })

export class ApiError extends Error {
  code: string
  constructor(message: string, code: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function toApiError(res: Response, data: unknown): ApiError {
  const obj = data && typeof data === 'object' ? (data as Record<string, unknown>) : null
  const message = (obj && typeof obj.error === 'string' && obj.error) || tErrors('request', { status: res.status })
  const code = (obj && typeof obj.code === 'string' && obj.code) || `HTTP_${res.status}`
  return new ApiError(message, code)
}

/** POSTs `body` as JSON to `path`; the answer's JSON, or an ApiError. */
export async function postJson<T = unknown>(path: string, body: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  } catch {
    throw new ApiError(tErrors('network'), 'NETWORK_ERROR')
  }
  const data = await parseBody(res)
  if (!res.ok) throw toApiError(res, data)
  return data as T
}
