/**
 * Phase 4.1: real clothing vision through VisionService and the upload
 * route, with a scripted provider (no network, no paid API). Covers what
 * leaves the server, validation, quota charge/refund, the error contract,
 * cleanup and log content.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import sharp from 'sharp'
import { NextRequest } from 'next/server'

const db = vi.hoisted(() => ({ $transaction: vi.fn() }))
vi.mock('@/lib/db', () => ({ db }))
const quota = vi.hoisted(() => ({ consumeAiQuota: vi.fn(), refundAiQuota: vi.fn() }))
vi.mock('@/lib/ai/quota', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/ai/quota')>()), ...quota }))

import { POST as upload } from '@/app/api/v1/wardrobe/items/route'
import { CONFIDENCE_KEYS, UNCALIBRATED_MAX_CONFIDENCE } from '@/lib/ai/garment-analysis'
import { setVisionProviderForTesting } from '@/lib/ai/providers'
import { AiProviderError } from '@/lib/ai/providers/errors'
import { MockProvider } from '@/lib/ai/providers/mock'
import type { VisionProvider, VisionRequest } from '@/lib/ai/providers/types'
import { analyzeGarment, GarmentAnalysisError, isMockAnalysis } from '@/lib/ai/vision-service'
import { setStorageProviderForTesting } from '@/lib/storage/provider'
import { authHeader, TEST_USER } from '../helpers'

const SECRET_NAME = 'PRIVATE-FILENAME-futbolka'
const conf = (v: number) => Object.fromEntries(CONFIDENCE_KEYS.map((k) => [k, v]))
const garment = (extra: Record<string, unknown> = {}) => ({
  subject: 'single_garment', category: 'pants', subcategory: 'jeans', colors: ['blue'], pattern: 'denim', material: 'denim',
  sleeveLength: null, fit: 'slim', style: 'casual', season: ['spring', 'autumn'], gender: 'unisex', formality: 'casual',
  confidence: { ...conf(0.93), sleeveLength: 0 }, ...extra,
})
const nothing = (subject: string) => ({
  subject, category: null, subcategory: null, colors: [], pattern: null, material: null, sleeveLength: null, fit: null,
  style: null, season: [], gender: null, formality: null, confidence: conf(0),
})

class ScriptedVision implements VisionProvider {
  readonly name = 'gemini'
  readonly model = 'gemini-test-vision'
  requests: VisionRequest[] = []
  constructor(private readonly steps: Array<() => unknown>) {}
  async analyzeImage(req: VisionRequest) {
    this.requests.push(req)
    const step = this.steps[Math.min(this.requests.length - 1, this.steps.length - 1)]
    return { output: await step(), metadata: { provider: this.name, model: this.model, usage: { inputTokens: 1400, outputTokens: 120 } } }
  }
}
const fail = (kind: ConstructorParameters<typeof AiProviderError>[0]) => () => {
  throw new AiProviderError(kind, 'gemini')
}

/** A blue garment with EXIF orientation 6 and GPS, 1600×1200 before rotation. */
const photo = () =>
  sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#2F5DA8' } })
    .withMetadata({ orientation: 6 })
    .withExifMerge({ IFD0: { Make: 'LeakCam' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '41/1 18/1 0/1' } })
    .jpeg()
    .toBuffer()

let lines: string[] = []
beforeEach(() => {
  vi.clearAllMocks()
  quota.consumeAiQuota.mockResolvedValue({ allowed: true, used: 1, limit: 50 })
  quota.refundAiQuota.mockResolvedValue(undefined)
  lines = []
  const push = (chunk: unknown) => {
    lines.push(String(chunk))
    return true
  }
  vi.spyOn(process.stdout, 'write').mockImplementation(push as never)
  vi.spyOn(process.stderr, 'write').mockImplementation(push as never)
})
afterEach(() => {
  vi.restoreAllMocks()
  setVisionProviderForTesting(null)
})

const failureOf = async (p: Promise<unknown>) => ((await p.then(() => null, (e) => e)) as GarmentAnalysisError).failure

