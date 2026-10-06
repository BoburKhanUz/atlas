import type { APIRequestContext } from '@playwright/test'
import { expect, test } from './fixtures'
import { registerViaApi } from './helpers'
import { selfie } from '../tests/unit/ai/selfie-fixtures'
import sharp from 'sharp'

// Phase 4.4: the deterministic outfit engine end to end (the e2e server runs
// the mock AI provider, so every answer is the deterministic fallback).

type Item = { id: string; role: string; layeringRole: string; subcategory: string | null }
type Outfit = { tempId: string; score: number; reasons: string[]; reasonLabels: string[]; explanation: string; items: Item[]; factors: Record<string, number> }

async function add(request: APIRequestContext, name: string, rgb: [number, number, number], patch: Record<string, unknown>) {
  const buffer = await sharp({ create: { width: 300, height: 400, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } }).png().toBuffer()
  const res = await request.post('/api/v1/wardrobe/items', { multipart: { file: { name, mimeType: 'image/png', buffer } } })
  expect(res.status(), `upload ${name}`).toBe(201)
  const id = (await res.json()).item.id as string
  expect((await request.patch(`/api/v1/wardrobe/items/${id}`, { data: patch })).status()).toBe(200)
  return id
}

async function wardrobe(request: APIRequestContext) {
  await add(request, 'oxford-shirt.png', [245, 245, 245], { category: 'shirt', subcategory: 'oxford_shirt', colors: ['white'], sleeveLength: 'long', style: 'smart_casual', formality: 'smart_casual' })
  await add(request, 'tee-shirt.png', [30, 40, 80], { category: 'shirt', subcategory: 'tshirt', colors: ['navy'], sleeveLength: 'short', style: 'casual', formality: 'casual', season: ['summer'] })
  await add(request, 'blue-jeans.png', [40, 70, 150], { category: 'pants', subcategory: 'jeans', colors: ['blue'], style: 'casual', formality: 'casual' })
  await add(request, 'beige-chinos.png', [220, 200, 160], { category: 'pants', subcategory: 'chinos', colors: ['beige'], style: 'smart_casual', formality: 'smart_casual' })
  await add(request, 'white-sneaker.png', [240, 240, 240], { category: 'shoes', subcategory: 'sneakers', colors: ['white'], style: 'casual', formality: 'casual' })
  await add(request, 'black-boot.png', [20, 20, 20], { category: 'shoes', subcategory: 'boots', colors: ['black'], style: 'casual', formality: 'casual' })
  await add(request, 'gray-coat.png', [128, 128, 128], { category: 'outerwear', subcategory: 'coat', colors: ['gray'], material: 'wool', style: 'smart_casual', formality: 'smart_casual' })
}

const generate = async (request: APIRequestContext, data: Record<string, unknown>) => {
  const res = await request.post('/api/v1/outfits/generate', { data })
  expect(res.status()).toBe(200)
  return (await res.json()) as { outfits: Outfit[]; fallback: boolean; message?: string; weatherUsed: unknown }
}
const W = (temperature: number, condition = 'cloudy', precipitationProbability = 10, windSpeed = 8) => ({ temperature, feelsLike: temperature, condition, precipitationProbability, humidity: 60, windSpeed, uvIndex: 2 })
const subs = (o: Outfit) => o.items.map((i) => i.subcategory)
/** The answer without signed image URLs (their expiry follows the clock; everything else must be identical). */
const stable = (body: { outfits: Outfit[] }) => JSON.parse(JSON.stringify(body, (k, v) => (k === 'imageUrl' ? undefined : v)))

