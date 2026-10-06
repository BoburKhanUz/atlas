/** A scripted `fetch` for adapter tests: records requests, never touches the network. */
import type { FetchLike } from '@/lib/ai/providers/http'

export interface Recorded {
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
}

export type Reply =
  | { status: number; json?: unknown; text?: string; headers?: Record<string, string> }
  | { throw: Error }
  | { hang: true }

export function fakeFetch(replies: Reply[]): { fetch: FetchLike; calls: Recorded[] } {
  const calls: Recorded[] = []
  let i = 0
  const fetch: FetchLike = async (url, init) => {
    calls.push({
      url,
      headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])),
      body: JSON.parse(String(init.body)),
    })
    const reply = replies[Math.min(i++, replies.length - 1)]
    if ('throw' in reply) throw reply.throw
    if ('hang' in reply) {
      return new Promise<Response>((_, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    }
    const body = reply.text ?? JSON.stringify(reply.json ?? {})
    return new Response(body, { status: reply.status, headers: { 'content-type': 'application/json', ...(reply.headers ?? {}) } })
  }
  return { fetch, calls }
}
