/**
 * The Go pipeline for the evaluation harness (stage B6.9): each case runs
 * through `lookly eval` (apps/api/internal/evaluation), the server's own
 * AI pipeline, and the harness scores what comes back exactly as it scores
 * its TypeScript runners. Scoring and reports stay here.
 *
 * Two ways to reach a provider:
 *  - offline: a stand-in on 127.0.0.1 serves the harness's provider (a
 *    scripted or recorded one) in OpenAI's wire format; `lookly eval` is
 *    pointed at it with --base-url and reads no key.
 *  - live: `lookly eval` asks the real provider itself (its key from the
 *    environment, a --max-calls cap required: owner rule 4).
 *
 * The binary is LOOKLY_BINARY (build it: cd apps/api && go build -tags
 * nodynamic -o <path> ./cmd/lookly).
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import http from 'http'
import type { AddressInfo } from 'net'
import { createInterface } from 'readline'
import { errorKindOf, type ColorOutcome, type EvalResult, type LLMProvider, type LLMRequest, type Versions, type VisionImageMimeType, type VisionProvider } from './protocol'
import type { StylistCase } from './stylist-cases'
import type { OutfitCase } from './outfit-cases'

/** One result line of `lookly eval` for a stylist, outfit or vision case. */
export type GoResult = EvalResult<Record<string, unknown> & { kind: string }>

/** HTTP answers that the Go OpenAI adapter reads as each error kind. */
function failure(res: http.ServerResponse, err: unknown) {
  const kind = errorKindOf(err) ?? 'unexpected'
  const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers })
    res.end(JSON.stringify(body))
  }
  switch (kind) {
    case 'rate_limited':
      return send(429, { error: { message: 'rate limited' } }, { 'retry-after': '0' })
    case 'auth':
      return send(401, { error: { message: 'auth' } })
    case 'invalid_request':
      return send(400, { error: { message: 'invalid' } })
    case 'provider_error':
      return send(501, { error: { message: 'other' } })
    case 'content_filtered':
      return send(200, { choices: [{ finish_reason: 'content_filter', message: { content: null } }] })
    case 'malformed_response':
      return send(200, { unexpected: true })
    case 'network':
      return res.socket?.destroy()
    case 'timeout':
      // Never answered: the attempt's own time limit ends it.
      return
    default:
      // unavailable, and anything the provider threw that is no provider
      // error (the TypeScript runner records that as "unexpected").
      return send(503, { error: { message: 'unavailable' } })
  }
}

type OpenAIBody = {
  model: string
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string | Array<{ type: string; text?: string; image_url?: { url: string; detail?: string } }> }>
  temperature?: number
  max_completion_tokens?: number
  response_format?: { type: string; json_schema: { name: string; schema: Record<string, unknown> } }
}

/** The schema the pipeline asked for (without the wire format's own `strict` flag). */
function schemaOf(body: OpenAIBody) {
  const s = body.response_format?.json_schema
  return s ? { name: s.name, schema: s.schema } : undefined
}

/**
 * Serves `text` (and `vision`, for vision cases) on 127.0.0.1 in OpenAI's
 * chat-completions format. Every request is answered by the harness's own
 * provider, so a scripted or recorded run is the same run on either
 * pipeline.
 */
