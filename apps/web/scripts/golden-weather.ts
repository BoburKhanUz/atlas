/**
 * Golden vectors of the weather provider for the Go backend (stage B5):
 * what the real Open-Meteo provider of this app makes of an answer, the
 * address it asks, and Number.prototype.toFixed(2) on coordinates.
 *
 *   bun scripts/golden-weather.ts ../api/testdata/golden/weather.json
 *
 * The answers here are complete and taken at local hour 00, where the Go
 * server and this one agree; where they differ on purpose (incomplete
 * answers, the six-hour window later in the day) is in docs/plan/B5.md.
 */
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { getWeatherProvider, roundCoordinate } from '../src/lib/weather/provider'

delete process.env.WEATHER_PROVIDER
const provider = getWeatherProvider()
if (provider.name !== 'open-meteo') throw new Error('the Open-Meteo provider is not the default')

const realFetch = globalThis.fetch
let asked = ''
let reply: unknown = null
globalThis.fetch = (async (input: unknown) => {
  asked = String(input)
  return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } })
}) as typeof fetch

const hours = Array.from({ length: 48 }, (_, i) => {
  const day = i < 24 ? '2026-11-27' : '2026-11-28'
  return `${day}T${String(i % 24).padStart(2, '0')}:00`
})

interface Current {
  temperature_2m: number
  relative_humidity_2m: number
  apparent_temperature: number
  weather_code: number
  wind_speed_10m: number
  uv_index: number
  precipitation: number
}

function answer(current: Current, probability: (number | null)[]) {
  return {
    latitude: 41.3,
    longitude: 69.2,
    utc_offset_seconds: 18000,
    timezone: 'Asia/Tashkent',
    current: { time: '2026-11-27T00:15', interval: 900, is_day: 0, ...current },
    hourly: { time: hours, precipitation_probability: probability },
  }
}

const mild: Current = {
  temperature_2m: 8.6,
  relative_humidity_2m: 88,
  apparent_temperature: 6.8,
  weather_code: 3,
  wind_speed_10m: 6.0,
  uv_index: 1.85,
  precipitation: 0,
}
const flat = (first: number[]) => [...first, ...Array.from({ length: 48 - first.length }, () => 0)]

const bodies: { name: string; body: ReturnType<typeof answer> }[] = []
for (let code = -1; code <= 100; code++) {
  bodies.push({ name: `code ${code}`, body: answer({ ...mild, weather_code: code }, flat([94, 85, 78, 76, 77, 76, 73])) })
}
bodies.push({ name: 'code 2.5', body: answer({ ...mild, weather_code: 2.5 }, flat([0])) })
for (const t of [0.5, 1.5, 2.5, -0.5, -1.5, -2.5, -0.4, 0.49999999999999994, 14.5, -14.5, 21.4999, 35, -40]) {
  bodies.push({
    name: `temperature ${t}`,
    body: answer({ ...mild, temperature_2m: t, apparent_temperature: -t, relative_humidity_2m: 50 + t / 10, wind_speed_10m: Math.abs(t) + 0.5 }, flat([0])),
  })
}
const windows: (number | null)[][] = [
  [0, 0, 0, 0, 0, 1],
  [1, 2, 3, 4, 5, 6],
  [100, 100, 100, 100, 100, 100],
  [0, 0, 0, 0, 0, 3],
  [5, 0, 0, 0, 0, 4],
  [33, 34, 33, 34, 33, 34],
  [null, 10, null, 21, 30, 40],
  [7, null, null, null, null, null],
  [1, 0, 0, 0, 0, 2],
]
for (const w of windows) {
  bodies.push({ name: `window ${JSON.stringify(w)}`, body: answer(mild, [...w, ...Array.from({ length: 42 }, () => 99)]) })
}
for (const [uv, rain] of [[0, 0], [11.3, 0.1], [7, 12.75], [0.05, 0.3]]) {
  bodies.push({ name: `uv ${uv} rain ${rain}`, body: answer({ ...mild, uv_index: uv, precipitation: rain }, flat([50])) })
}

const answers: unknown[] = []
for (const { name, body } of bodies) {
  reply = body
  const { fetchedAt, ...weather } = await provider.getCurrent(41.31, 69.24)
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(fetchedAt)) throw new Error(`fetchedAt ${fetchedAt}`)
  answers.push({ name, body: JSON.stringify(body), weather })
}

const coordinates = [
  0, -0, 0.001, -0.001, 0.004, 0.005, 0.0049999, 0.125, -0.125, 0.375, 1.005, 1.015, 1.025, 41.31, 41.311482, 41.315,
  41.125, 41.375, 41.625, 41.875, 69.24, 69.245, 69.2401, -33.865, -33.875, 89.999, 89.995, 90, -90, 179.995, 179.999,
  180, -180, 2.5e-7, -2.5e-7, 12.3456789, 0.994999, 0.995, 9.995, 99.995, 100.125, 1e-10,
]
const fixed = coordinates.map((value) => ({ value: Object.is(value, -0) ? '-0' : String(value), fixed: roundCoordinate(value) }))

const addresses: unknown[] = []
reply = answer(mild, flat([0]))
for (const [lat, lon] of [[41.311482, 69.240562], [-33.865, 151.209444], [0, -0], [-0.001, 0.125], [89.999, -179.999], [51.5, -0.12]]) {
  await provider.getCurrent(lat, lon)
  const url = new URL(asked)
  addresses.push({
    lat: Object.is(lat, -0) ? '-0' : String(lat),
    lon: Object.is(lon, -0) ? '-0' : String(lon),
    origin: url.origin,
    path: url.pathname,
    latitude: url.searchParams.get('latitude'),
    longitude: url.searchParams.get('longitude'),
    current: url.searchParams.get('current'),
    hourly: url.searchParams.get('hourly'),
    timezone: url.searchParams.get('timezone'),
  })
}
globalThis.fetch = realFetch

const out = {
  generatedBy: 'apps/web/scripts/golden-weather.ts',
  sourceCommit: execSync('git rev-parse HEAD').toString().trim(),
  note: 'What the Next.js Open-Meteo provider makes of complete answers taken at local hour 00, the address it asks, and toFixed(2).',
  answers,
  fixed,
  addresses,
}
writeFileSync(process.argv[2], JSON.stringify(out, null, 1) + '\n')
console.log(`${answers.length} answers, ${fixed.length} coordinates, ${addresses.length} addresses`)