test.describe('outfit intelligence', () => {
  test('normal generation: valid compositions, readable labels, explanations; the UI shows labels, not codes', async ({ page }) => {
    await registerViaApi(page.request)
    await wardrobe(page.request)
    const body = await generate(page.request, { occasion: 'casual', weather: W(16), topN: 3 })
    expect(body.fallback).toBe(true) // mock provider
    expect(body.outfits).toHaveLength(3)
    for (const o of body.outfits) {
      expect(o.items.filter((i) => i.layeringRole === 'footwear')).toHaveLength(1)
      expect(o.reasonLabels).toHaveLength(o.reasons.length)
      expect(o.explanation.length).toBeGreaterThan(10)
    }

    await page.goto('/outfits?occasion=casual')
    await expect(page.getByText('Bugungi eng yaxshi variant')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/^(Ob-havoga mos|Tadbirga mos|Ranglar uyg‘un|Neytral asos|Uslub bir xil|Issiq qatlamli)$/).first()).toBeVisible()
    await expect(page.getByText('color_harmony', { exact: true })).toHaveCount(0)
  })

  test('weather-aware: cold adds the coat and drops the t-shirt without a layer; rain adds a protective layer; snow prefers boots', async ({ page }) => {
    await registerViaApi(page.request)
    await wardrobe(page.request)
    const cold = await generate(page.request, { occasion: 'casual', weather: W(0), topN: 3 })
    expect(cold.weatherUsed).toMatchObject({ temperature: 0 })
    expect(subs(cold.outfits[0])).toContain('coat')
    for (const o of cold.outfits) if (subs(o).includes('tshirt')) expect(subs(o)).toContain('coat')
    expect(cold.outfits[0].reasons).toContain('warm_layers')

    const rain = await generate(page.request, { occasion: 'casual', weather: W(14, 'rain', 90), topN: 1 })
    expect(subs(rain.outfits[0])).toContain('coat') // protective layer
    expect(rain.outfits[0].reasonLabels).toContain('Yomg‘irga tayyor')

    const snow = await generate(page.request, { occasion: 'casual', weather: W(-3, 'snow', 80), topN: 1 })
    expect(subs(snow.outfits[0])).toContain('boots')
    expect(snow.outfits[0].reasonLabels).toContain('Qorga mos poyabzal')
  })

  test('colour profile aware: a stored profile changes the scores; deleting it restores them', async ({ page }) => {
    await registerViaApi(page.request)
    await wardrobe(page.request)
    const before = await generate(page.request, { occasion: 'casual', weather: W(16), topN: 3 })
    const buffer = await selfie({ skin: '#f1c9a5', hair: '#3b2416', eyes: '#5a3a22' })
    expect((await page.request.post('/api/v1/color-profile/analyze', { multipart: { file: { name: 'selfie.jpg', mimeType: 'image/jpeg', buffer } } })).status()).toBe(200)
    const after = await generate(page.request, { occasion: 'casual', weather: W(16), topN: 3 })
    expect(after.outfits.map((o) => `${o.tempId}:${o.score}`)).not.toEqual(before.outfits.map((o) => `${o.tempId}:${o.score}`))
    expect((await page.request.delete('/api/v1/color-profile')).status()).toBe(200)
    expect(stable(await generate(page.request, { occasion: 'casual', weather: W(16), topN: 3 }))).toEqual(stable(before))
  })

  test('deterministic: same request, same answer; "another option" seeds give other outfits', async ({ page }) => {
    await registerViaApi(page.request)
    await wardrobe(page.request)
    const req = { occasion: 'casual', weather: W(16), topN: 1 }
    const best = await generate(page.request, req)
    expect(stable(await generate(page.request, req))).toEqual(stable(best))
    const seeded: string[] = []
    for (const seed of [1, 2, 3, 4, 5, 6]) seeded.push((await generate(page.request, { ...req, seed })).outfits[0].tempId)
    expect(new Set(seeded).size).toBeGreaterThan(1)
    expect((await generate(page.request, { ...req, seed: 3 })).outfits[0].tempId).toBe(seeded[2])
  })

  test('insufficient wardrobe: no footwear → no outfits and a clear message', async ({ page }) => {
    await registerViaApi(page.request)
    await add(page.request, 'white-shirt.png', [245, 245, 245], { category: 'shirt', colors: ['white'] })
    await add(page.request, 'blue-jeans.png', [40, 70, 150], { category: 'pants', colors: ['blue'] })
    const body = await generate(page.request, { occasion: 'casual' })
    expect(body.outfits).toEqual([])
    expect(body.fallback).toBe(true)
    expect(body.message).toMatch(/oyoq kiyim/)
  })

  test('saving a generated outfit keeps its labels; an invalid composition is refused', async ({ page }) => {
    await registerViaApi(page.request)
    await wardrobe(page.request)
    const [o] = (await generate(page.request, { occasion: 'casual', weather: W(16), topN: 1 })).outfits
    const items = o.items.map((i) => ({ itemId: i.id, role: i.role }))
    const saved = await page.request.post('/api/v1/outfits', { data: { occasion: 'casual', score: o.score, reasons: o.reasonLabels, explanation: o.explanation, isSaved: true, items } })
    expect(saved.status()).toBe(201)
    expect(JSON.parse((await saved.json()).outfit.reasonsJson)).toEqual(o.reasonLabels)
    const noShoes = items.filter((_, k) => o.items[k].layeringRole !== 'footwear')
    const bad = await page.request.post('/api/v1/outfits', { data: { items: noShoes } })
    expect(bad.status()).toBe(400)
    expect((await bad.json()).code).toBe('VALIDATION_ERROR')
  })
})
