/**
 * Catalog drift between the server's catalog (apps/api/internal/catalog/
 * catalog.json, the source of the API ids, read through scripts/ai-eval/catalog.ts)
 * and the mobile app's own Dart copies. Entries are keyed by
 * domain + id: the same id may exist in several domains (knit is a
 * subcategory and a material, casual a style, formality and occasion).
 *
 * - Ids must match exactly in every domain.
 * - Labels and colour swatches may still differ, but only as recorded below,
 *   with both current values. A new difference fails, and so does a recorded
 *   one that no longer holds (remove it once the clients agree). The open
 *   terminology decisions are in docs/ai/uzbek-output-policy.md.
 */
import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import {
  CATEGORIES,
  COLORS,
  FITS,
  FORMALITIES,
  GENDERS,
  MATERIALS,
  OCCASIONS,
  PATTERNS,
  SEASONS,
  SLEEVE_LENGTHS,
  STYLES,
  SUBCATEGORIES,
  type CatalogEntry,
} from '../../scripts/ai-eval/catalog'

const mobile = path.resolve(__dirname, '../../../mobile/lib/features')
const read = (f: string) => readFileSync(path.join(mobile, f), 'utf8')

/** Text from `start` to the first closing brace (the Dart maps and enums here have no nested braces). */
function block(src: string, start: string): string {
  const i = src.indexOf(start)
  if (i < 0) throw new Error(`"${start}" not found`)
  return src.slice(i, src.indexOf('}', i))
}

