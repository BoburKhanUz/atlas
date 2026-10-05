/**
 * Weather provider abstraction (spec section 11).
 *
 * Two implementations:
 *   - OpenMeteoProvider (default, real Open-Meteo API)
 *   - MockWeatherProvider (deterministic fallback, clearly labeled)
 *
 * The recommendation engine + stylist never call a provider directly — they
 * go through `getWeatherProvider()`. To add Yandex Weather later, implement
 * `WeatherProvider` and switch the env var.
 */

export interface CurrentWeather {
  temperature: number
  feelsLike: number
  condition: string // clear | partly_cloudy | cloudy | rain | thunderstorm | snow | fog
  conditionLabel: string // Uzbek human label
  precipitationProbability: number // 0-100
  precipitationAmount: number // mm
  humidity: number // %
  windSpeed: number // km/h
  uvIndex: number
  /** Source provider name — UI may display. */
  source: string
  fetchedAt: string // ISO
}

export interface WeatherProvider {
  name: string
  getCurrent(lat: number, lon: number): Promise<CurrentWeather>
}

// ─── WMO weather code → Uzbek label + canonical condition id ─────────────────
// Open-Meteo returns numeric WMO codes; map them to our canonical conditions.
const WMO_MAP: Record<number, { id: string; label: string }> = {
  0: { id: 'clear', label: 'Ochiq osmon' },
  1: { id: 'partly_cloudy', label: 'Qisman bulutli' },
  2: { id: 'partly_cloudy', label: 'Qisman bulutli' },
  3: { id: 'cloudy', label: 'Bulutli' },
  45: { id: 'fog', label: 'Tuman' },
  48: { id: 'fog', label: 'Tuman' },
  51: { id: 'rain', label: 'Yengin yomg\'ir' },
  53: { id: 'rain', label: 'Yomg\'ir' },
  55: { id: 'rain', label: 'Yomg\'ir' },
  56: { id: 'rain', label: 'Yomg\'ir (muz) ' },
  57: { id: 'rain', label: 'Yomg\'ir (muz)' },
  61: { id: 'rain', label: 'Yengin yomg\'ir' },
  63: { id: 'rain', label: 'Yomg\'ir' },
  65: { id: 'rain', label: 'Kuchli yomg\'ir' },
  66: { id: 'rain', label: 'Yomg\'ir (muz)' },
  67: { id: 'rain', label: 'Kuchli yomg\'ir (muz)' },
  71: { id: 'snow', label: 'Yengin qor' },
  73: { id: 'snow', label: 'Qor' },
  75: { id: 'snow', label: 'Kuchli qor' },
  77: { id: 'snow', label: 'Donador qor' },
  80: { id: 'rain', label: 'Yomg\'ir yog\'inlari' },
  81: { id: 'rain', label: 'Yomg\'ir' },
  82: { id: 'rain', label: 'Kuchli yomg\'ir' },
  85: { id: 'snow', label: 'Qor yog\'inlari' },
  86: { id: 'snow', label: 'Kuchli qor yog\'inlari' },
  95: { id: 'thunderstorm', label: 'Momaqaldiroq' },
  96: { id: 'thunderstorm', label: 'Momaqaldiroq (do\'l) ' },
  99: { id: 'thunderstorm', label: 'Kuchli momaqaldiroq' },
}

function mapWmo(code: number): { id: string; label: string } {
  return WMO_MAP[code] ?? { id: 'cloudy', label: 'Bulutli' }
}

// ─── Open-Meteo provider ─────────────────────────────────────────────────────
class OpenMeteoProvider implements WeatherProvider {
  name = 'open-meteo'

  async getCurrent(lat: number, lon: number): Promise<CurrentWeather> {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
      '&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m,uv_index,precipitation' +
      '&hourly=precipitation_probability' +
      '&forecast_days=1' +
      '&timezone=auto'

    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(5000) })
    if (!res.ok) {
      throw new Error(`Open-Meteo error ${res.status}`)
    }
    const data = await res.json()

    const cur = data.current ?? {}
    const wmo = typeof cur.weather_code === 'number' ? cur.weather_code : 0
    const cond = mapWmo(wmo)

    // Take the next 6 hours of precipitation probability and average — gives
    // a forward-looking estimate rather than just "right now".
    const hourlyProb: number[] = data.hourly?.precipitation_probability ?? []
    const slice = hourlyProb.slice(0, 6).filter((n: unknown): n is number => typeof n === 'number')
    const avgProb =
      slice.length > 0 ? Math.round(slice.reduce((a, b) => a + b, 0) / slice.length) : 0

    return {
      temperature: Math.round(cur.temperature_2m ?? 0),
      feelsLike: Math.round(cur.apparent_temperature ?? cur.temperature_2m ?? 0),
      condition: cond.id,
      conditionLabel: cond.label,
      precipitationProbability: avgProb,
      precipitationAmount: Number(cur.precipitation ?? 0),
      humidity: Math.round(cur.relative_humidity_2m ?? 0),
      windSpeed: Math.round(cur.wind_speed_10m ?? 0),
      uvIndex: Number(cur.uv_index ?? 0),
      source: this.name,
      fetchedAt: new Date().toISOString(),
    }
  }
}

// ─── Mock provider (used when network unavailable, clearly labeled) ─────────
class MockWeatherProvider implements WeatherProvider {
  name = 'mock'

  async getCurrent(): Promise<CurrentWeather> {
    return {
      temperature: 28,
      feelsLike: 31,
      condition: 'partly_cloudy',
      conditionLabel: 'Qisman bulutli (demo)',
      precipitationProbability: 20,
      precipitationAmount: 0,
      humidity: 55,
      windSpeed: 12,
      uvIndex: 7,
      source: this.name,
      fetchedAt: new Date().toISOString(),
    }
  }
}

// Singleton
let _provider: WeatherProvider | null = null

export function getWeatherProvider(): WeatherProvider {
  if (_provider) return _provider
  const env = process.env.WEATHER_PROVIDER?.toLowerCase()
  if (env === 'mock') {
    _provider = new MockWeatherProvider()
  } else {
    _provider = new OpenMeteoProvider()
  }
  return _provider
}

export function setWeatherProviderForTesting(p: WeatherProvider) {
  _provider = p
}
