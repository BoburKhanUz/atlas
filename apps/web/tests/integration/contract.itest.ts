/**
 * OAS-04: every operation in the OpenAPI registry is called through its real
 * route handler against PostgreSQL. Each response must match the documented
 * schema (strictly: undocumented fields fail) or be an ErrorResponse whose code
 * is documented for that operation under its real status. The last test
 * checks coverage: every operation's success response and every
 * operation-specific error code was produced at least once.
 */
import crypto from 'crypto'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import sharp from 'sharp'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { POST as register } from '@/app/api/v1/auth/register/route'
import { POST as login } from '@/app/api/v1/auth/login/route'
import { POST as refresh } from '@/app/api/v1/auth/refresh/route'
import { POST as logout } from '@/app/api/v1/auth/logout/route'
import { GET as me } from '@/app/api/v1/auth/me/route'
import { DELETE as deleteAccount } from '@/app/api/v1/account/route'
import * as profileRoute from '@/app/api/v1/profile/route'
import { GET as getColorProfile } from '@/app/api/v1/color-profile/route'
import { POST as analyzeColor } from '@/app/api/v1/color-profile/analyze/route'
import * as wardrobeRoute from '@/app/api/v1/wardrobe/items/route'
import * as wardrobeItemRoute from '@/app/api/v1/wardrobe/items/[id]/route'
import { GET as media } from '@/app/api/v1/media/[...key]/route'
import { POST as generate } from '@/app/api/v1/outfits/generate/route'
import * as outfitsRoute from '@/app/api/v1/outfits/route'
import * as outfitRoute from '@/app/api/v1/outfits/[id]/route'
import { POST as feedback } from '@/app/api/v1/outfits/[id]/feedback/route'
import { POST as chat } from '@/app/api/v1/stylist/chat/route'
import { GET as conversations } from '@/app/api/v1/stylist/conversations/route'
import { GET as conversation } from '@/app/api/v1/stylist/conversations/[id]/route'
import { GET as weather } from '@/app/api/v1/weather/current/route'
import { GET as health } from '@/app/api/health/route'
import { GET as openapi } from '@/app/api/v1/openapi.json/route'
import { hashToken, signAccessToken } from '@/lib/auth'
import { setLLMProviderForTesting, setVisionProviderForTesting } from '@/lib/ai/providers'
import { AiProviderError } from '@/lib/ai/providers/errors'
import { CONFIDENCE_KEYS } from '@/lib/ai/garment-analysis'
import { MockProvider } from '@/lib/ai/providers/mock'
import { resetRateLimits } from '@/lib/rate-limit'
import { setStorageProviderForTesting } from '@/lib/storage/provider'
import { setWeatherProviderForTesting } from '@/lib/weather/provider'
import { errorStatus } from '@/server/http'
import { claimIdempotencyKey, multipartRequestHash } from '@/server/idempotency'
import { errorCodesFor, serializeOpenApiDocument } from '@/server/openapi/document'
import { OPERATIONS, type Operation } from '@/server/openapi/registry'
import { ErrorResponse } from '@/server/schemas/responses'
import { APP_DB, enabled, psqlSession, setClock, sql, waitFor } from './pg'

const DB = APP_DB
const byId = new Map(OPERATIONS.map((o) => [o.operationId, o]))
const covered = new Map<string, Set<string>>()
const PASSWORD = 'contract-password-1'
let seq = 0

type Handler = (req: NextRequest, ctx: never) => Promise<Response> | Response

