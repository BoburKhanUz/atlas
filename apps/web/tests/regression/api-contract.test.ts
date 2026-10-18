/**
 * API contract: every route validates input, enforces body limits and returns
 * errors as { error, code, details?, requestId } without leaking internals.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const db = vi.hoisted(() => ({
  wardrobeItem: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  outfit: { create: vi.fn(), findFirst: vi.fn() },
  user: { findUnique: vi.fn() },
  aiConversation: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  aiMessage: { create: vi.fn(), findMany: vi.fn() },
  $transaction: vi.fn(),
  aiMemory: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  $queryRaw: vi.fn(),
}))
vi.mock('@/lib/db', () => ({ db }))

vi.mock('@/lib/ai/recommendation', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/lib/ai/recommendation')>()
  return { ...m, generateOutfits: vi.fn(m.generateOutfits) }
})

vi.mock('@/lib/ai/stylist-service', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/lib/ai/stylist-service')>()
  return { ...m, runStylistTurn: vi.fn(m.runStylistTurn) }
})

import { GET as listItems, POST as uploadItem } from '@/app/api/v1/wardrobe/items/route'
import { PATCH as patchItem } from '@/app/api/v1/wardrobe/items/[id]/route'
import { POST as saveOutfit } from '@/app/api/v1/outfits/route'
import { POST as chat } from '@/app/api/v1/stylist/chat/route'
import { GET as health } from '@/app/api/health/route'
import { generateOutfits } from '@/lib/ai/recommendation'
import { runStylistTurn } from '@/lib/ai/stylist-service'
import { setLLMProviderForTesting } from '@/lib/ai/providers'
import { MockProvider } from '@/lib/ai/providers/mock'
import { acceptedLegalTexts, authHeader, jsonRequest } from '../helpers'

Object.assign(db, { legalConsent: acceptedLegalTexts() })

const ID = { params: Promise.resolve({ id: 'item_1' }) }

function req(url: string, init: { method?: string; headers?: Record<string, string>; body?: BodyInit } = {}) {
  return new NextRequest(`http://localhost${url}`, init)
}

async function expectErrorShape(res: Response, status: number, code: string) {
  expect(res.status).toBe(status)
  const body = await res.json()
  expect(typeof body.error).toBe('string')
  expect(body.code).toBe(code)
  return body
}

const wardrobeRows = [
  {
    id: 'item_shirt', category: 'shirt', subcategory: 'oxford_shirt', colors: '["white"]', pattern: 'solid',
    material: 'cotton', sleeveLength: 'long', fit: 'regular', style: 'smart_casual', season: '["spring"]',
    gender: 'male', formality: 'smart_casual', images: [],
  },
  {
    id: 'item_pants', category: 'pants', subcategory: 'chinos', colors: '["navy"]', pattern: 'solid',
    material: 'cotton', sleeveLength: null, fit: 'slim', style: 'smart_casual', season: '["spring"]',
    gender: 'male', formality: 'smart_casual', images: [],
  },
  {
    id: 'item_shoes', category: 'shoes', subcategory: 'sneakers', colors: '["black"]', pattern: 'solid',
    material: 'leather', sleeveLength: null, fit: 'regular', style: 'casual', season: '["spring"]',
    gender: 'male', formality: 'casual', images: [],
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  setLLMProviderForTesting(new MockProvider({ respond: () => 'Mana tavsiya.' }))
  db.wardrobeItem.findMany.mockResolvedValue(wardrobeRows)
  db.user.findUnique.mockResolvedValue(null)
  db.aiConversation.findFirst.mockResolvedValue(null)
  db.aiConversation.create.mockResolvedValue({ id: 'conv_1', messages: [] })
  db.aiConversation.update.mockResolvedValue({})
  db.aiMessage.create.mockResolvedValue({ id: 'msg_1' })
  db.aiMessage.findMany.mockResolvedValue([])
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db))
  db.aiMemory.findMany.mockResolvedValue([])
  db.aiMemory.findFirst.mockResolvedValue(null)
  db.aiMemory.create.mockResolvedValue({})
})

describe('validation', () => {
  it('PATCH wardrobe item with an unknown category -> 400 VALIDATION_ERROR with details', async () => {
    const res = await patchItem(
      req('/api/v1/wardrobe/items/item_1', {
        method: 'PATCH',
        headers: { ...(await authHeader()), 'content-type': 'application/json' },
        body: JSON.stringify({ category: 'spaceship', colors: ['white', 'plaid-ish'] }),
      }),
      ID,
    )
    const body = await expectErrorShape(res, 400, 'VALIDATION_ERROR')
    expect(Array.isArray(body.details)).toBe(true)
    expect(body.details.map((d: { path: string }) => d.path)).toEqual(expect.arrayContaining(['category', 'colors.1']))
    expect(body.requestId).toBeTruthy()
    expect(db.wardrobeItem.findFirst).not.toHaveBeenCalled()
  })

  describe('PATCH wardrobe item: subcategory must belong to the resulting category', () => {
    const shirt = {
      id: 'item_1', userId: 'u', category: 'shirt', subcategory: 'tshirt', colors: '["white"]', season: '["summer"]',
      confidences: '{}', wasCorrected: false, correctionLog: '[]', createdAt: new Date(0), updatedAt: new Date(0),
    }
    async function patch(body: unknown) {
      return patchItem(
        req('/api/v1/wardrobe/items/item_1', {
          method: 'PATCH',
          headers: { ...(await authHeader()), 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
        ID,
      )
    }
    beforeEach(() => {
      db.wardrobeItem.findFirst.mockResolvedValue(shirt)
      db.wardrobeItem.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...shirt, ...data, images: [] }))
    })

    it.each([
      ['a subcategory of another category', { subcategory: 'sneakers' }],
      ['a new category that keeps a stale subcategory', { category: 'shoes' }],
      ['both changed to a mismatching pair', { category: 'shirt', subcategory: 'sneakers' }],
    ])('rejects %s -> 400 VALIDATION_ERROR on subcategory, nothing written', async (_name, body) => {
      const err = await expectErrorShape(await patch(body), 400, 'VALIDATION_ERROR')
      expect(err.details.map((d: { path: string }) => d.path)).toEqual(['subcategory'])
      expect(db.wardrobeItem.update).not.toHaveBeenCalled()
    })

    it.each([
      ['a matching pair', { category: 'shoes', subcategory: 'sneakers' }],
      ['a subcategory of the current category', { subcategory: 'polo' }],
      ['a new category with the subcategory cleared', { category: 'shoes', subcategory: null }],
      ['fields other than category/subcategory', { colors: ['black'] }],
    ])('accepts %s', async (_name, body) => {
      expect((await patch(body)).status).toBe(200)
    })
  })

  it('GET wardrobe with an unknown ?category -> 400', async () => {
    const res = await listItems(req('/api/v1/wardrobe/items?category=nope', { headers: await authHeader() }), undefined)
    await expectErrorShape(res, 400, 'VALIDATION_ERROR')
    expect(db.wardrobeItem.findMany).not.toHaveBeenCalled()
  })

  it('rejects over-long outfit text fields', async () => {
    const res = await saveOutfit(
      jsonRequest(
        '/api/v1/outfits',
        { name: 'x'.repeat(81), items: [{ itemId: 'a', role: 'top' }] },
        await authHeader(),
      ),
      undefined,
    )
    await expectErrorShape(res, 400, 'VALIDATION_ERROR')
  })
})

describe('pagination', () => {
  it('GET wardrobe returns { items, nextCursor } and keeps `items`', async () => {
    db.wardrobeItem.findMany.mockResolvedValue(wardrobeRows.map((r) => ({ ...r, confidences: '{}', correctionLog: '[]', wasCorrected: false, createdAt: new Date(), updatedAt: new Date() })))
    const res = await listItems(req('/api/v1/wardrobe/items?limit=2', { headers: await authHeader() }), undefined)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toHaveLength(2)
    expect(body.nextCursor).toBe('item_pants')
    expect(db.wardrobeItem.findMany.mock.calls[0][0]).toMatchObject({ take: 3 })

    const last = await listItems(
      req('/api/v1/wardrobe/items?limit=5&cursor=item_pants', { headers: await authHeader() }),
      undefined,
    )
    expect((await last.json()).nextCursor).toBeNull()
    expect(db.wardrobeItem.findMany.mock.calls[1][0]).toMatchObject({ cursor: { id: 'item_pants' }, skip: 1 })
  })

  it('rejects limit out of range', async () => {
    const res = await listItems(req('/api/v1/wardrobe/items?limit=500', { headers: await authHeader() }), undefined)
    await expectErrorShape(res, 400, 'VALIDATION_ERROR')
  })
})

describe('body limits', () => {
  it('oversized JSON (Content-Length > 64 KB) -> 413 PAYLOAD_TOO_LARGE', async () => {
    const res = await saveOutfit(
      req('/api/v1/outfits', {
        method: 'POST',
        headers: { ...(await authHeader()), 'content-type': 'application/json' },
        body: JSON.stringify({ explanation: 'x'.repeat(70 * 1024), items: [{ itemId: 'a', role: 'top' }] }),
      }),
      undefined,
    )
    await expectErrorShape(res, 413, 'PAYLOAD_TOO_LARGE')
  })

  it('upload without Content-Length -> 413', async () => {
    const form = new FormData()
    form.append('file', new File([new Uint8Array(10)], 'a.jpg', { type: 'image/jpeg' }))
    const res = await uploadItem(
      req('/api/v1/wardrobe/items', { method: 'POST', headers: await authHeader(), body: form }),
      undefined,
    )
    await expectErrorShape(res, 413, 'PAYLOAD_TOO_LARGE')
  })

  it('upload that is not multipart -> 415', async () => {
    const res = await uploadItem(
      req('/api/v1/wardrobe/items', {
        method: 'POST',
        headers: { ...(await authHeader()), 'content-type': 'application/json', 'content-length': '2' },
        body: '{}',
      }),
      undefined,
    )
    await expectErrorShape(res, 415, 'UNSUPPORTED_MEDIA_TYPE')
  })
})

describe('error handling', () => {
  it('unknown error inside a handler -> 500 INTERNAL, requestId, no stack leaked', async () => {
    db.wardrobeItem.findMany.mockRejectedValue(new Error('connection to db.internal:5432 refused'))
    const res = await listItems(req('/api/v1/wardrobe/items', { headers: await authHeader() }), undefined)
    const body = await expectErrorShape(res, 500, 'INTERNAL')
    expect(body.requestId).toBeTruthy()
    expect(res.headers.get('x-request-id')).toBe(body.requestId)
    const text = JSON.stringify(body)
    expect(text).not.toContain('db.internal')
    expect(text).not.toMatch(/\bat\s.+\(.+:\d+:\d+\)/)
    expect(body.stack).toBeUndefined()
  })

  it('401 / 404 / 403 all use { error, code }', async () => {
    await expectErrorShape(await listItems(req('/api/v1/wardrobe/items'), undefined), 401, 'UNAUTHORIZED')

    db.wardrobeItem.findFirst.mockResolvedValue(null)
    const notFound = await patchItem(
      req('/api/v1/wardrobe/items/item_1', {
        method: 'PATCH',
        headers: { ...(await authHeader()), 'content-type': 'application/json' },
        body: JSON.stringify({ category: 'shirt' }),
      }),
      ID,
    )
    await expectErrorShape(notFound, 404, 'NOT_FOUND')

    db.wardrobeItem.findMany.mockResolvedValue([])
    const forbidden = await saveOutfit(
      jsonRequest('/api/v1/outfits', { items: [{ itemId: 'x', role: 'top' }] }, await authHeader()),
      undefined,
    )
    await expectErrorShape(forbidden, 403, 'FORBIDDEN')
  })
})

describe('stylist chat event handling', () => {
  async function send(event: string | null) {
    return chat(
      jsonRequest('/api/v1/stylist/chat', { message: 'Bugun nima kiyaman?', event }, await authHeader()),
      undefined,
    )
  }

  it('free-text event "nikoh" does not crash the engine (occasion undefined)', async () => {
    const res = await send('nikoh')
    expect(res.status).toBe(200)
    expect(generateOutfits).toHaveBeenCalledTimes(1)
    expect(vi.mocked(generateOutfits).mock.calls[0][0].occasion).toBeUndefined()
  })

  it('maps an occasion id, catalog label or alias to the occasion', async () => {
    await send('wedding')
    expect(vi.mocked(generateOutfits).mock.calls[0][0].occasion).toBe('wedding')
    await send('Uchrashuv')
    expect(vi.mocked(generateOutfits).mock.calls[1][0].occasion).toBe('date')
    await send("to'y")
    expect(vi.mocked(generateOutfits).mock.calls[2][0].occasion).toBe('wedding')
    await send('Kundalik')
    expect(vi.mocked(generateOutfits).mock.calls[3][0].occasion).toBe('casual')
  })

  it('resolves an alias for the engine but passes the original event text to the stylist', async () => {
    const res = await send('Kundalik')
    expect(res.status).toBe(200)
    expect(vi.mocked(generateOutfits).mock.calls[0][0].occasion).toBe('casual')
    expect(runStylistTurn).toHaveBeenCalledTimes(1)
    expect(vi.mocked(runStylistTurn).mock.calls[0][0].occasionText).toBe('Kundalik')
  })

  it('an occasion id (what both clients send) reaches the engine and the stylist as that id', async () => {
    const res = await send('wedding')
    expect(res.status).toBe(200)
    expect(vi.mocked(generateOutfits).mock.calls[0][0].occasion).toBe('wedding')
    expect(vi.mocked(runStylistTurn).mock.calls[0][0].occasionText).toBe('wedding')
  })

  it('an event that is not an occasion stays free text for the stylist, without an occasion', async () => {
    const res = await send('Do‘stimning tug‘ilgan kuni')
    expect(res.status).toBe(200)
    expect(vi.mocked(generateOutfits).mock.calls[0][0].occasion).toBeUndefined()
    expect(vi.mocked(runStylistTurn).mock.calls[0][0].occasionText).toBe('Do‘stimning tug‘ilgan kuni')
  })

  it('rejects an event longer than 60 characters', async () => {
    await expectErrorShape(await send('x'.repeat(61)), 400, 'VALIDATION_ERROR')
  })
})

describe('GET /api/health', () => {
  it('reports ok with version, no auth', async () => {
    db.$queryRaw.mockResolvedValue([{ '?column?': 1 }])
    const res = await health(req('/api/health'), undefined)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'ok', database: 'ok', version: expect.any(String) })
  })

  it('returns 503 when the database is down', async () => {
    db.$queryRaw.mockRejectedValue(new Error('down'))
    const res = await health(req('/api/health'), undefined)
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ status: 'degraded', database: 'unreachable' })
  })
})
