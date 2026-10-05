import { expect, type APIRequestContext, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'

export const PASSWORD = 'e2e-Passw0rd!'

let seq = 0
export function uniqueUser(label = 'u') {
  seq += 1
  const id = `${Date.now().toString(36)}${process.pid}${seq}${Math.random().toString(36).slice(2, 6)}`
  return { name: `E2E ${label}`, email: `e2e-${label}-${id}@example.test`, password: PASSWORD }
}

export type TestUser = ReturnType<typeof uniqueUser>

/** Register through the API; the context's cookie jar gets the session cookies. */
export async function registerViaApi(request: APIRequestContext, user = uniqueUser()) {
  const res = await request.post('/api/v1/auth/register', { data: user })
  expect(res.status(), 'register').toBe(201)
  return user
}

/** Register through the UI form. */
export async function registerViaUi(page: Page, user = uniqueUser()) {
  await page.goto('/register')
  await page.getByLabel('Ismingiz').fill(user.name)
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Parol').fill(user.password)
  await page.getByRole('button', { name: 'Boshlash' }).click()
  await expect(page).toHaveURL(/\/$/)
  return user
}

export async function loginViaUi(page: Page, user: TestUser, from = '/login') {
  await page.goto(from)
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Parol').fill(user.password)
  await page.locator('form').getByRole('button', { name: 'Kirish' }).click()
}

let imageDir: string | undefined
/** Generates a solid-colour PNG at runtime (never committed). Name drives the mock vision. */
export async function makeImage(name: string, color: { r: number; g: number; b: number }) {
  imageDir ??= mkdtempSync(path.join(tmpdir(), 'atlas-e2e-img-'))
  const file = path.join(imageDir, name)
  await sharp({ create: { width: 300, height: 400, channels: 3, background: color } })
    .png()
    .toFile(file)
  return file
}

export const GARMENTS = {
  shirt: { name: 'white-shirt.png', color: { r: 245, g: 245, b: 245 } },
  jeans: { name: 'blue-jeans.png', color: { r: 40, g: 70, b: 150 } },
  sneaker: { name: 'white-sneaker.png', color: { r: 240, g: 240, b: 240 } },
} as const

/** Upload one image through /wardrobe/new using the gallery (non-camera) input. */
export async function uploadGarment(page: Page, kind: keyof typeof GARMENTS) {
  const g = GARMENTS[kind]
  const file = await makeImage(g.name, g.color)
  await page.goto('/wardrobe/new')
  // Choose the file only after hydration; a change fired while React is still
  // hydrating can be lost (the request may succeed but the UI state is not kept).
  await page.waitForLoadState('networkidle')
  const respPromise = page.waitForResponse(
    (r) => r.url().includes('/api/v1/wardrobe/items') && r.request().method() === 'POST',
  )
  await page.locator('input[type=file]:not([capture])').setInputFiles(file)
  const resp = await respPromise
  expect(resp.status(), `upload ${g.name}`).toBe(201)
  const body = await resp.json()
  await expect(page.getByText('Tahlil tayyor')).toBeVisible()
  return body.item.id as string
}

export async function uploadAll(page: Page) {
  const ids: string[] = []
  for (const k of ['shirt', 'jeans', 'sneaker'] as const) ids.push(await uploadGarment(page, k))
  return ids
}

export function cookieByName<T extends { name: string }>(cookies: T[], name: string) {
  return cookies.find((c) => c.name === name)
}
