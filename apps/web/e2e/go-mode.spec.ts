import { expect, request as playwrightRequest, test } from '@playwright/test'
import sharp from 'sharp'
import { CONSENT, uniqueUser } from './helpers'

/**
 * Go mode only (E2E_GO=1; playwright.config.ts leaves this file out of the
 * default run): the front proxy sends the operations the Go server serves
 * (auth, legal texts and consent, profile, password reset, account deletion,
 * the wardrobe and its images, the weather, outfit generation and the saved
 * outfits) to Go and everything else to Next.js. This spec proves the routing, so the
 * other specs really ran against Go, and that the two servers work on each
 * other's sessions in both directions.
 */
test.describe('Go mode routing', () => {
  test('the operations Go serves are served by Go, the rest by Next.js, on one session', async ({ request }) => {
    const user = uniqueUser('go')
    const register = await request.post('/api/v1/auth/register', { data: { ...user, ...CONSENT } })
    expect(register.status()).toBe(201)
    expect(register.headers()['x-e2e-backend']).toBe('go')

    // The cookies Go set authenticate a Next.js route …
    const conversations = await request.get('/api/v1/stylist/conversations')
    expect(conversations.status()).toBe(200)
    expect(conversations.headers()['x-e2e-backend']).toBe('next')
    // … and Go's own.
    const me = await request.get('/api/v1/auth/me')
    expect(me.status()).toBe(200)
    expect(me.headers()['x-e2e-backend']).toBe('go')
    expect((await me.json()).user.email).toBe(user.email)

    // The account operations of stage B3.
    const legal = await request.get('/api/v1/legal')
    expect(legal.status()).toBe(200)
    expect(legal.headers()['x-e2e-backend']).toBe('go')
    const consent = await request.post('/api/v1/legal/consent', { data: CONSENT })
    expect(consent.status()).toBe(200)
    expect(consent.headers()['x-e2e-backend']).toBe('go')
    const changed = await request.patch('/api/v1/profile', { data: { name: 'Go Mode', preferences: { preferredStyles: ['casual'] } } })
    expect(changed.status()).toBe(200)
    expect(changed.headers()['x-e2e-backend']).toBe('go')
    const profile = await request.get('/api/v1/profile')
    expect(profile.status()).toBe(200)
    expect(profile.headers()['x-e2e-backend']).toBe('go')
    expect((await profile.json()).preferences.preferredStyles).toEqual(['casual'])
    const forgot = await request.post('/api/v1/auth/password/forgot', { data: { email: user.email } })
    expect(forgot.status()).toBe(200)
    expect(forgot.headers()['x-e2e-backend']).toBe('go')
    const reset = await request.post('/api/v1/auth/password/reset', { data: { token: 'not-a-token', password: user.password } })
    expect(reset.status()).toBe(400)
    expect(reset.headers()['x-e2e-backend']).toBe('go')

    // The wardrobe of stage B4: upload, list, read, correct, the images, delete.
    const picture = await sharp({ create: { width: 320, height: 320, channels: 3, background: { r: 245, g: 245, b: 245 } } }).png().toBuffer()
    const upload = await request.post('/api/v1/wardrobe/items', {
      headers: { 'Idempotency-Key': `go-mode-${Date.now()}` },
      multipart: { file: { name: 'white-shirt.png', mimeType: 'image/png', buffer: picture } },
    })
    expect(upload.status()).toBe(201)
    expect(upload.headers()['x-e2e-backend']).toBe('go')
    const { item, detection } = await upload.json()
    expect(detection).toMatchObject({ category: 'shirt', mock: true })
    const list = await request.get('/api/v1/wardrobe/items?category=shirt&limit=10')
    expect(list.status()).toBe(200)
    expect(list.headers()['x-e2e-backend']).toBe('go')
    expect((await list.json()).items.map((i: { id: string }) => i.id)).toEqual([item.id])
    const read = await request.get(`/api/v1/wardrobe/items/${item.id}`)
    expect(read.status()).toBe(200)
    expect(read.headers()['x-e2e-backend']).toBe('go')
    const corrected = await request.patch(`/api/v1/wardrobe/items/${item.id}`, { data: { fit: 'slim' } })
    expect(corrected.status()).toBe(200)
    expect(corrected.headers()['x-e2e-backend']).toBe('go')
    expect((await corrected.json()).corrections).toHaveLength(1)
    // A link Go signed opens on Go, and no longer with another signature.
    // (That both servers sign and verify alike is proved by the golden
    // vectors of apps/api/testdata/golden/media.json, not here.)
    const image = await request.get(item.primaryImage.url)
    expect(image.status()).toBe(200)
    expect(image.headers()['x-e2e-backend']).toBe('go')
    expect(image.headers()['content-type']).toBe('image/webp')
    expect((await request.get(item.primaryImage.url.replace(/sig=.{4}/, 'sig=AAAA'))).status()).toBe(404)
    // The weather and the outfits of stage B5: the weather, outfits made of
    // the wardrobe, one saved, listed, read, renamed, given feedback, deleted.
    const weather = await request.get('/api/v1/weather/current?lat=41.311482&lon=69.240562')
    expect(weather.status()).toBe(200)
    expect(weather.headers()['x-e2e-backend']).toBe('go')
    expect((await weather.json()).weather).toMatchObject({ source: 'mock', temperature: 28 })
    const garment = async (name: string, rgb: [number, number, number]) => {
      const buffer = await sharp({ create: { width: 320, height: 320, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } }).png().toBuffer()
      const res = await request.post('/api/v1/wardrobe/items', {
        headers: { 'Idempotency-Key': `go-mode-${name.replace(/[^A-Za-z0-9]/g, '-')}-${Date.now()}` },
        multipart: { file: { name, mimeType: 'image/png', buffer } },
      })
      expect(res.status(), name).toBe(201)
      return (await res.json()).item.id as string
    }
    await garment('blue-jeans.png', [40, 70, 150])
    await garment('white-sneaker.png', [240, 240, 240])
    const generate = await request.post('/api/v1/outfits/generate', { data: { occasion: 'casual', lat: 41.311482, lon: 69.240562 } })
    expect(generate.status()).toBe(200)
    expect(generate.headers()['x-e2e-backend']).toBe('go')
    const generated = await generate.json()
    expect(generated).toMatchObject({ fallback: true, occasion: 'casual', wardrobeItemCount: 3, weatherUsed: { temperature: 28, condition: 'partly_cloudy' } })
    expect(generated.outfits.length).toBeGreaterThan(0)
    const made = generated.outfits[0]
    expect(made.items.map((i: { id: string }) => i.id)).toContain(item.id)
    expect(typeof made.explanation).toBe('string')
    const save = await request.post('/api/v1/outfits', {
      data: {
        items: made.items.map((i: { id: string; role: string }) => ({ itemId: i.id, role: i.role })),
        occasion: 'casual',
        weather: generated.weatherUsed,
        score: made.score,
        reasons: made.reasons,
        explanation: made.explanation,
      },
    })
    expect(save.status()).toBe(201)
    expect(save.headers()['x-e2e-backend']).toBe('go')
    const outfitId = (await save.json()).outfit.id as string
    const feedback = await request.post(`/api/v1/outfits/${outfitId}/feedback`, { data: { feedback: 'saved' } })
    expect(feedback.status()).toBe(201)
    expect(feedback.headers()['x-e2e-backend']).toBe('go')
    const renamed = await request.patch(`/api/v1/outfits/${outfitId}`, { data: { name: 'Go mode' } })
    expect(renamed.status()).toBe(200)
    expect(renamed.headers()['x-e2e-backend']).toBe('go')
    const savedList = await request.get('/api/v1/outfits?saved=1')
    expect(savedList.status()).toBe(200)
    expect(savedList.headers()['x-e2e-backend']).toBe('go')
    expect((await savedList.json()).outfits.map((o: { id: string; name: string }) => [o.id, o.name])).toEqual([[outfitId, 'Go mode']])
    const detail = await request.get(`/api/v1/outfits/${outfitId}`)
    expect(detail.status()).toBe(200)
    expect(detail.headers()['x-e2e-backend']).toBe('go')
    expect((await detail.json()).outfit.items).toHaveLength(made.items.length)
    const dropped = await request.delete(`/api/v1/outfits/${outfitId}`)
    expect(dropped.status()).toBe(200)
    expect(dropped.headers()['x-e2e-backend']).toBe('go')
    expect((await request.get(`/api/v1/outfits/${outfitId}`)).status()).toBe(404)

    const removed = await request.delete(`/api/v1/wardrobe/items/${item.id}`)
    expect(removed.status()).toBe(200)
    expect(removed.headers()['x-e2e-backend']).toBe('go')
    expect((await request.get(item.primaryImage.url)).status()).toBe(404)

    for (const path of ['/api/v1/auth/refresh', '/api/v1/auth/logout']) {
      const res = await request.post(path)
      expect(res.status(), path).toBe(200)
      expect(res.headers()['x-e2e-backend'], path).toBe('go')
    }
    // Signed out by Go: Go refuses the session at once.
    expect((await request.get('/api/v1/auth/me')).status()).toBe(401)

    const login = await request.post('/api/v1/auth/login', { data: { email: user.email, password: user.password } })
    expect(login.status()).toBe(200)
    expect(login.headers()['x-e2e-backend']).toBe('go')
    expect((await request.get('/api/health')).headers()['x-e2e-backend']).toBe('next')

    // Go deletes the account: its session is refused at once.
    const deleted = await request.delete('/api/v1/account')
    expect(deleted.status()).toBe(200)
    expect(deleted.headers()['x-e2e-backend']).toBe('go')
    expect((await request.get('/api/v1/auth/me')).status()).toBe(401)
  })

  test('the weather and outfit routes answer as the Next.js routes do, on the same data', async ({ request, baseURL }) => {
    // Both servers behind the proxy, asked directly (playwright.config.ts: Next.js on port + 10, Go on port + 20).
    const at = (offset: number) => baseURL!.replace(/:(\d+)$/, (_, port: string) => `:${Number(port) + offset}`)
    const next = at(10)
    const go = at(20)
    const user = uniqueUser('gop')
    expect((await request.post('/api/v1/auth/register', { data: { ...user, ...CONSENT } })).status()).toBe(201)
    for (const [name, rgb] of [['white-shirt.png', [245, 245, 245]], ['blue-jeans.png', [40, 70, 150]], ['white-sneaker.png', [240, 240, 240]], ['black-coat.png', [20, 20, 20]]] as const) {
      const buffer = await sharp({ create: { width: 320, height: 320, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } }).png().toBuffer()
      const res = await request.post('/api/v1/wardrobe/items', { multipart: { file: { name, mimeType: 'image/png', buffer } } })
      expect(res.status(), name).toBe(201)
    }

    // What differs by design between two answers to one request: link signatures and their expiry, ids and
    // times of rows a request made, the request id of an error.
    const same = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(same)
      if (value && typeof value === 'object') {
        return Object.fromEntries(
          Object.entries(value).map(([k, v]) => {
            if (['urlExpiresAt', 'requestId', 'fetchedAt', 'cached'].includes(k)) return [k, '<varies>']
            if (typeof v === 'string' && /[?&]exp=\d+&sig=/.test(v)) return [k, v.replace(/exp=\d+&sig=[^&]+/, '<signature>')]
            return [k, same(v)]
          }),
        )
      }
      return value
    }
    const made = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(made)
      if (value && typeof value === 'object') {
        return Object.fromEntries(
          Object.entries(value).map(([k, v]) => (['id', 'outfitId', 'createdAt', 'updatedAt'].includes(k) && typeof v === 'string' ? [k, '<made>'] : [k, made(v)])),
        )
      }
      return value
    }
    type Answer = { status: number; body: any }
    const ask = async (server: string, method: 'get' | 'post' | 'patch', path: string, data?: unknown): Promise<Answer> => {
      const res = await request[method](server + path, data === undefined ? undefined : { data })
      return { status: res.status(), body: same(await res.json()) }
    }
    const both = async (method: 'get' | 'post' | 'patch', path: string, data?: unknown): Promise<[Answer, Answer]> => [
      await ask(next, method, path, data),
      await ask(go, method, path, data),
    ]

    const [nextWeather, goWeather] = await both('get', '/api/v1/weather/current?lat=41.311482&lon=69.240562')
    expect(goWeather).toEqual(nextWeather)

    // Generation reads only: the two answers are equal, whatever is asked.
    const cold = { temperature: -4, feelsLike: -9, condition: 'snow', precipitationProbability: 80, humidity: 85, windSpeed: 22, uvIndex: 1 }
    for (const body of [
      {},
      { occasion: 'work' },
      { occasion: 'date', weather: cold, topN: 5 },
      { weather: { ...cold, temperature: 31, feelsLike: 34, condition: 'clear', precipitationProbability: 0 }, topN: 1 },
      { lat: 41.311482, lon: 69.240562, occasion: 'casual' },
      { seed: 7 },
      { seed: 123456.5, topN: 2, occasion: 'sport' },
      { topN: 9 },
      { occasion: 'moon' },
      { weather: { temperature: 20 } },
    ]) {
      const [fromNext, fromGo] = await both('post', '/api/v1/outfits/generate', body)
      expect(fromGo, JSON.stringify(body)).toEqual(fromNext)
    }
    const [generated] = await both('post', '/api/v1/outfits/generate', { occasion: 'casual', weather: cold })
    const outfit = generated.body.outfits[0]
    const items = outfit.items.map((i: { id: string; role: string }) => ({ itemId: i.id, role: i.role }))

    // Saving: the same body to each; what each stored and answered differs in ids and times only.
    const saves = [
      { items, occasion: 'casual', weather: cold, name: '  Qish  ', score: outfit.score + 0.5, reasons: outfit.reasons, explanation: outfit.explanation, isSaved: true },
      { items },
      { items: items.slice(0, 1) },
      { items: [...items, items[0]] },
      { items: items.map((i: { itemId: string }) => ({ ...i, role: 'hat' })) },
      { items: [{ itemId: 'c-not-mine', role: 'top' }, ...items] },
      { items: items.map((i: { itemId: string; role: string }) => ({ ...i, role: i.role === 'shoes' ? 'top' : i.role })) },
      { items: [] },
    ]
    const stored: string[][] = []
    for (const body of saves) {
      const [fromNext, fromGo] = await both('post', '/api/v1/outfits', body)
      expect(made(fromGo), JSON.stringify(body)).toEqual(made(fromNext))
      if (fromNext.status === 201) stored.push([fromNext.body.outfit.id, fromGo.body.outfit.id])
    }
    expect(stored).toHaveLength(2)

    // Changes and feedback: the same to the outfit each server stored.
    for (const [method, suffix, body] of [
      ['patch', '', { isSaved: true, name: '  Yangi nom ' }],
      ['patch', '', { name: null }],
      ['patch', '', {}],
      ['post', '/feedback', { feedback: 'saved', note: ' yoqdi ' }],
      ['post', '/feedback', { feedback: 'rejected' }],
      ['post', '/feedback', { feedback: 'liked' }],
      ['post', '/feedback', { feedback: 'loved' }],
    ] as const) {
      const fromNext = await request[method](`${next}/api/v1/outfits/${stored[0][0]}${suffix}`, { data: body })
      const fromGo = await request[method](`${go}/api/v1/outfits/${stored[0][1]}${suffix}`, { data: body })
      expect(fromGo.status(), JSON.stringify(body)).toBe(fromNext.status())
      expect(made(same(await fromGo.json())), JSON.stringify(body)).toEqual(made(same(await fromNext.json())))
    }

    // Reading: the same rows, read by each.
    for (const [nextId, goId] of stored) {
      for (const id of [nextId, goId]) {
        const [fromNext, fromGo] = await both('get', `/api/v1/outfits/${id}`)
        expect(fromGo).toEqual(fromNext)
      }
    }
    for (const query of ['', '?saved=1', '?saved=false', '?saved=maybe']) {
      const [fromNext, fromGo] = await both('get', `/api/v1/outfits${query}`)
      // The list of Go carries the images' dimensions; the Next.js list answered null for them (docs/plan/B5.md).
      const withoutDimensions = (answer: Answer) => ({
        ...answer,
        body: answer.body.outfits
          ? { outfits: answer.body.outfits.map((o: any) => ({ ...o, items: o.items.map((i: any) => ({ ...i, image: i.image && { ...i.image, width: null, height: null } })) })) }
          : answer.body,
      })
      expect(withoutDimensions(fromGo), query).toEqual(withoutDimensions(fromNext))
      // Four outfits were stored, two by each server; the feedback above left none of them saved.
      if (fromGo.status === 200) expect(fromGo.body.outfits.length, query).toBe(query === '?saved=1' ? 0 : 4)
    }
    // A saved one, so that the saved list is compared with something in it.
    expect((await request.patch(`${go}/api/v1/outfits/${stored[1][0]}`, { data: { isSaved: true } })).status()).toBe(200)
    const [savedNext, savedGo] = await both('get', '/api/v1/outfits?saved=1')
    expect(savedGo.body.outfits.map((o: { id: string }) => o.id)).toEqual([stored[1][0]])
    expect(savedGo.body.outfits[0].items[0].image).not.toBeNull()
    expect({ ...savedGo.body.outfits[0], items: [] }).toEqual({ ...savedNext.body.outfits[0], items: [] })
    const [missingNext, missingGo] = await both('get', '/api/v1/outfits/c-none')
    expect(missingGo).toEqual(missingNext)
  })

  test('Go rotates and replays a session that Next.js rotated', async ({ page, baseURL }) => {
    const user = uniqueUser('gox')
    expect((await page.request.post('/api/v1/auth/register', { data: { ...user, ...CONSENT } })).status()).toBe(201)
    const cookie = async (name: string) => (await page.context().cookies()).find((c) => c.name === name)?.value
    const rt0 = (await cookie('atlas_rt'))! // written by Go

    // A page load with only the refresh cookie: the Next.js page proxy
    // rotates the session (it writes the new row and the old row's ciphertext).
    await page.context().clearCookies({ name: 'atlas_at' })
    await page.goto('/wardrobe')
    await expect(page).toHaveURL(/\/wardrobe$/)
    const rt1 = (await cookie('atlas_rt'))! // written by Next.js
    expect(rt1).not.toBe(rt0)

    // The old token again, to Go, moments later: a grace replay, served from
    // the ciphertext Next.js stored. Go answers with the token Next.js issued.
    const stale = await playwrightRequest.newContext({ baseURL, extraHTTPHeaders: { cookie: `atlas_rt=${rt0}` } })
    const replay = await stale.post('/api/v1/auth/refresh')
    expect(replay.status()).toBe(200)
    expect(replay.headers()['x-e2e-backend']).toBe('go')
    const replayed = replay.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie' && h.value.startsWith('atlas_rt='))
    expect(replayed.map((h) => h.value.split(';')[0])).toEqual([`atlas_rt=${rt1}`])
    await stale.dispose()

    // Go rotates the session row Next.js wrote …
    const rotated = await page.request.post('/api/v1/auth/refresh')
    expect(rotated.status()).toBe(200)
    expect(rotated.headers()['x-e2e-backend']).toBe('go')
    const rt2 = (await cookie('atlas_rt'))!
    expect(rt2).not.toBe(rt1)
    // … and Next.js goes on with the one Go wrote.
    await page.context().clearCookies({ name: 'atlas_at' })
    await page.goto('/wardrobe')
    await expect(page).toHaveURL(/\/wardrobe$/)
    expect(await cookie('atlas_rt')).not.toBe(rt2)
    const conversations = await page.request.get('/api/v1/stylist/conversations')
    expect(conversations.status()).toBe(200)
    expect(conversations.headers()['x-e2e-backend']).toBe('next')
  })
})