describe('VisionService with a real provider', () => {
  it('sends only the prepared image: upright, ≤ max side, JPEG, no metadata, no file name', async () => {
    const p = new ScriptedVision([() => garment()])
    setVisionProviderForTesting(p)
    await analyzeGarment({ buffer: await photo(), filename: SECRET_NAME, userId: 'u1' })
    const req = p.requests[0]
    expect(req.mimeType).toBe('image/jpeg')
    expect(req.maxSide).toBe(1024)
    const meta = await sharp(req.image).metadata()
    expect([meta.width, meta.height]).toEqual([768, 1024]) // rotated, fitted
    expect(meta.exif).toBeUndefined()
    expect(Buffer.from(req.image).includes(Buffer.from('LeakCam'))).toBe(false)
    expect(JSON.stringify({ ...req, image: undefined })).not.toContain(SECRET_NAME)
    expect(req.jsonSchema?.name).toBe('garment_analysis')
    expect(req.options).toEqual({ geminiMediaResolution: 'high', geminiThinkingLevel: 'low', openaiDetail: 'high' })
  })

  it('success: mock=false, presented confidence capped, raw confidence kept, metadata recorded, quota charged once', async () => {
    setVisionProviderForTesting(new ScriptedVision([() => garment()]))
    const at = new Date('2026-10-08T09:00:00Z')
    const { detection, metadata } = await analyzeGarment({ buffer: await photo(), filename: 'x.jpg', userId: 'u1' }, () => at)
    expect(detection).toMatchObject({ category: 'pants', subcategory: 'jeans', colors: ['blue'], mock: false })
    expect(detection.confidence.category).toBe(UNCALIBRATED_MAX_CONFIDENCE)
    expect(detection.confidence.color).toBe(UNCALIBRATED_MAX_CONFIDENCE) // blue supported by the pixels
    expect(metadata).toEqual({ provider: 'gemini', model: 'gemini-test-vision', version: 'v1', analyzedAt: at, rawConfidences: garment().confidence })
    expect(quota.consumeAiQuota).toHaveBeenCalledTimes(1)
    expect(quota.consumeAiQuota).toHaveBeenCalledWith('u1', 'clothing_analysis', at)
    expect(quota.refundAiQuota).not.toHaveBeenCalled()
  })

  it('a colour the pixels contradict keeps the colour but lowers its confidence', async () => {
    setVisionProviderForTesting(new ScriptedVision([() => garment({ colors: ['red'] })]))
    const { detection, metadata } = await analyzeGarment({ buffer: await photo(), filename: 'x.jpg', userId: 'u1' })
    expect(detection.colors).toEqual(['red'])
    expect(detection.confidence.color).toBeLessThan(0.4)
    expect(metadata.rawConfidences?.color).toBe(0.93)
  })

  it.each(['multiple_garments', 'no_garment', 'unclear'])('%s → NOT_A_GARMENT, quota charged (no refund)', async (subject) => {
    setVisionProviderForTesting(new ScriptedVision([() => nothing(subject)]))
    expect(await failureOf(analyzeGarment({ buffer: await photo(), filename: 'x.jpg', userId: 'u1' }))).toEqual({ kind: 'not_a_garment', subject })
    expect(quota.consumeAiQuota).toHaveBeenCalledTimes(1)
    expect(quota.refundAiQuota).not.toHaveBeenCalled()
  })

  it.each([
    ['malformed output', () => garment({ category: 'shoes', subcategory: 'jeans' })],
    ['unknown enum', () => garment({ pattern: 'camo' })],
    ['not an object', () => 'shirt'],
  ])('%s → AI_UNAVAILABLE, refunded, never retried', async (_name, step) => {
    const p = new ScriptedVision([step])
    setVisionProviderForTesting(p)
    expect(await failureOf(analyzeGarment({ buffer: await photo(), filename: 'x.jpg', userId: 'u1' }))).toEqual({ kind: 'ai_unavailable' })
    expect(p.requests).toHaveLength(1)
    expect(quota.refundAiQuota).toHaveBeenCalledTimes(1)
    expect(lines.join('\n')).toContain('ai.vision.invalid_output')
  })

  it.each(['timeout', 'unavailable', 'rate_limited', 'network'] as const)('transient %s twice → AI_UNAVAILABLE after exactly 2 attempts, refunded', async (kind) => {
    const p = new ScriptedVision([fail(kind)])
    setVisionProviderForTesting(p)
    expect(await failureOf(analyzeGarment({ buffer: await photo(), filename: 'x.jpg', userId: 'u1' }))).toEqual({ kind: 'ai_unavailable' })
    expect(p.requests).toHaveLength(2)
    expect(quota.refundAiQuota).toHaveBeenCalledTimes(1)
  })

  it.each(['auth', 'invalid_request', 'malformed_response', 'provider_error'] as const)('%s → AI_UNAVAILABLE, not retried, refunded', async (kind) => {
    const p = new ScriptedVision([fail(kind)])
    setVisionProviderForTesting(p)
    expect(await failureOf(analyzeGarment({ buffer: await photo(), filename: 'x.jpg', userId: 'u1' }))).toEqual({ kind: 'ai_unavailable' })
    expect(p.requests).toHaveLength(1)
    expect(quota.refundAiQuota).toHaveBeenCalledTimes(1)
  })

  it('the refund goes to the day that was charged, even when the call crosses Tashkent midnight', async () => {
    setVisionProviderForTesting(new ScriptedVision([fail('auth')]))
    const times = [new Date('2026-10-08T18:59:59Z'), new Date('2026-10-08T19:00:01Z')] // 23:59:59 → 00:00:01 in Tashkent
    let i = 0
    await failureOf(analyzeGarment({ buffer: await photo(), filename: 'x.jpg', userId: 'u1' }, () => times[Math.min(i++, 1)]))
    expect(quota.consumeAiQuota).toHaveBeenCalledWith('u1', 'clothing_analysis', times[0])
    expect(quota.refundAiQuota).toHaveBeenCalledWith('u1', 'clothing_analysis', times[0])
  })

  it('a safety refusal → image rejected, charged', async () => {
    setVisionProviderForTesting(new ScriptedVision([fail('content_filtered')]))
    expect(await failureOf(analyzeGarment({ buffer: await photo(), filename: 'x.jpg', userId: 'u1' }))).toEqual({ kind: 'image_rejected' })
    expect(quota.refundAiQuota).not.toHaveBeenCalled()
  })

  it('quota exhausted → no provider call, Retry-After to the next Tashkent midnight', async () => {
    quota.consumeAiQuota.mockResolvedValue({ allowed: false, used: 50, limit: 50 })
    const p = new ScriptedVision([() => garment()])
    setVisionProviderForTesting(p)
    const at = new Date('2026-10-08T18:00:00Z') // 23:00 in Tashkent
    expect(await failureOf(analyzeGarment({ buffer: await photo(), filename: 'x.jpg', userId: 'u1' }, () => at))).toEqual({ kind: 'quota_exceeded', retryAfterSeconds: 3600 })
    expect(p.requests).toHaveLength(0)
  })

  it('an image that cannot be prepared is rejected before any quota is used', async () => {
    setVisionProviderForTesting(new ScriptedVision([() => garment()]))
    expect(await failureOf(analyzeGarment({ buffer: Buffer.from('not an image'), filename: 'x.jpg', userId: 'u1' }))).toEqual({ kind: 'image_rejected' })
    expect(quota.consumeAiQuota).not.toHaveBeenCalled()
  })

  it('the mock never touches the quota', async () => {
    setVisionProviderForTesting(new MockProvider())
    const { detection } = await analyzeGarment({ buffer: await photo(), filename: 'blue-jeans.jpg', userId: 'u1' })
    expect(detection.mock).toBe(true)
    expect(quota.consumeAiQuota).not.toHaveBeenCalled()
  })

  it('logs carry no image bytes, file name, prompt or model values', async () => {
    setVisionProviderForTesting(new ScriptedVision([() => garment({ colors: ['red'] })]))
    const buffer = await photo()
    await analyzeGarment({ buffer, filename: SECRET_NAME, userId: 'u1' })
    const all = lines.join('\n')
    expect(all).toContain('"msg":"ai.call"')
    expect(all).toContain('"colorVerdict"')
    for (const secret of [SECRET_NAME, 'clothing attribute classifier', buffer.subarray(0, 24).toString('base64'), '"denim"', 'jeans']) {
      expect(all).not.toContain(secret)
    }
  })
})