function dartMap(src: string, name: string): Record<string, string> {
  return Object.fromEntries([...block(src, `static const ${name} = {`).matchAll(/'(\w+)':\s*'([^']*)'/g)].map((m) => [m[1], m[2]]))
}

/** Enum values `name('wire', 'label'[, Color(0xAARRGGBB)])`. */
function dartEnum(src: string, name: string): { id: string; label: string; hex?: string }[] {
  return [...block(src, `enum ${name} {`).matchAll(/\w+\('(\w+)', '([^']*)'(?:, Color\(0x[0-9A-Fa-f]{2}([0-9A-Fa-f]{6})\))?\)/g)].map(
    (m) => ({ id: m[1], label: m[2], hex: m[3]?.toLowerCase() }),
  )
}

const wardrobeLabels = read('wardrobe/presentation/wardrobe_labels.dart')
const options = read('onboarding/data/options.dart')
const outfitLabels = read('outfits/presentation/outfit_labels.dart')
const outfitsRepository = read('outfits/data/outfits_repository.dart')

const { all: _allTab, ...mobileCategories } = dartMap(wardrobeLabels, 'categories')
const colorOptions = dartEnum(options, 'ColorOption')
const byId = (entries: { id: string; label: string }[]) => Object.fromEntries(entries.map((e) => [e.id, e.label]))

/** Domain → [web entries, mobile id → label]. */
const DOMAINS: Record<string, [readonly CatalogEntry[], Record<string, string>]> = {
  category: [CATEGORIES, mobileCategories],
  subcategory: [Object.values(SUBCATEGORIES).flat(), dartMap(wardrobeLabels, '_subcategories')],
  pattern: [PATTERNS, dartMap(wardrobeLabels, '_patterns')],
  material: [MATERIALS, dartMap(wardrobeLabels, '_materials')],
  sleeve: [SLEEVE_LENGTHS, dartMap(wardrobeLabels, '_sleeves')],
  fit: [FITS, dartMap(wardrobeLabels, '_fits')],
  'fit.onboarding': [FITS, byId(dartEnum(options, 'FitOption'))],
  formality: [FORMALITIES, dartMap(wardrobeLabels, '_formality')],
  season: [SEASONS, dartMap(wardrobeLabels, '_seasons')],
  gender: [GENDERS, dartMap(wardrobeLabels, '_genders')],
  style: [STYLES, byId(dartEnum(options, 'StyleOption'))],
  color: [COLORS, byId(colorOptions)],
  occasion: [OCCASIONS, dartMap(outfitLabels, '_occasions')],
}

/** `domain:id` → [web label, mobile label], as they are today. */
const KNOWN_LABEL_DIFFERENCES: Record<string, [string, string]> = {
  'category:shirt': ['Ko‘ylak / Rubah', 'Ko‘ylaklar'],
  'category:pants': ['Shim', 'Shimlar'],
  'category:dress': ['Ko‘ylak ( ayol )', 'Ko‘ylak (ayollar)'],
  'category:shoes': ['Oyoq kiyim', 'Poyabzal'],
  'category:bag': ['Sumka', 'Sumkalar'],
  'category:accessory': ['Aksessuar', 'Aksessuarlar'],
  'subcategory:blazer': ['Bleyzer', 'Blazer'],
  'subcategory:windbreaker': ['Vetrovka', 'Shamoldan himoya kurtka'],
  'subcategory:knit': ['Nitki', 'Trikotaj'],
  'subcategory:jeans': ['Jins', 'Jinsi'],
  'subcategory:trousers': ['Shim (klasik)', 'Klassik shim'],
  'subcategory:shorts': ['Shorts', 'Shorti'],
  'subcategory:loafers': ['Mokasin', 'Lofer'],
  'subcategory:oxford_shoes': ['Oksford', 'Oksford tufli'],
  'subcategory:sandals': ['Sandalli', 'Sandal'],
  'subcategory:crossbody': ['Kross-bodi', 'Yelka sumkasi'],
  'subcategory:clutch': ['Klutch', 'Klatch'],
  'subcategory:belt': ['Remen', 'Kamar'],
  'subcategory:hat': ['Shlyapa', 'Bosh kiyim'],
  'pattern:striped': ['Chiziqli', 'Yo‘l-yo‘l'],
  'pattern:checked': ['Katakli', 'Katak'],
  'pattern:plaid': ['Plaid', 'Shotland katak'],
  'pattern:graphic': ['Grafikali', 'Grafik'],
  'pattern:color_block': ['Rangli blok', 'Rang bloklari'],
  'pattern:denim': ['Jins naqshi', 'Denim'],
  'material:denim': ['Jins matosi', 'Denim'],
  'material:cashmere': ['Kashmir', 'Kashemir'],
  'material:leather': ['Teri', 'Charm'],
  'sleeve:short': ['Qisqa yeng', 'Kalta yeng'],
  'fit:slim': ['Slim', 'Tor'],
  'fit:regular': ['Regular', 'O‘rtacha'],
  'fit:relaxed': ['Relaxed', 'Erkin'],
  'fit:oversized': ['Oversize', 'Keng'],
  'fit.onboarding:slim': ['Slim', 'Tor'],
  'fit.onboarding:regular': ['Regular', 'O‘rtacha'],
  'fit.onboarding:relaxed': ['Relaxed', 'Erkin'],
  'fit.onboarding:oversized': ['Oversize', 'Keng (oversize)'],
  'formality:formal': ['Formal', 'Rasmiy'],
  'formality:black_tie': ['Black tie', 'Tantanali'],
  'gender:male': ['Erkak', 'Erkaklar'],
  'gender:female': ['Ayol', 'Ayollar'],
  'gender:unisex': ['Unisex', 'Uniseks'],
  'style:formal': ['Formal', 'Rasmiy'],
  'style:bohemian': ['Bohemian', 'Bogema'],
  'style:minimal': ['Minimal', 'Minimalist'],
  'style:streetwear': ['Streetwear', 'Ko‘cha uslubi'],
  'color:navy': ['Ko‘k (navy)', 'To‘q ko‘k'],
  'color:light_blue': ['Och ko‘k', 'Havorang'],
  'color:brown': ['Jigarron', 'Jigarrang'],
  'color:tan': ['Sarg‘ish-jigarron', 'Och jigarrang'],
  'color:teal': ['Zavorq (teal)', 'Feruza'],
  'color:ivory': ['Och krem', 'Fil suyagi'],
  'color:rust': ['Zang (rust)', 'Zang rang'],
}

/** Colour id → [web hex, mobile swatch], lower-case RGB, as they are today. */
const KNOWN_HEX_DIFFERENCES: Record<string, [string, string]> = {
  beige: ['e8dcc8', 'e8dcc4'],
  navy: ['1e3a5f', '1e2a4a'],
  blue: ['3b82f6', '2563eb'],
  light_blue: ['a5c9e8', '93c5fd'],
  green: ['22c55e', '16a34a'],
  olive: ['6b7f3c', '6b7a2e'],
  khaki: ['bdb76b', 'bdb07a'],
  brown: ['7b4b2a', '6b4226'],
  tan: ['d2b48c', 'c8a27a'],
  red: ['ef4444', 'dc2626'],
  burgundy: ['7e1d2a', '7f1d2d'],
  pink: ['f9a8c9', 'f9a8d4'],
  purple: ['8b5cf6', '7c3aed'],
  cream: ['f5f0e1', 'f5ebd7'],
  ivory: ['fffff0', 'fbf8ef'],
  rust: ['b7410e', 'b45309'],
  mustard: ['d4a017', 'ca9a1b'],
}

type Pairs = Record<string, [string, string]>

/**
 * Compares the differences found today with the recorded ones. `unrecorded`
 * lists each new or changed difference, `stale` each recorded one that no
 * longer holds, one readable line per key.
 */
function compareRecorded(actual: Pairs, recorded: Pairs): { unrecorded: string[]; stale: string[] } {
  const line = (key: string, [web, mob]: [string, string]) => `${key}: web=${JSON.stringify(web)} mobile=${JSON.stringify(mob)}`
  const same = (a?: [string, string], b?: [string, string]) => !!a && !!b && a[0] === b[0] && a[1] === b[1]
  return {
    unrecorded: Object.keys(actual).filter((k) => !same(actual[k], recorded[k])).map((k) => line(k, actual[k])),
    stale: Object.keys(recorded).filter((k) => !same(actual[k], recorded[k])).map((k) => `${line(k, recorded[k])} (now ${actual[k] ? line(k, actual[k]) : 'equal'})`),
  }
}

function labelDifferences(): Pairs {
  const actual: Pairs = {}
  for (const [domain, [web, mob]] of Object.entries(DOMAINS)) {
    for (const e of web) if (mob[e.id] !== undefined && mob[e.id] !== e.label) actual[`${domain}:${e.id}`] = [e.label, mob[e.id]]
  }
  return actual
}

function hexDifferences(): Pairs {
  const actual: Pairs = {}
  for (const o of colorOptions) {
    const web = COLORS.find((c) => c.id === o.id)?.hex.replace('#', '').toLowerCase()
    if (web !== o.hex) actual[o.id] = [web ?? '', o.hex ?? '']
  }
  return actual
}

describe('catalog drift: web catalog vs mobile app', () => {
  it.each(Object.keys(DOMAINS))('%s: no duplicate web ids and the same ids on both sides', (domain) => {
    const [web, mob] = DOMAINS[domain]
    const ids = web.map((e) => e.id)
    expect(ids.filter((id, i) => ids.indexOf(id) !== i), 'duplicate web ids').toEqual([])
    expect(ids.filter((id) => !(id in mob)), `${domain}: ids missing in the mobile app`).toEqual([])
    expect(Object.keys(mob).filter((id) => !ids.includes(id)), `${domain}: mobile ids unknown to the web catalog`).toEqual([])
  })

  it('the outfit occasion ids sent by the app are the catalog occasion ids', () => {
    const list = block(outfitsRepository, 'const outfitOccasions = [')
    const ids = [...list.matchAll(/'(\w+)'/g)].map((m) => m[1])
    expect(ids).toEqual(OCCASIONS.map((o) => o.id))
  })

  it('labels differ only as recorded, with the recorded values', () => {
    const { unrecorded, stale } = compareRecorded(labelDifferences(), KNOWN_LABEL_DIFFERENCES)
    expect(unrecorded, 'new label differences: align the clients or record them').toEqual([])
    expect(stale, 'recorded label differences that no longer hold: update KNOWN_LABEL_DIFFERENCES').toEqual([])
  })

  it('colour swatches differ only as recorded, with the recorded values', () => {
    const { unrecorded, stale } = compareRecorded(hexDifferences(), KNOWN_HEX_DIFFERENCES)
    expect(unrecorded, 'new swatch differences: align the clients or record them').toEqual([])
    expect(stale, 'recorded swatch differences that no longer hold: update KNOWN_HEX_DIFFERENCES').toEqual([])
  })
})

describe('catalog drift check itself', () => {
  const recorded: Pairs = { 'color:navy': ['Ko‘k (navy)', 'To‘q ko‘k'] }

  it('passes when the differences are exactly the recorded ones', () => {
    expect(compareRecorded({ 'color:navy': ['Ko‘k (navy)', 'To‘q ko‘k'] }, recorded)).toEqual({ unrecorded: [], stale: [] })
  })

  it('reports a new difference', () => {
    const r = compareRecorded({ ...recorded, 'color:red': ['Qizil', 'Qirmizi'] }, recorded)
    expect(r.unrecorded).toEqual(['color:red: web="Qizil" mobile="Qirmizi"'])
    expect(r.stale).toEqual([])
  })

  it('reports a recorded difference whose values changed, on both lists', () => {
    const r = compareRecorded({ 'color:navy': ['Ko‘k (navy)', 'Navy'] }, recorded)
    expect(r.unrecorded).toEqual(['color:navy: web="Ko‘k (navy)" mobile="Navy"'])
    expect(r.stale).toHaveLength(1)
  })

  it('reports a recorded difference that was resolved', () => {
    expect(compareRecorded({}, recorded).stale).toEqual(['color:navy: web="Ko‘k (navy)" mobile="To‘q ko‘k" (now equal)'])
  })

  it('parses every Dart source it reads (no domain is empty)', () => {
    for (const [domain, [, mob]] of Object.entries(DOMAINS)) expect(Object.keys(mob).length, domain).toBeGreaterThan(0)
    expect(colorOptions.every((o) => /^[0-9a-f]{6}$/.test(o.hex ?? ''))).toBe(true)
  })
})
