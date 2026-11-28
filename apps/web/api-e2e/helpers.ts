import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { LEGAL_VERSION } from '../src/lib/legal/version'
import { expect, type Api } from './fixtures'

export const PASSWORD = 'api-e2e-Passw0rd!'
export const CONSENT = { acceptedLegalVersion: LEGAL_VERSION, ageConfirmed: true }

let seq = 0
export function uniqueUser(label = 'u') {
  seq += 1
  const id = `${Date.now().toString(36)}${process.pid}${seq}${Math.random().toString(36).slice(2, 6)}`
  return { name: `API ${label}`, email: `api-${label}-${id}@example.test`, password: PASSWORD }
}
export type User = ReturnType<typeof uniqueUser>

export interface MobileSession {
  user: User
  userId: string
  accessToken: string
  refreshToken: string
}

/** Signs up in mobile mode: the tokens come in the body. */
export async function signUpMobile(api: Api, label = 'm'): Promise<MobileSession> {
  const user = uniqueUser(label)
  const res = await api.post('/api/v1/auth/register', { mobile: true, data: { ...user, ...CONSENT } })
  expect(res.status, 'register').toBe(201)
  const body = res.body as { accessToken: string; refreshToken: string; user: { id: string } }
  return { user, userId: body.user.id, accessToken: body.accessToken, refreshToken: body.refreshToken }
}

/** Signs up in web mode: the request context keeps the session cookies. */
export async function signUpWeb(api: Api, label = 'w'): Promise<User> {
  const user = uniqueUser(label)
  const res = await api.post('/api/v1/auth/register', { data: { ...user, ...CONSENT } })
  expect(res.status, 'register').toBe(201)
  return user
}

/** A plain picture whose file name steers the mock garment analysis. */
export async function garment(name: string, rgb: [number, number, number]) {
  const buffer = await sharp({ create: { width: 320, height: 400, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } }).png().toBuffer()
  return { name, mimeType: 'image/png', buffer }
}

export const GARMENTS = {
  shirt: ['white-shirt.png', [245, 245, 245]],
  jeans: ['blue-jeans.png', [40, 70, 150]],
  sneaker: ['white-sneaker.png', [240, 240, 240]],
  coat: ['black-coat.png', [20, 20, 20]],
} as const satisfies Record<string, readonly [string, readonly [number, number, number]]>

/** Uploads one garment for a mobile session; returns the created item. */
export async function upload(api: Api, s: MobileSession, kind: keyof typeof GARMENTS, key?: string) {
  const [name, rgb] = GARMENTS[kind]
  const res = await api.post('/api/v1/wardrobe/items', {
    bearer: s.accessToken,
    headers: key ? { 'Idempotency-Key': key } : {},
    multipart: { file: await garment(name, [...rgb] as [number, number, number]) },
  })
  expect(res.status, `upload ${name}`).toBe(201)
  return res
}

/** The reset links e-mailed to `to` (the worker writes them to the outbox), oldest first. */
export function resetTokensFor(to: string): string[] {
  const outbox = process.env.E2E_API_OUTBOX!
  return readdirSync(outbox)
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(outbox, f), 'utf8')) as { to: string; text: string })
    .filter((m) => m.to === to)
    .map((m) => new URL(m.text.match(/https?:\/\/\S+/)![0]).searchParams.get('token')!)
}

/** The files stored for a user (the local storage driver keeps them under the user's id). */
export function storedFilesOf(userId: string): string[] {
  const root = process.env.E2E_API_STORAGE!
  const out: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (p.includes(userId)) out.push(p)
    }
  }
  walk(root)
  return out
}
