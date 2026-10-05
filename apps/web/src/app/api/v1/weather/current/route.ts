import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth, unauthorized } from '@/lib/api-helpers'
import { withApi, validate } from '@/server/http'
import { getWeatherProvider } from '@/lib/weather/provider'
import { WeatherQuery } from '@/server/schemas/requests'

export const runtime = 'nodejs'

export const GET = withApi(async (req) => {
  const authUser = await requireAuth(req)
  if (!authUser) return unauthorized()

  const url = new URL(req.url)
  const { lat, lon } = validate(
    { lat: url.searchParams.get('lat') || undefined, lon: url.searchParams.get('lon') || undefined },
    WeatherQuery,
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