/** Call a handler and check its response against the operation's contract. */
async function call(operationId: string, handler: Handler, req: NextRequest, ctx: unknown = undefined) {
  const op = byId.get(operationId)
  if (!op) throw new Error(`unknown operation ${operationId}`)
  const res = await handler(req, ctx as never)
  const text = await res.clone().text()
  const success = op.success.find((s) => s.status === res.status)
  const mark = (k: string) => (covered.get(operationId) ?? covered.set(operationId, new Set()).get(operationId)!).add(k)
  if (success) {
    mark(`success:${res.status}`)
    if (success.schema) {
      const parsed = success.schema.safeParse(JSON.parse(text))
      expect(parsed.success, `${operationId} ${res.status} body does not match its schema: ${JSON.stringify(parsed.error?.issues.slice(0, 3))}`).toBe(true)
    } else {
      expect(success.binary?.some((t) => (res.headers.get('content-type') ?? '').startsWith(t)), `${operationId} content-type`).toBe(true)
    }
  } else {
    const body = ErrorResponse.safeParse(JSON.parse(text))
    expect(body.success, `${operationId} ${res.status}: not an ErrorResponse: ${text.slice(0, 200)}`).toBe(true)
    const code = body.data!.code
    expect(errorCodesFor(op), `${operationId}: undocumented error code ${code}`).toContain(code)
    expect(res.status, `${operationId}: ${code} under the wrong status`).toBe(errorStatus(code))
    mark(`code:${code}`)
  }
  return res
}

function req(
  url: string,
  { method = 'GET', headers = {}, json, body }: { method?: string; headers?: Record<string, string>; json?: unknown; body?: BodyInit } = {},
) {
  const h: Record<string, string> = { host: 'localhost', ...headers }
  let payload: BodyInit | undefined = body
  if (json !== undefined) {
    payload = JSON.stringify(json)
    h['content-type'] = 'application/json'
  }
  return new NextRequest(`http://localhost${url}`, { method, headers: h, ...(payload !== undefined ? { body: payload } : {}) })
}

async function multipart(url: string, file: Buffer | null, opts: { name?: string; type?: string; headers?: Record<string, string>; fields?: Record<string, string> } = {}) {
  const form = new FormData()
  if (file) form.append('file', new File([new Uint8Array(file)], opts.name ?? 'shirt.jpg', { type: opts.type ?? 'image/jpeg' }))
  for (const [k, v] of Object.entries(opts.fields ?? {})) form.append(k, v)
  const encoded = new Response(form)
  const body = Buffer.from(await encoded.arrayBuffer())
  return new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    headers: { host: 'localhost', 'content-type': encoded.headers.get('content-type')!, 'content-length': String(body.length), ...(opts.headers ?? {}) },
    body,
  })
}

const image = (w: number, h: number, color = '#0F766E') => sharp({ create: { width: w, height: h, channels: 3, background: color } }).jpeg().toBuffer()
const params = <T extends Record<string, string | string[]>>(p: T) => ({ params: Promise.resolve(p) })
const MOBILE = { 'x-atlas-client': 'mobile' }

async function mobileAccount() {
  const email = `contract_${process.pid}_${++seq}@test.local`
  const res = await call('register', register as Handler, req('/api/v1/auth/register', { method: 'POST', headers: MOBILE, json: { email, password: PASSWORD, deviceName: 'Test phone' } }))
  expect(res.status).toBe(201)
  const t = await res.json()
  return { email, userId: t.user.id as string, refreshToken: t.refreshToken as string, auth: { authorization: `Bearer ${t.accessToken}` } }
}

