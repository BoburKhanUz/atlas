/**
 * Regression: Phase 1 hardening.
 * - The rate limiter evicted the oldest LIVE buckets when full, so flooding
 *   unique keys reset a victim's login counter.
 * - clientIp trusted the client-supplied (left-most) X-Forwarded-For entry.
 * - Register had no limit at all when the client IP was unknown.
 * - Uploaded JPEG/PNG/WebP originals were stored byte-for-byte, keeping EXIF (GPS).
 * - A failed DB write after saveImage left orphaned files behind.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import sharp from 'sharp'
import { NextRequest } from 'next/server'

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  $transaction: vi.fn(),
}))
vi.mock('@/lib/db', () => ({ db }))

import { POST as register } from '@/app/api/v1/auth/register/route'
import { POST as upload } from '@/app/api/v1/wardrobe/items/route'
import { checkRateLimit, clientIp, resetRateLimits } from '@/lib/rate-limit'
import { getStorageProvider, setStorageProviderForTesting } from '@/lib/storage/provider'
import { authHeader, jsonRequest, TEST_USER } from '../helpers'

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

describe('rate limiter under key flooding', () => {
  beforeEach(() => resetRateLimits())
  afterAll(() => resetRateLimits())

  it('does not reset a live, over-limit bucket when 50k+ unique keys are flooded', () => {
    const now = 1_000_000
    const windowMs = 15 * 60 * 1000
    for (let i = 0; i < 11; i++) checkRateLimit('login:email:victim', 10, windowMs, now)
    expect(checkRateLimit('login:email:victim', 10, windowMs, now).allowed).toBe(false)

    let rejectedNew = 0
    for (let i = 0; i < 50_100; i++) {
      if (!checkRateLimit(`flood:${i}`, 10, windowMs, now + 1).allowed) rejectedNew++
    }
    // Map full: new keys fail closed instead of evicting live buckets.
    expect(rejectedNew).toBeGreaterThan(0)
    const flooded = checkRateLimit('flood:new-key', 10, windowMs, now + 1)
    expect(flooded.allowed).toBe(false)
    expect(flooded.retryAfterSeconds).toBeGreaterThan(0)

    expect(checkRateLimit('login:email:victim', 10, windowMs, now + 2).allowed).toBe(false)
  })

  it('admits new keys again once expired buckets can be pruned', () => {
    const windowMs = 1000
    for (let i = 0; i < 50_000; i++) checkRateLimit(`flood:${i}`, 10, windowMs, 0)
    expect(checkRateLimit('late', 10, windowMs, 10).allowed).toBe(false)
    expect(checkRateLimit('late', 10, windowMs, windowMs + 1).allowed).toBe(true)
  })
})

describe('clientIp', () => {
  const saved = process.env.TRUST_PROXY
  afterEach(() => {
    if (saved === undefined) delete process.env.TRUST_PROXY
    else process.env.TRUST_PROXY = saved
  })
  const req = (xff: string) =>
    new NextRequest('http://localhost/x', { headers: { 'x-forwarded-for': xff } })

  it('uses the right-most X-Forwarded-For entry (appended by the trusted proxy)', () => {
    process.env.TRUST_PROXY = '1'
    expect(clientIp(req('1.1.1.1, 2.2.2.2, 203.0.113.7'))).toBe('203.0.113.7')
    expect(clientIp(req('203.0.113.7'))).toBe('203.0.113.7')
  })

  it('returns null when TRUST_PROXY is unset', () => {
    delete process.env.TRUST_PROXY
    expect(clientIp(req('203.0.113.7'))).toBeNull()
  })
})

describe('register global rate limit', () => {
  beforeEach(() => {
    resetRateLimits()
    delete process.env.TRUST_PROXY
    db.user.findUnique.mockReset()
    db.user.findUnique.mockResolvedValue({ id: 'existing' }) // → 409, no hashing
  })
  afterAll(() => resetRateLimits())

  it('returns 429 after the global limit when no trusted IP is available', async () => {
    const attempt = (i: number) =>
      register(jsonRequest('/api/v1/auth/register', { email: `u${i}@example.com`, password: 'password123' }))
    for (let i = 0; i < 100; i++) expect((await attempt(i)).status).toBe(409)
    const blocked = await attempt(100)
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('retry-after')).toBeTruthy()
  })
})

describe('upload storage hardening', () => {
  let dir: string

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-hardening-'))
    process.env.STORAGE_LOCAL_DIR = dir
    setStorageProviderForTesting(null)
  })
  afterAll(async () => {
    setStorageProviderForTesting(null)
    await fs.rm(dir, { recursive: true, force: true })
  })

  const jpegWithExif = () =>
    sharp({ create: { width: 320, height: 256, channels: 3, background: '#0F766E' } })
      .withMetadata({ exif: { IFD0: { Copyright: 'x', Artist: 'gps-leak' } } })
      .jpeg()
      .toBuffer()

  it('stores JPEG originals without EXIF metadata', async () => {
    const input = await jpegWithExif()
    expect((await sharp(input).metadata()).exif).toBeDefined()

    const storage = getStorageProvider()
    const saved = await storage.saveImage(input, TEST_USER.sub)
    expect(saved.key).toMatch(/\.jpg$/)
    const stored = await storage.readObject(saved.key)
    expect(stored).not.toBeNull()
    const meta = await sharp(stored!).metadata()
    expect(meta.format).toBe('jpeg')
    expect(meta.exif).toBeUndefined()
    expect(meta.width).toBe(320)
  })

  it('deletes stored files when the DB transaction fails after saveImage', async () => {
    db.$transaction.mockRejectedValueOnce(new Error('db down'))
    const userDir = path.join(dir, 'users', TEST_USER.sub)
    await fs.mkdir(userDir, { recursive: true })
    const before = await fs.readdir(userDir)
    const form = new FormData()
    form.append('file', new File([new Uint8Array(await jpegWithExif())], 'shirt.jpg', { type: 'image/jpeg' }))
    const req = await multipartRequest('http://localhost/api/v1/wardrobe/items', form, await authHeader())
    // withApi maps the unexpected failure to a generic 500 (no internals leaked).
    const res = await upload(req, undefined)
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ code: 'INTERNAL' })
    expect(db.$transaction).toHaveBeenCalled()
    expect(await fs.readdir(userDir)).toEqual(before)
  })
})