export async function serveStandIn(text: LLMProvider | null, vision: VisionProvider | null = null): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', async () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as OpenAIBody
        const image = body.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).find((p) => p.type === 'image_url')
        let content: string
        let usage: { inputTokens?: number; outputTokens?: number } = {}
        if (image) {
          if (!vision) throw new Error('no vision provider in this stand-in')
          const [, mime, data] = /^data:([^;]+);base64,(.*)$/.exec(image.image_url!.url) ?? []
          const instruction = body.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [{ type: 'text', text: m.content }])).find((p) => p.type === 'text')?.text ?? ''
          const result = await vision.analyzeImage({
            image: new Uint8Array(Buffer.from(data, 'base64')), mimeType: mime as VisionImageMimeType, maxSide: 0, instruction,
            jsonSchema: schemaOf(body), maxOutputTokens: body.max_completion_tokens, timeoutMs: 0,
            options: image.image_url!.detail ? { openaiDetail: image.image_url!.detail as 'low' | 'high' | 'auto' } : undefined,
          })
          content = JSON.stringify(result.output)
          usage = result.metadata.usage
        } else {
          if (!text) throw new Error('no text provider in this stand-in')
          const request: LLMRequest = {
            messages: body.messages.map((m) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : '' })),
            temperature: body.temperature, maxOutputTokens: body.max_completion_tokens, jsonSchema: schemaOf(body), timeoutMs: 0,
          }
          const result = await text.generate(request)
          content = result.text
          usage = result.metadata.usage
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          choices: [{ finish_reason: 'stop', message: { content } }],
          usage: { prompt_tokens: usage.inputTokens, completion_tokens: usage.outputTokens },
        }))
      } catch (err) {
        failure(res, err)
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections()
      server.close(() => resolve())
    }),
  }
}

export interface GoPipelineOptions {
  /** `lookly eval`'s flags: --provider, --model, and --base-url or --max-calls. */
  args: string[]
  /** LOOKLY_BINARY by default. */
  binary?: string
  /** The child's environment (the key of a live provider). */
  env?: NodeJS.ProcessEnv
}

/** A running `lookly eval`: send a case, get its result, in order. */
export class GoPipeline {
  private readonly child: ChildProcessWithoutNullStreams
  private readonly waiting: Array<{ resolve: (r: EvalResult) => void; reject: (e: Error) => void }> = []
  private stderr = ''
  /** Why the child is gone (it exited, or could not be started): every case after that is refused with it. */
  private ended: Error | null = null
  private readonly exited: Promise<void>

  constructor(options: GoPipelineOptions) {
    const binary = options.binary ?? process.env.LOOKLY_BINARY
    if (!binary) throw new Error('LOOKLY_BINARY is not set (the built `lookly` binary of apps/api)')
    this.child = spawn(binary, ['eval', ...options.args], { env: options.env ?? { PATH: process.env.PATH ?? '', NODE_ENV: 'production' }, stdio: ['pipe', 'pipe', 'pipe'] })
    this.child.stderr.on('data', (c: Buffer) => (this.stderr += c.toString()))
    createInterface({ input: this.child.stdout }).on('line', (line) => {
      const next = this.waiting.shift()
      if (!next) return
      let parsed: EvalResult | { refused: string }
      try {
        parsed = JSON.parse(line) as EvalResult | { refused: string }
      } catch {
        return next.reject(new Error(`lookly eval wrote a line that is not JSON: ${line.slice(0, 200)}`))
      }
      if ('refused' in parsed) next.reject(new Error(`lookly eval refused the case: ${parsed.refused}`))
      else next.resolve(parsed)
    })
    // A write to a child that is gone fails; the case is refused by end() with the reason.
    this.child.stdin.on('error', () => {})
    this.exited = new Promise((resolve) => {
      const end = (why: string) => {
        this.ended ??= new Error(`lookly eval ${why}${this.stderr.trim() ? `: ${this.stderr.trim()}` : ''}`)
        for (const w of this.waiting.splice(0)) w.reject(this.ended)
        resolve()
      }
      // 'close' comes after the output is read: the stderr text is whole.
      this.child.on('close', (code, signal) => end(signal ? `was stopped (${signal})` : `exited (${code})`))
      this.child.on('error', (err) => end(`could not be started (${err.message})`))
    })
  }

  /** A case; with `dryRun`, only its setup (no provider call). */
  run(feature: 'stylist' | 'outfit' | 'vision', c: unknown, options: { dryRun?: boolean } = {}): Promise<GoResult> {
    return this.send({ feature, case: c, ...(options.dryRun ? { dryRun: true } : {}) }) as Promise<GoResult>
  }

  /** The versions of the prompts, the engine and the analyses. */
  async versions(): Promise<Versions> {
    return (await this.send({ feature: 'versions' })).outcome as Versions
  }

