import { promises as fs } from 'fs'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { selfie } from '../../tests/unit/ai/selfie-fixtures'
import { renderSynthetic, syntheticVisionItems } from '../../scripts/ai-eval/synthetic-vision'
import { uniqueUser } from '../helpers'
import { checkSmokeLog, isMockProviderName, smokeMode } from './smoke-mode'

// Phase 5.0 staging smoke (docs/ai/staging.md): one end-to-end pass over the
// AI surface, API level. In the normal e2e run it targets the local
// production build with mock providers; against staging it runs through
// playwright.staging.config.ts. A real provider needs an explicit opt-in and
// never runs in CI (smokeMode refuses).

const mode = smokeMode(process.env)
const real = mode.provider === 'real'

/** Synthetic garments (no real photos): the file name drives the mock, the pixels a real provider. */
const GARMENTS = [
  { synthetic: 'tshirt_white', name: 'white-shirt.png', category: 'shirt' },
  { synthetic: 'jeans_blue', name: 'blue-jeans.png', category: 'pants' },
  { synthetic: 'shoes_white', name: 'white-sneaker.png', category: 'shoes' },
] as const

const WEATHER = { temperature: 18, feelsLike: 18, condition: 'cloudy', precipitationProbability: 10, humidity: 60, windSpeed: 8, uvIndex: 2 }
const MESSAGE = 'Bugun ofisga nima kiyay?'
/** Text that would reveal an internal detail in a public error. */
const INTERNAL = /gemini|openai|api[_-]?key|stack|prisma|ECONN|at \w+ \(/i

async function errorCode(res: Awaited<ReturnType<APIRequestContext['get']>>) {
  const text = await res.text()
  expect(text, 'public error leaks nothing internal').not.toMatch(INTERNAL)
  return (JSON.parse(text) as { code?: string }).code
}

test.describe('staging smoke', () => {
  test.describe.configure({ mode: 'serial', timeout: real ? 300_000 : 90_000 })

  test(`AI surface end to end (${mode.provider} provider)`, async ({ request }) => {
    test.info().annotations.push({ type: 'provider', description: mode.provider })
    const started = new Date().toISOString()
    const forbidden: string[] = []

    await test.step('health and config', async () => {
      const health = await request.get('/api/health')
      expect(health.status()).toBe(200)
      expect(await health.json()).toMatchObject({ status: 'ok', database: 'ok' })
      expect((await request.get('/api/v1/openapi.json')).status()).toBe(200)
    })

    const user = mode.account ?? uniqueUser('smoke')
    await test.step('auth', async () => {
      const anonymous = await request.get('/api/v1/auth/me')
      expect(anonymous.status()).toBe(401)
      const res = mode.account
        ? await request.post('/api/v1/auth/login', { data: { email: user.email, password: user.password } })
        : await request.post('/api/v1/auth/register', { data: user })
      expect(res.status(), 'sign in').toBe(mode.account ? 200 : 201)
      expect((await request.get('/api/v1/auth/me')).status()).toBe(200)
      forbidden.push(user.email, user.password)
    })

    const items: string[] = []
    await test.step('wardrobe upload and vision', async () => {
      for (const g of GARMENTS) {
        const buffer = await renderSynthetic(syntheticVisionItems().find((i) => i.id === g.synthetic)!)
        const res = await request.post('/api/v1/wardrobe/items', { multipart: { file: { name: g.name, mimeType: 'image/png', buffer } } })
        if (real && res.status() === 422) {
          // A real provider may refuse a synthetic drawing; that is a controlled answer, not a failure.
          expect(await errorCode(res)).toBe('NOT_A_GARMENT')
          test.info().annotations.push({ type: 'vision', description: `${g.synthetic}: refused (NOT_A_GARMENT)` })
          continue
        }
        expect(res.status(), `upload ${g.synthetic}`).toBe(201)
        const body = (await res.json()) as { item: { id: string }; detection: { category: string; mock: boolean } }
        // Mock vs real is visible on every analysis: the smoke fails if the target runs the other one.
        expect(body.detection.mock, 'analysis provider matches STAGING_SMOKE_PROVIDER').toBe(!real)
        if (!real) expect(body.detection.category).toBe(g.category)
        items.push(body.item.id)
        forbidden.push(body.item.id)
      }
    })

    await test.step('colour profile (deterministic, no provider)', async () => {
      const res = await request.post('/api/v1/color-profile/analyze', {
        multipart: { file: { name: 'selfie.jpg', mimeType: 'image/jpeg', buffer: await selfie({ skin: '#f1c9a5', hair: '#3b2416', eyes: '#5a3a22' }) } },
      })
      expect(res.status()).toBe(200)
      expect((await res.json()).colorProfile).toMatchObject({ season: 'spring', undertone: 'warm' })
    })

    await test.step('stylist', async () => {
      const res = await request.post('/api/v1/stylist/chat', { data: { message: MESSAGE } })
      if (res.status() === 503) {
        expect(await errorCode(res)).toBe('AI_UNAVAILABLE')
        throw new Error('stylist answered AI_UNAVAILABLE: the feature is off or this user is outside the rollout (see docs/ai/staging.md)')
      }
      expect(res.status()).toBe(200)
      const body = (await res.json()) as { conversationId: string; assistantMessage: string }
      expect(body.assistantMessage.trim().length).toBeGreaterThan(0)
      forbidden.push(body.conversationId, MESSAGE)
    })

    await test.step('outfit generation and AI explanation', async () => {
      const res = await request.post('/api/v1/outfits/generate', { data: { occasion: 'work', weather: WEATHER } })
      expect(res.status()).toBe(200)
      const body = (await res.json()) as { outfits: Array<{ explanation: string; items: unknown[] }>; fallback: boolean }
      if (items.length === GARMENTS.length) expect(body.outfits.length).toBeGreaterThan(0)
      for (const o of body.outfits) expect(o.explanation.trim().length).toBeGreaterThan(0)
      // Mock: the deterministic explanation (fallback). Real: the AI explanation, unless it fell back.
      if (!real) expect(body.fallback).toBe(true)
      else if (body.outfits.length > 0) expect.soft(body.fallback, 'real provider explained the outfits (no deterministic fallback)').toBe(false)
    })

    await test.step('failure behaviour (controlled, nothing internal)', async () => {
      const empty = await request.post('/api/v1/stylist/chat', { data: { message: '' } })
      expect(empty.status()).toBe(400)
      expect(await errorCode(empty)).toBe('VALIDATION_ERROR')
      const notImage = await request.post('/api/v1/wardrobe/items', { multipart: { file: { name: 'notes.png', mimeType: 'image/png', buffer: Buffer.from('not an image') } } })
      expect(notImage.status()).toBeGreaterThanOrEqual(400)
      expect(notImage.status()).toBeLessThan(500)
      expect(await errorCode(notImage)).toBeTruthy()
    })

    await test.step('monitoring, quota and privacy (target log)', async () => {
      if (!mode.logFile) {
        test.info().annotations.push({ type: 'monitoring', description: 'skipped: no STAGING_SMOKE_LOG_FILE' })
        return
      }
      const verdict = checkSmokeLog(await fs.readFile(mode.logFile, 'utf8'), forbidden, { from: started })
      expect(verdict.features).toEqual(expect.arrayContaining(['clothing_analysis', 'outfit_explanation', 'stylist_chat']))
      expect(verdict.providers.every(isMockProviderName), 'providers on ai.request match the mode').toBe(!real)
      // The mock never uses quota; a real provider is charged for the stylist turn.
      if (real) expect(verdict.quotaCharged).toBeGreaterThan(0)
      else expect(verdict.quotaCharged).toBe(0)
      expect(verdict.leaks, 'no email, password, id or message text in the log').toEqual([])
    })

    await test.step('cleanup', async () => {
      if (mode.account) {
        for (const id of items) expect((await request.delete(`/api/v1/wardrobe/items/${id}`)).status()).toBe(200)
        expect((await request.delete('/api/v1/color-profile')).status()).toBe(200)
      } else {
        expect((await request.delete('/api/v1/account')).status()).toBe(200)
      }
    })
  })
})
