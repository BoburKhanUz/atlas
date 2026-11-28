/**
 * Browser-side calls to the Go API on the same origin (`/api/*` reaches the Go
 * server through Caddy, deploy/Caddyfile). The web app keeps no session: its
 * only call is the password reset an e-mailed link opens.
 *
 * Errors are thrown as ApiError with the server's Uzbek `error` message and
 * machine-readable `code` ({ error, code, details?, requestId? }).
 */

import { createTranslator } from 'next-intl'
import uzMessages from '../../messages/uz.json'

// Fallback strings come from the message catalogue (errors namespace). The
// client runs outside React here, so we build a translator directly.
const tErrors = createTranslator({ locale: 'uz', messages: uzMessages, namespace: 'errors' })

export class ApiError extends Error {
  status: number
  code: string
  details?: unknown
  requestId?: string
  constructor(message: string, status: number, code = 'UNKNOWN', extra: { details?: unknown; requestId?: string } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = extra.details
    this.requestId = extra.requestId
  }
}

interface FetchOpts {
  method?: 'GET' | 'POST'
  body?: unknown
  signal?: AbortSignal
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
  return new ApiError(message, res.status, code, { details: obj?.details, requestId: typeof obj?.requestId === 'string' ? obj.requestId : undefined })
}

export async function api<T = unknown>(path: string, opts: FetchOpts = {}): Promise<T> {
  const init: RequestInit = { method: opts.method ?? 'GET', credentials: 'omit', signal: opts.signal }
  if (opts.body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(opts.body)
  }
  let res: Response
  try {
    res = await fetch(path, init)
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new ApiError(tErrors('network'), 0, 'NETWORK_ERROR')
  }
  const data = await parseBody(res)
  if (!res.ok) throw toApiError(res, data)
  return data as T
}