// ─── Route: status codes, headers, cleanup ──────────────────────────────────

async function multipartRequest(form: FormData, headers: Record<string, string>) {
  const res = new Response(form)
  const body = new Uint8Array(await res.arrayBuffer())
  return new NextRequest('http://localhost/api/v1/wardrobe/items', {
    method: 'POST',
    headers: { ...headers, 'content-type': res.headers.get('content-type')!, 'content-length': String(body.length) },
    body,
  })
}

describe('POST /api/v1/wardrobe/items with a real provider', () => {
  let dir: string
  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-vision-'))
    process.env.STORAGE_LOCAL_DIR = dir
    setStorageProviderForTesting(null)
  })
  afterAll(async () => {
    setStorageProviderForTesting(null)
    await fs.rm(dir, { recursive: true, force: true })
  })

  const userFiles = async () => fs.readdir(path.join(dir, 'users', TEST_USER.sub)).catch(() => [] as string[])
  const send = async () => {
    const form = new FormData()
    form.append('file', new File([new Uint8Array(await photo())], `${SECRET_NAME}.jpg`, { type: 'image/jpeg' }))
    return upload(await multipartRequest(form, await authHeader()), undefined)
  }

  it('success: 201, mock=false, metadata and raw confidences persisted', async () => {
    setVisionProviderForTesting(new ScriptedVision([() => garment()]))
    let data: Record<string, unknown> = {}
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        wardrobeItem: {
          create: vi.fn(async (args: { data: Record<string, unknown> }) => {
            data = args.data
            const { images: _images, ...row } = args.data
            return { id: 'item1', ...row, images: [], createdAt: new Date(), updatedAt: new Date() }
          }),
        },
      }),
    )
    const res = await send()
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.detection.mock).toBe(false)
    expect(body.detection.category).toBe('pants')
    expect(body.item.confidences.category).toBe(UNCALIBRATED_MAX_CONFIDENCE)
    expect(body.item).not.toHaveProperty('analysisRawConfidences')
    expect(data).toMatchObject({ analysisProvider: 'gemini', analysisModel: 'gemini-test-vision', analysisVersion: 'v1' })
    expect(JSON.parse(data.analysisRawConfidences as string).category).toBe(0.93)
    expect(data.analyzedAt).toBeInstanceOf(Date)
  })

  it.each([
    ['AI_UNAVAILABLE', 503, [fail('unavailable')], '15'],
    ['NOT_A_GARMENT', 422, [() => nothing('multiple_garments')], null],
    ['INVALID_IMAGE', 422, [fail('content_filtered')], null],
  ] as const)('%s → %i, nothing stored, files removed', async (code, status, steps, retryAfter) => {
    setVisionProviderForTesting(new ScriptedVision([...steps]))
    const before = await userFiles()
    const res = await send()
    expect(res.status).toBe(status)
    const body = await res.json()
    expect(body.code).toBe(code)
    expect(res.headers.get('retry-after')).toBe(retryAfter)
    expect(db.$transaction).not.toHaveBeenCalled()
    expect(await userFiles()).toEqual(before)
    expect(JSON.stringify(body)).not.toMatch(/gemini|provider|HTTP/i) // no provider details
    if (code === 'NOT_A_GARMENT') expect(body.details).toEqual([{ path: 'subject', message: 'multiple_garments' }])
  })

  it('AI_QUOTA_EXCEEDED → 429 with Retry-After, provider not called, files removed', async () => {
    quota.consumeAiQuota.mockResolvedValue({ allowed: false, used: 50, limit: 50 })
    const p = new ScriptedVision([() => garment()])
    setVisionProviderForTesting(p)
    const before = await userFiles()
    const res = await send()
    expect(res.status).toBe(429)
    expect((await res.json()).code).toBe('AI_QUOTA_EXCEEDED')
    const wait = Number(res.headers.get('retry-after'))
    expect(wait).toBeGreaterThan(0)
    expect(wait).toBeLessThanOrEqual(86_400)
    expect(p.requests).toHaveLength(0)
    expect(await userFiles()).toEqual(before)
  })
})

describe('detection.mock derivation', () => {
  it('is true only for the mock and for rows written before analysis metadata existed', () => {
    expect(isMockAnalysis('mock')).toBe(true)
    expect(isMockAnalysis(null)).toBe(true)
    expect(isMockAnalysis('gemini')).toBe(false)
    expect(isMockAnalysis('openai')).toBe(false)
  })
})
