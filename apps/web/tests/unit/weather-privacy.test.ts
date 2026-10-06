/**
 * Phase 4.5 privacy: the weather service (a third party) receives the
 * location rounded to 2 decimals (≈ 1.1 km), as the mobile app sends it —
 * never the precise coordinates a browser can report.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getWeatherProvider, roundCoordinate, setWeatherProviderForTesting } from '@/lib/weather/provider'

afterEach(() => {
  vi.unstubAllGlobals()
  setWeatherProviderForTesting(null as never)
})

describe('weather location privacy', () => {
  it('rounds to 2 decimals', () => {
    expect([roundCoordinate(41.311081), roundCoordinate(69.279737), roundCoordinate(-0.004)]).toEqual(['41.31', '69.28', '-0.00'])
  })

  it('the Open-Meteo request carries only the rounded coordinates', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url)
      return new Response(JSON.stringify({ current: { temperature_2m: 20, weather_code: 0 }, hourly: { precipitation_probability: [] } }), { status: 200 })
    })
    const saved = process.env.WEATHER_PROVIDER
    process.env.WEATHER_PROVIDER = 'open-meteo'
    setWeatherProviderForTesting(null as never)
    try {
      await getWeatherProvider().getCurrent(41.3110812, 69.2797371)
    } finally {
      process.env.WEATHER_PROVIDER = saved
    }
    expect(urls).toHaveLength(1)
    expect(urls[0]).toContain('latitude=41.31&longitude=69.28')
    expect(urls[0]).not.toMatch(/41\.311|69\.279/)
  })
})
