import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { DemoManifest, demoCredentials, manifestErrors, photoMimeType } from '@/server/demo/manifest'

const example = JSON.parse(readFileSync(path.resolve(__dirname, '../../demo/manifest.example.json'), 'utf8'))
const item = example.items[0]
const errors = (m: unknown) => {
  const r = DemoManifest.safeParse(m)
  return r.success ? [] : manifestErrors(r.error)
}

describe('demo manifest', () => {
  it('the example manifest is valid and covers tops, bottoms and shoes', () => {
    const m = DemoManifest.parse(example)
    expect(new Set(m.items.map((i) => i.category))).toEqual(new Set(['shirt', 'pants', 'shoes', 'outerwear', 'bag']))
    expect(m.items.every((i) => i.colors.length > 0 && i.season.length > 0)).toBe(true)
  })

  it('omitted attributes become null', () => {
    const m = DemoManifest.parse({ name: 'A', items: [{ file: 'a.jpg', category: 'shoes', colors: ['white'], season: ['summer'] }] })
    expect(m.items[0]).toMatchObject({ subcategory: null, pattern: null, fit: null, formality: null })
    expect(m.preferences).toEqual({ preferredStyles: [], favoriteColors: [] })
  })

  it('rejects values outside the catalog, a subcategory of another category and unknown fields', () => {
    expect(errors({ ...example, items: [{ ...item, colors: ['neon'] }] })[0]).toMatch(/^items\.0\.colors\.0/)
    expect(errors({ ...example, items: [{ ...item, subcategory: 'jeans' }] })).toEqual(['items.0.subcategory: jeans is not a shirt subcategory'])
    expect(errors({ ...example, items: [{ ...item, price: 10 }] })[0]).toMatch(/^items\.0/)
    expect(errors({ ...example, items: [{ ...item, colors: [] }] })[0]).toMatch(/^items\.0\.colors/)
  })

  it('photos: image extensions only, inside the manifest folder, each once', () => {
    expect(errors({ ...example, items: [{ ...item, file: 'a.gif' }] })[0]).toMatch(/photo must be/)
    expect(errors({ ...example, items: [{ ...item, file: '../secret.jpg' }] })[0]).toMatch(/inside the manifest folder/)
    expect(errors({ ...example, items: [{ ...item, file: '/etc/a.jpg' }] })[0]).toMatch(/inside the manifest folder/)
    expect(errors({ ...example, items: [item, item] })).toEqual(['items.1.file: the same photo twice'])
    expect([photoMimeType('a.PNG'), photoMimeType('a.webp'), photoMimeType('a.jpeg')]).toEqual(['image/png', 'image/webp', 'image/jpeg'])
  })

  it('credentials come from the environment and are checked', () => {
    expect(demoCredentials({ DEMO_EMAIL: ' Demo@Atlas.UZ ', DEMO_PASSWORD: '12345678' })).toEqual({ email: 'demo@atlas.uz', password: '12345678' })
    expect(() => demoCredentials({ DEMO_PASSWORD: '12345678' })).toThrow(/DEMO_EMAIL/)
    expect(() => demoCredentials({ DEMO_EMAIL: 'demo@atlas.uz', DEMO_PASSWORD: 'short' })).toThrow(/DEMO_PASSWORD/)
  })
})
