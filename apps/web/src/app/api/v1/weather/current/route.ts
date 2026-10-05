import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireAuth, unauthorized } from '@/lib/api-helpers'
import { withApi, validate } from '@/server/http'
import { getWeatherProvider } from '@/lib/weather/provider'

export const runtime = 'nodejs'

const QuerySchema = z.object({
  lat: z.coerce.number({ error: 'lat va lon parametrlari noto‘g‘ri' }).min(-90).max(90),
  lon: z.coerce.number({ error: 'lat va lon parametrlari noto‘g‘ri' }).min(-180).max(180),
})

// GET /api/v1/weather/current?lat=41.31&lon=69.24
// Returns cached weather if fresh (<30 min), otherwise fetches from the
// provider and persists to weather_cache (spec section 11, 25).
export const GET = withApi(async (req) => {
  const authUser = await requireAuth(req)
  if (!authUser) return unauthorized()

  const url = new URL(req.url)
  const { lat, lon } = validate(
    { lat: url.searchParams.get('lat') || undefined, lon: url.searchParams.get('lon') || undefined },
    QuerySchema,
  )

  // Round to 2 decimal places (~1km resolution) for the cache key. Spec:
  // weather_cache entity.
  const cacheKey = `${lat.toFixed(2)},${lon.toFixed(2)}`
  const now = new Date()
  const ttl = 30 * 60 * 1000 // 30 minutes
  const expiresAt = new Date(now.getTime() + ttl)

  // Try cache first
  const cached = await db.weatherCache.findUnique({ where: { cacheKey } })
  if (cached && cached.expiresAt > now) {
    const data = JSON.parse(cached.dataJson)
    return NextResponse.json({
      weather: { ...data, cached: true },
    })
  }

  // Cache miss → call the provider
  const provider = getWeatherProvider()
  const weather = await provider.getCurrent(lat, lon)

  // Persist to cache (upsert)
  await db.weatherCache.upsert({
    where: { cacheKey },
    update: {
      dataJson: JSON.stringify(weather),
      fetchedAt: now,
      expiresAt,
    },
    create: {
      cacheKey,
      dataJson: JSON.stringify(weather),
      fetchedAt: now,
      expiresAt,
    },
  })

  return NextResponse.json({ weather: { ...weather, cached: false } })
})
