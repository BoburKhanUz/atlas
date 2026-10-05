/**
 * Regression: uploaded photos were written to public/uploads and served to
 * anyone without authentication. They now live in a private directory and
 * are only served through HMAC-signed, expiring URLs.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import sharp from 'sharp'
import { NextRequest } from 'next/server'

const db = vi.hoisted(() => ({
  wardrobeItem: { findFirst: vi.fn(), delete: vi.fn() },
  $transaction: vi.fn(),
}))
vi.mock('@/lib/db', () => ({ db }))

import { GET as media } from '@/app/api/v1/media/[...key]/route'
import { POST as upload } from '@/app/api/v1/wardrobe/items/route'
import { DELETE as deleteItem } from '@/app/api/v1/wardrobe/items/[id]/route'
import { signMediaUrl, verifyMediaSignature } from '@/lib/storage/media'
import { getStorageProvider, setStorageProviderForTesting } from '@/lib/storage/provider'
import { serializeWardrobeItem } from '@/lib/wardrobe/serialize'
import { authHeader, TEST_USER } from '../helpers'

/** Serialise a FormData body so the request carries Content-Length (required for uploads). */
async function multipartRequest(url: string, form: FormData, headers: Record<string, string>) {
  const res = new Response(form)
  const body = new Uint8Array(await res.arrayBuffer())
  return new NextRequest(url, {
    method: 'POST',
    headers: { ...headers, 'content-type': res.headers.get('content-type')!, 'content-length': String(body.length) },
    body,
  })
}

let dir: string

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-storage-'))
  process.env.STORAGE_LOCAL_DIR = dir
  setStorageProviderForTesting(null)
})
afterAll(async () => {
  setStorageProviderForTesting(null)
  await fs.rm(dir, { recursive: true, force: true })
})
beforeEach(() => vi.clearAllMocks())

const pngBytes = () =>
  sharp({ create: { width: 64, height: 48, channels: 3, background: '#0F766E' } }).png().toBuffer()

function fetchMedia(signedUrl: string) {
  const url = new URL(`http://localhost${signedUrl}`)
  const key = decodeURIComponent(url.pathname.replace('/api/v1/media/', ''))
  return media(new NextRequest(url), { params: Promise.resolve({ key: key.split('/') }) })
}

describe('signed media URLs', () => {
  it('serves a stored image with a valid signature', async () => {
    const stored = await getStorageProvider().saveImage(await pngBytes(), TEST_USER.sub)
    expect(stored.key).toMatch(/^users\/user_test_1\/[0-9a-f-]{36}\.png$/)
    expect(stored.key.startsWith('public')).toBe(false)

    const res = await fetchMedia(signMediaUrl(stored.key))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('rejects missing, tampered and expired signatures', async () => {
    const stored = await getStorageProvider().saveImage(await pngBytes(), TEST_USER.sub)
    const signed = signMediaUrl(stored.key)

    expect((await fetchMedia(signed.split('?')[0])).status).toBe(404)
    expect((await fetchMedia(`${signed}x`)).status).toBe(404)
    const other = signed.replace(stored.key, stored.thumbnailKey)
    expect((await fetchMedia(other)).status).toBe(404)

    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000
    const expired = new URL(`http://localhost${signMediaUrl(stored.key, twoHoursAgo)}`)
    expect(
      verifyMediaSignature(stored.key, expired.searchParams.get('exp'), expired.searchParams.get('sig')),
    ).toBe(false)
  })

  it('never resolves keys outside the storage directory', async () => {
    for (const key of ['../../etc/passwd', 'users/x/../../secret.jpg', '/etc/passwd']) {
      expect(verifyMediaSignature(key, '9999999999', 'x')).toBe(false)
      await expect(getStorageProvider().readObject(key)).resolves.toBeNull()
    }
  })

  it('API responses expose signed URLs, not storage keys', () => {
    const item = serializeWardrobeItem({
      id: 'i1', userId: TEST_USER.sub, category: 'shirt', subcategory: null,
      colors: '["white"]', pattern: null, material: null, sleeveLength: null, fit: null,
      style: null, season: '[]', gender: null, formality: null, confidences: '{}',
      wasCorrected: false, correctionLog: '[]', createdAt: new Date(), updatedAt: new Date(),
      images: [{
        id: 'img1', wardrobeItemId: 'i1', storageKey: 'users/u/00000000-0000-0000-0000-000000000000.jpg',
        thumbnailKey: 'users/u/00000000-0000-0000-0000-000000000000_thumb.jpg',
        isPrimary: true, width: 1, height: 1, createdAt: new Date(),
      }],
    })
    expect(item.primaryImage?.url).toMatch(/^\/api\/v1\/media\/users\/u\/.+\?exp=\d+&sig=/)
    expect(JSON.stringify(item)).not.toContain('storageKey')
    expect(item).not.toHaveProperty('userId')
  })
})

describe('upload validation', () => {
  it('rejects a non-image disguised as image/jpeg with 422 and stores nothing', async () => {
    const form = new FormData()
    form.append('file', new File(['<html><script>alert(1)</script></html>'], 'x.jpg', { type: 'image/jpeg' }))
    const req = await multipartRequest('http://localhost/api/v1/wardrobe/items', form, await authHeader())
    const res = await upload(req, undefined)
    expect(res.status).toBe(422)
    expect(db.$transaction).not.toHaveBeenCalled()
  })
})

describe('deleting a wardrobe item', () => {
  it('removes its image files', async () => {
    const stored = await getStorageProvider().saveImage(await pngBytes(), TEST_USER.sub)
    db.wardrobeItem.findFirst.mockResolvedValue({
      id: 'i1',
      images: [{ storageKey: stored.key, thumbnailKey: stored.thumbnailKey }],
    })
    const req = new NextRequest('http://localhost/api/v1/wardrobe/items/i1', {
      method: 'DELETE',
      headers: await authHeader(),
    })
    const res = await deleteItem(req, { params: Promise.resolve({ id: 'i1' }) })
    expect(res.status).toBe(200)
    await expect(getStorageProvider().readObject(stored.key)).resolves.toBeNull()
    await expect(getStorageProvider().readObject(stored.thumbnailKey)).resolves.toBeNull()
  })
})
