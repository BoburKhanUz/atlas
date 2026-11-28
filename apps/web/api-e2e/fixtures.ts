import { test as base, expect, type APIRequestContext } from '@playwright/test'
import { contractViolation } from './contract'

export interface Answer {
  status: number
  headers: Record<string, string>
  body: Record<string, unknown> & { code?: string }
  raw: Buffer
}

export interface CallOptions {
  data?: unknown
  multipart?: Record<string, string | { name: string; mimeType: string; buffer: Buffer }>
  headers?: Record<string, string>
  /** Mobile mode: the X-Atlas-Client header and this access token. */
  bearer?: string
  mobile?: boolean
}

/** Calls the API and records every answer that does not match the contract. */
export class Api {
  constructor(
    readonly request: APIRequestContext,
    private readonly violations: string[],
  ) {}

  async call(method: string, path: string, options: CallOptions = {}): Promise<Answer> {
    const headers: Record<string, string> = { ...options.headers }
    if (options.mobile || options.bearer) headers['X-Atlas-Client'] = 'mobile'
    if (options.bearer) headers.Authorization = `Bearer ${options.bearer}`
    const res = await this.request.fetch(path, { method, headers, data: options.data, multipart: options.multipart, maxRedirects: 0 })
    const raw = await res.body()
    const type = res.headers()['content-type'] ?? ''
    let body: Answer['body'] = {}
    if (type.includes('application/json') && raw.length > 0) body = JSON.parse(raw.toString('utf8'))
    const problem = contractViolation(method, new URL(res.url()).pathname, res.status(), type, type.includes('application/json') ? body : undefined)
    if (problem) this.violations.push(problem)
    return { status: res.status(), headers: res.headers(), body, raw }
  }

  get = (path: string, o?: CallOptions) => this.call('GET', path, o)
  post = (path: string, o?: CallOptions) => this.call('POST', path, o)
  patch = (path: string, o?: CallOptions) => this.call('PATCH', path, o)
  delete = (path: string, o?: CallOptions) => this.call('DELETE', path, o)
}

export const test = base.extend<{ api: Api }>({
  api: async ({ request }, provide) => {
    const violations: string[] = []
    await provide(new Api(request, violations))
    expect(violations, 'answers that do not match docs/api/openapi.json').toEqual([])
  },
})

export { expect }