describe.skipIf(!enabled)('OAS-04: real responses match the OpenAPI contract', () => {
  let dir: string
  beforeAll(async () => {
    setClock(DB, null)
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-contract-'))
    process.env.STORAGE_LOCAL_DIR = dir
    setStorageProviderForTesting(null)
    setWeatherProviderForTesting({
      name: 'contract-mock',
      getCurrent: async () => ({
        temperature: 21, feelsLike: 20, condition: 'clear', conditionLabel: 'Ochiq osmon', precipitationProbability: 5,
        precipitationAmount: 0, humidity: 40, windSpeed: 8, uvIndex: 4, source: 'mock', fetchedAt: new Date().toISOString(),
      }),
    })
    setLLMProviderForTesting(new MockProvider({ respond: () => 'Test javobi.' }))
    resetRateLimits()
  })
  afterAll(async () => {
    setStorageProviderForTesting(null)
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('auth: register/login/refresh/logout/me in both modes and every session error code', async () => {
    // web register + login (cookies) and their errors
    const webEmail = `contract_web_${process.pid}@test.local`
    const wr = await call('register', register as Handler, req('/api/v1/auth/register', { method: 'POST', json: { email: webEmail, password: PASSWORD } }))
    expect(wr.status).toBe(201)
    await call('register', register as Handler, req('/api/v1/auth/register', { method: 'POST', json: { email: webEmail, password: PASSWORD } })) // CONFLICT
    await call('register', register as Handler, req('/api/v1/auth/register', { method: 'POST', json: { email: 'bad', password: 'x' } })) // VALIDATION_ERROR
    await call('register', register as Handler, req('/api/v1/auth/register', { method: 'POST', body: '{', headers: { 'content-type': 'application/json' } })) // BAD_REQUEST
    const wl = await call('login', login as Handler, req('/api/v1/auth/login', { method: 'POST', json: { email: webEmail, password: PASSWORD } }))
    expect(wl.status).toBe(200)
    const webRt = wl.headers.getSetCookie().find((c) => c.startsWith('atlas_rt='))!.split(';')[0].slice('atlas_rt='.length)
    const webAt = wl.headers.getSetCookie().find((c) => c.startsWith('atlas_at='))!.split(';')[0].slice('atlas_at='.length)
    await call('login', login as Handler, req('/api/v1/auth/login', { method: 'POST', json: { email: webEmail, password: 'wrong-password' } })) // UNAUTHORIZED
    for (let i = 0; i < 10; i++) await login(req('/api/v1/auth/login', { method: 'POST', json: { email: 'flood@test.local', password: 'x' } }))
    await call('login', login as Handler, req('/api/v1/auth/login', { method: 'POST', json: { email: 'flood@test.local', password: 'x' } })) // RATE_LIMITED
    await call('getMe', me as Handler, req('/api/v1/auth/me', { headers: { cookie: `atlas_at=${webAt}` } }))

    // web refresh, race, reuse, mismatch
    const r1 = await call('refreshSession', refresh as Handler, req('/api/v1/auth/refresh', { method: 'POST', headers: { cookie: `atlas_rt=${webRt}` } }))
    expect(r1.status).toBe(200)
    sql(DB, `UPDATE "Session" SET "successorTokenEnc" = NULL WHERE "tokenHash" = '${hashToken(webRt)}'`)
    await call('refreshSession', refresh as Handler, req('/api/v1/auth/refresh', { method: 'POST', headers: { cookie: `atlas_rt=${webRt}` } })) // SESSION_RACE
    await call('refreshSession', refresh as Handler, req('/api/v1/auth/refresh', { method: 'POST', headers: MOBILE, json: { refreshToken: webRt } })) // CLIENT_MISMATCH
    sql(DB, `UPDATE "Session" SET "rotatedAt" = "rotatedAt" - interval '2 minutes' WHERE "tokenHash" = '${hashToken(webRt)}'`)
    await call('refreshSession', refresh as Handler, req('/api/v1/auth/refresh', { method: 'POST', headers: { cookie: `atlas_rt=${webRt}` } })) // REFRESH_REUSED
    await call('refreshSession', refresh as Handler, req('/api/v1/auth/refresh', { method: 'POST', headers: { cookie: `atlas_rt=${webRt}` } })) // SESSION_REVOKED
    await call('refreshSession', refresh as Handler, req('/api/v1/auth/refresh', { method: 'POST', headers: { cookie: 'atlas_rt=unknown-token' } })) // INVALID_TOKEN
    await call('refreshSession', refresh as Handler, req('/api/v1/auth/refresh', { method: 'POST', headers: MOBILE, json: {} })) // VALIDATION_ERROR

    // mobile: refresh + expiry + busy, logout + busy
    const m = await mobileAccount()
    const mr = await call('refreshSession', refresh as Handler, req('/api/v1/auth/refresh', { method: 'POST', headers: MOBILE, json: { refreshToken: m.refreshToken } }))
    const next = (await mr.json()).refreshToken as string
    const fam = sql(DB, `SELECT "familyId" FROM "Session" WHERE "tokenHash" = '${hashToken(next)}'`)
    const holder = psqlSession(DB, 'contract_lock')
    holder.send(`BEGIN; SELECT 1 FROM "SessionFamily" WHERE "id" = '${fam}' FOR UPDATE; SELECT 'locked';`)
    await waitFor(() => holder.output().includes('locked'), 'lock')
    await call('refreshSession', refresh as Handler, req('/api/v1/auth/refresh', { method: 'POST', headers: MOBILE, json: { refreshToken: next } })) // SESSION_BUSY
    await call('logout', logout as Handler, req('/api/v1/auth/logout', { method: 'POST', headers: MOBILE, json: { refreshToken: next } })) // SESSION_BUSY
    holder.send('COMMIT;')
    holder.end()
    await holder.done
    await call('logout', logout as Handler, req('/api/v1/auth/logout', { method: 'POST', headers: MOBILE, json: { refreshToken: next } }))
    const e = await mobileAccount()
    sql(DB, `UPDATE "Session" SET "expiresAt" = (now() AT TIME ZONE 'UTC') - interval '1 second' WHERE "tokenHash" = '${hashToken(e.refreshToken)}'`)
    await call('refreshSession', refresh as Handler, req('/api/v1/auth/refresh', { method: 'POST', headers: MOBILE, json: { refreshToken: e.refreshToken } })) // SESSION_EXPIRED
    await call('logout', logout as Handler, req('/api/v1/auth/logout', { method: 'POST', headers: { cookie: `atlas_at=${webAt}` } })) // web, idempotent

    // register rate limit (global, counted before validation)
    resetRateLimits()
    for (let i = 0; i < 100; i++) await register(req('/api/v1/auth/register', { method: 'POST', json: {} }))
    await call('register', register as Handler, req('/api/v1/auth/register', { method: 'POST', json: {} })) // RATE_LIMITED
    resetRateLimits()
  }, 120_000)

  it('account, profile, colour profile', async () => {
    const u = await mobileAccount()
    const ghost = { authorization: `Bearer ${await signAccessToken({ sub: 'no_such_user', email: 'ghost@test.local' })}` }
    await call('getMe', me as Handler, req('/api/v1/auth/me', { headers: ghost })) // NOT_FOUND
    await call('getMe', me as Handler, req('/api/v1/auth/me')) // UNAUTHORIZED
    await call('getProfile', profileRoute.GET as Handler, req('/api/v1/profile', { headers: u.auth }))
    await call('getProfile', profileRoute.GET as Handler, req('/api/v1/profile', { headers: ghost })) // NOT_FOUND
    await call('updateProfile', profileRoute.PATCH as Handler, req('/api/v1/profile', { method: 'PATCH', headers: u.auth, json: { name: 'Ali', profile: { gender: 'male', height: 180 }, preferences: { favoriteColors: ['navy'], language: 'uz' } } }))
    await call('updateProfile', profileRoute.PATCH as Handler, req('/api/v1/profile', { method: 'PATCH', headers: u.auth, json: { profile: { height: 10 } } })) // VALIDATION_ERROR
    await call('getProfile', profileRoute.GET as Handler, req('/api/v1/profile', { headers: u.auth }))

    await call('getColorProfile', getColorProfile as Handler, req('/api/v1/color-profile', { headers: u.auth })) // not_analyzed
    const selfie = await sharp({ create: { width: 400, height: 400, channels: 3, background: '#E0AC69' } }).jpeg().toBuffer()
    const an = await call('analyzeColorProfile', analyzeColor as Handler, await multipart('/api/v1/color-profile/analyze', selfie, { headers: u.auth, name: 'me.jpg' }))
    expect(an.status).toBe(200)
    await call('getColorProfile', getColorProfile as Handler, req('/api/v1/color-profile', { headers: u.auth })) // analyzed
    await call('analyzeColorProfile', analyzeColor as Handler, await multipart('/api/v1/color-profile/analyze', null, { headers: u.auth, fields: { x: '1' } })) // BAD_REQUEST
    await call('analyzeColorProfile', analyzeColor as Handler, await multipart('/api/v1/color-profile/analyze', selfie, { headers: u.auth, type: 'text/plain' })) // INVALID_IMAGE

    await call('deleteAccount', deleteAccount as Handler, req('/api/v1/account', { method: 'DELETE', headers: ghost })) // NOT_FOUND
    const gone = await mobileAccount()
    await call('deleteAccount', deleteAccount as Handler, req('/api/v1/account', { method: 'DELETE', headers: gone.auth }))
  })

  it('wardrobe, media, outfits, stylist, weather, service', async () => {
    const u = await mobileAccount()
    const other = await mobileAccount()
    const W = '/api/v1/wardrobe/items'
    const up = (file: Buffer | null, opts: Parameters<typeof multipart>[2] = {}) =>
      multipart(W, file, { ...opts, headers: { ...u.auth, ...(opts.headers ?? {}) } }).then((r) => call('createWardrobeItem', wardrobeRoute.POST as Handler, r))

    const ids: string[] = []
    for (const [name, color] of [['white-shirt.jpg', '#f5f5f5'], ['blue-jeans.jpg', '#284696'], ['white-sneaker.jpg', '#f0f0f0']]) {
      const r = await up(await image(600, 800, color), { name })
      expect(r.status).toBe(201)
      ids.push((await r.json()).item.id)
    }
    const k = `contract-${crypto.randomBytes(6).toString('hex')}`
    const first = await up(await image(500, 500), { headers: { 'idempotency-key': k } })
    await up(await image(500, 500), { headers: { 'idempotency-key': k } }) // replay (201)
    await up(await image(500, 500, '#ff0000'), { headers: { 'idempotency-key': k } }) // IDEMPOTENCY_KEY_MISMATCH
    const busyKey = `contract-busy-${crypto.randomBytes(6).toString('hex')}`
    const busyFile = await image(300, 300)
    await claimIdempotencyKey((await import('@/lib/db')).db, { userId: u.userId, route: 'POST /api/v1/wardrobe/items', key: busyKey, requestHash: multipartRequestHash({ fileBytes: busyFile, filename: 'shirt.jpg', fields: {} }) })
    await up(busyFile, { headers: { 'idempotency-key': busyKey } }) // IDEMPOTENCY_IN_PROGRESS
    const firstId = (await first.json()).item.id
    await call('deleteWardrobeItem', wardrobeItemRoute.DELETE as Handler, req(`${W}/${firstId}`, { method: 'DELETE', headers: u.auth }), params({ id: firstId }))
    await up(await image(500, 500), { headers: { 'idempotency-key': k } }) // NOT_FOUND (original item deleted)
    await up(await image(500, 500), { headers: { 'idempotency-key': 'bad key' } }) // VALIDATION_ERROR
    await up(null, { fields: { note: 'x' } }) // BAD_REQUEST
    await up(await image(500, 500), { type: 'image/heic' }) // UNSUPPORTED_IMAGE_FORMAT
    await up(await image(100, 100)) // IMAGE_DIMENSIONS
    await up(crypto.randomBytes(3000)) // INVALID_IMAGE
    await up(Buffer.concat([await image(300, 300), crypto.randomBytes(8 * 1024 * 1024 + 10)])) // PAYLOAD_TOO_LARGE
    await call('createWardrobeItem', wardrobeRoute.POST as Handler, req(W, { method: 'POST', headers: { ...u.auth, 'content-length': '2' }, json: {} })) // UNSUPPORTED_MEDIA_TYPE

    // Real-provider path (scripted provider, no network): success with mock=false, then each AI error.
    const zero = Object.fromEntries(CONFIDENCE_KEYS.map((key) => [key, 0]))
    const scripted = (step: () => unknown) =>
      setVisionProviderForTesting({ name: 'gemini', model: 'contract-vision', analyzeImage: async () => ({ output: step(), metadata: { provider: 'gemini', model: 'contract-vision', usage: {} } }) })
    try {
      scripted(() => ({ subject: 'single_garment', category: 'shoes', subcategory: 'boots', colors: ['black'], pattern: 'solid', material: 'leather', sleeveLength: null, fit: null, style: 'classic', season: ['winter'], gender: 'unisex', formality: 'smart_casual', confidence: { ...zero, category: 0.9 } }))
      const real = await up(await image(500, 600, '#151515'))
      expect(real.status).toBe(201)
      expect((await real.json()).detection.mock).toBe(false)
      scripted(() => ({ subject: 'no_garment', category: null, subcategory: null, colors: [], pattern: null, material: null, sleeveLength: null, fit: null, style: null, season: [], gender: null, formality: null, confidence: zero }))
      await up(await image(500, 500)) // NOT_A_GARMENT
      scripted(() => {
        throw new AiProviderError('unavailable', 'gemini', { status: 503 })
      })
      await up(await image(500, 500)) // AI_UNAVAILABLE
      sql(DB, `INSERT INTO "AiUsage" ("id","userId","feature","day","count","updatedAt") VALUES ('${crypto.randomUUID()}','${u.userId}','clothing_analysis', (now() AT TIME ZONE 'Asia/Tashkent')::date, 50, now()) ON CONFLICT ("userId","feature","day") DO UPDATE SET "count" = 50`)
      await up(await image(500, 500)) // AI_QUOTA_EXCEEDED
    } finally {
      setVisionProviderForTesting(null)
    }

    const list = await call('listWardrobeItems', wardrobeRoute.GET as Handler, req(`${W}?limit=2`, { headers: u.auth }))
    const page = await list.json()
    await call('listWardrobeItems', wardrobeRoute.GET as Handler, req(`${W}?limit=2&cursor=${page.nextCursor}`, { headers: u.auth }))
    await call('listWardrobeItems', wardrobeRoute.GET as Handler, req(`${W}?limit=0`, { headers: u.auth })) // VALIDATION_ERROR
    await call('getWardrobeItem', wardrobeItemRoute.GET as Handler, req(`${W}/${ids[0]}`, { headers: u.auth }), params({ id: ids[0] }))
    await call('getWardrobeItem', wardrobeItemRoute.GET as Handler, req(`${W}/${ids[0]}`, { headers: other.auth }), params({ id: ids[0] })) // NOT_FOUND (not owner)
    await call('updateWardrobeItem', wardrobeItemRoute.PATCH as Handler, req(`${W}/${ids[0]}`, { method: 'PATCH', headers: u.auth, json: { category: 'shirt', colors: ['white'] } }), params({ id: ids[0] }))
    await call('updateWardrobeItem', wardrobeItemRoute.PATCH as Handler, req(`${W}/${ids[0]}`, { method: 'PATCH', headers: u.auth, json: {} }), params({ id: ids[0] }))
    await call('updateWardrobeItem', wardrobeItemRoute.PATCH as Handler, req(`${W}/nope`, { method: 'PATCH', headers: u.auth, json: {} }), params({ id: 'nope' })) // NOT_FOUND
    await call('deleteWardrobeItem', wardrobeItemRoute.DELETE as Handler, req(`${W}/nope`, { method: 'DELETE', headers: u.auth }), params({ id: 'nope' })) // NOT_FOUND

    // media through a signed URL
    const item = (await (await wardrobeRoute.GET(req(`${W}/${ids[0]}`, { headers: u.auth }) as never, undefined as never)).json()).items[0]
    const url = new URL(item.primaryImage.url, 'http://localhost')
    const key = decodeURIComponent(url.pathname.replace('/api/v1/media/', '')).split('/')
    await call('getMedia', media as Handler, new NextRequest(url), params({ key }))
    url.searchParams.set('sig', 'tampered')
    await call('getMedia', media as Handler, new NextRequest(url), params({ key })) // NOT_FOUND

    // outfits
    const gen = await call('generateOutfits', generate as Handler, req('/api/v1/outfits/generate', { method: 'POST', headers: u.auth, json: { occasion: 'casual', lat: 41.3, lon: 69.2, seed: 1 } }))
    expect(gen.status).toBe(200)
    await call('generateOutfits', generate as Handler, req('/api/v1/outfits/generate', { method: 'POST', headers: other.auth, json: {} })) // empty wardrobe
    const saved = await call('saveOutfit', outfitsRoute.POST as Handler, req('/api/v1/outfits', { method: 'POST', headers: u.auth, json: { occasion: 'casual', isSaved: true, reasons: ['Mos'], items: ids.map((id, i) => ({ itemId: id, role: ['top', 'bottom', 'shoes'][i] })) } }))
    const outfitId = (await saved.json()).outfit.id
    await call('saveOutfit', outfitsRoute.POST as Handler, req('/api/v1/outfits', { method: 'POST', headers: other.auth, json: { items: [{ itemId: ids[0], role: 'top' }] } })) // FORBIDDEN
    await call('listOutfits', outfitsRoute.GET as Handler, req('/api/v1/outfits?saved=1', { headers: u.auth }))
    await call('listOutfits', outfitsRoute.GET as Handler, req('/api/v1/outfits?saved=maybe', { headers: u.auth })) // VALIDATION_ERROR
    await call('getOutfit', outfitRoute.GET as Handler, req(`/api/v1/outfits/${outfitId}`, { headers: u.auth }), params({ id: outfitId }))
    await call('getOutfit', outfitRoute.GET as Handler, req(`/api/v1/outfits/${outfitId}`, { headers: other.auth }), params({ id: outfitId })) // NOT_FOUND
    await call('updateOutfit', outfitRoute.PATCH as Handler, req(`/api/v1/outfits/${outfitId}`, { method: 'PATCH', headers: u.auth, json: { name: 'Ish kuni' } }), params({ id: outfitId }))
    await call('updateOutfit', outfitRoute.PATCH as Handler, req(`/api/v1/outfits/x`, { method: 'PATCH', headers: u.auth, json: {} }), params({ id: 'x' })) // NOT_FOUND
    await call('sendOutfitFeedback', feedback as Handler, req(`/api/v1/outfits/${outfitId}/feedback`, { method: 'POST', headers: u.auth, json: { feedback: 'liked' } }), params({ id: outfitId }))
    await call('sendOutfitFeedback', feedback as Handler, req(`/api/v1/outfits/x/feedback`, { method: 'POST', headers: u.auth, json: { feedback: 'liked' } }), params({ id: 'x' })) // NOT_FOUND
    await call('deleteOutfit', outfitRoute.DELETE as Handler, req(`/api/v1/outfits/${outfitId}`, { method: 'DELETE', headers: u.auth }), params({ id: outfitId }))
    await call('deleteOutfit', outfitRoute.DELETE as Handler, req(`/api/v1/outfits/${outfitId}`, { method: 'DELETE', headers: u.auth }), params({ id: outfitId })) // NOT_FOUND

    // stylist
    const c = await call('stylistChat', chat as Handler, req('/api/v1/stylist/chat', { method: 'POST', headers: u.auth, json: { message: 'Bugun nima kiyay?', event: 'ish' } }))
    const conversationId = (await c.json()).conversationId
    await call('stylistChat', chat as Handler, req('/api/v1/stylist/chat', { method: 'POST', headers: u.auth, json: { message: 'Rahmat', conversationId } }))
    await call('listConversations', conversations as Handler, req('/api/v1/stylist/conversations', { headers: u.auth }))
    await call('getConversation', conversation as Handler, req(`/api/v1/stylist/conversations/${conversationId}`, { headers: u.auth }), params({ id: conversationId }))
    await call('getConversation', conversation as Handler, req(`/api/v1/stylist/conversations/${conversationId}`, { headers: other.auth }), params({ id: conversationId })) // NOT_FOUND

    // weather and service
    await call('getCurrentWeather', weather as Handler, req('/api/v1/weather/current?lat=41.31&lon=69.28', { headers: u.auth }))
    await call('getCurrentWeather', weather as Handler, req('/api/v1/weather/current?lat=41.31&lon=69.28', { headers: u.auth })) // cached
    await call('getCurrentWeather', weather as Handler, req('/api/v1/weather/current?lat=500', { headers: u.auth })) // VALIDATION_ERROR
    await call('getHealth', health as Handler, req('/api/health'))
    const doc = await call('getOpenApiDocument', openapi as Handler, req('/api/v1/openapi.json'))
    expect(await doc.text()).toBe(serializeOpenApiDocument())
  })

  it('coverage: every operation succeeded and produced each of its specific error codes', () => {
    const missing: string[] = []
    for (const op of OPERATIONS as Operation[]) {
      const seen = covered.get(op.operationId) ?? new Set()
      if (!seen.has(`success:${op.success[0].status}`)) missing.push(`${op.operationId}: success ${op.success[0].status}`)
      for (const code of op.errors) if (!seen.has(`code:${code}`)) missing.push(`${op.operationId}: ${code}`)
    }
    expect(missing).toEqual([])
  })
})