  /** A selfie analysed as the colour profile does (no model). */
  color(image: Uint8Array): Promise<EvalResult<ColorOutcome>> {
    return this.send({ feature: 'color', case: { image: Buffer.from(image).toString('base64') } }) as Promise<EvalResult<ColorOutcome>>
  }

  private send(request: Record<string, unknown>): Promise<EvalResult> {
    if (this.ended) return Promise.reject(this.ended)
    return new Promise((resolve, reject) => {
      this.waiting.push({ resolve, reject })
      this.child.stdin.write(JSON.stringify(request) + '\n')
    })
  }

  /** Ends the run: the child reads the end of its input and exits. */
  async close(): Promise<void> {
    if (!this.ended) this.child.stdin.end()
    await this.exited
  }
}

/** A stylist case as `lookly eval` reads one. */
export function stylistRequest(c: StylistCase) {
  return {
    wardrobe: c.wardrobe, occasion: c.occasion ?? '', weather: c.weather ?? null, preferences: c.preferences ?? null,
    colorProfile: c.colorProfile ?? null, message: c.message, occasionText: c.occasionText ?? null,
  }
}

/** An outfit case as `lookly eval` reads one. */
export function outfitRequest(c: OutfitCase) {
  return { wardrobe: c.wardrobe, occasion: c.occasion ?? '', weather: c.weather ?? null, colorProfile: c.colorProfile ?? null, topN: c.topN ?? null }
}

/** A real provider's key from the environment; refused (before any call) when it is not set. */
export function requireProviderKey(provider: string): { variable: string; key: string } {
  const variable = provider === 'openai' ? 'OPENAI_API_KEY' : provider === 'gemini' ? 'GEMINI_API_KEY' : null
  if (!variable) throw new Error(`no such provider: ${provider} (gemini or openai)`)
  const key = process.env[variable]?.trim()
  if (!key) throw new Error(`${variable} is not set`)
  return { variable, key }
}

/** The TypeScript pipeline is gone (docs/plan/B7.md, B7.4e): every command-line run goes through `lookly eval`. */
export function refuseRemovedPipelineFlag(argv: readonly string[] = process.argv): void {
  if (argv.some((a) => a === '--pipeline' || a.startsWith('--pipeline='))) throw new Error('--pipeline is gone: every run goes through the Go server (lookly eval, LOOKLY_BINARY)')
}

/**
 * The Go pipeline of a command-line run: with the
 * scripted provider, through a stand-in; with a real one, `lookly eval`
 * asks it itself, given only that provider's key and a call cap.
 */
export async function openGoPipeline(options: { scripted?: LLMProvider; provider?: string; model?: string; maxCalls?: string }): Promise<{ go: GoPipeline; name: string; model: string; close: () => Promise<void> }> {
  if (options.scripted) {
    const standIn = await serveStandIn(options.scripted)
    const go = new GoPipeline({ args: ['--provider=openai', `--model=${options.scripted.model}`, `--base-url=${standIn.url}`] })
    return { go, name: options.scripted.name, model: options.scripted.model, close: async () => { await go.close(); await standIn.close() } }
  }
  const provider = (options.provider ?? '').trim().toLowerCase()
  if (provider !== 'openai' && provider !== 'gemini') throw new Error('--provider must be gemini, openai or scripted')
  const model = (options.model ?? '').trim()
  if (!model) throw new Error('--model is needed')
  if (!/^[1-9][0-9]*$/.test(options.maxCalls ?? '')) throw new Error('a live run on the Go pipeline needs --max-calls=N (paid calls: owner rule 4)')
  const { variable, key } = requireProviderKey(provider)
  const go = new GoPipeline({
    args: [`--provider=${provider}`, `--model=${model}`, `--max-calls=${options.maxCalls}`],
    env: { PATH: process.env.PATH ?? '', NODE_ENV: 'production', [variable]: key },
  })
  return { go, name: provider, model, close: () => go.close() }
}
