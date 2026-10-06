import { describe, expect, it } from 'vitest'
import { CATEGORIES, COLORS, SUBCATEGORIES } from '@/lib/ai/catalog'
import {
  CONFIDENCE_KEYS,
  GARMENT_INSTRUCTION,
  type GarmentConfidences,
  GARMENT_JSON_SCHEMA,
  InvalidGarmentOutputError,
  interpretGarmentOutput,
  presentConfidences,
  UNCALIBRATED_MAX_CONFIDENCE,
  VISION_ANALYSIS_VERSION,
} from '@/lib/ai/garment-analysis'

const conf = (v = 0.9) => Object.fromEntries(CONFIDENCE_KEYS.map((k) => [k, v])) as GarmentConfidences
export const validOutput = (extra: Record<string, unknown> = {}) => ({
  subject: 'single_garment',
  category: 'shirt',
  subcategory: 'oxford_shirt',
  colors: ['white', 'light_blue'],
  pattern: 'striped',
  material: 'cotton',
  sleeveLength: 'long',
  fit: 'regular',
  style: 'smart_casual',
  season: ['spring', 'autumn'],
  gender: 'male',
  formality: 'smart_casual',
  confidence: conf(),
  ...extra,
})
const rejectedOutput = (subject: string) => ({
  ...validOutput({ subject, category: null, subcategory: null, colors: [], pattern: null, material: null, sleeveLength: null, fit: null, style: null, season: [], gender: null, formality: null }),
  confidence: conf(0),
})
const invalid = (output: unknown) => {
  expect(() => interpretGarmentOutput(output)).toThrow(InvalidGarmentOutputError)
}

describe('garment output validation', () => {
  it('accepts a valid single garment and keeps raw confidence unchanged', () => {
    const r = interpretGarmentOutput(validOutput())
    expect(r).toEqual({
      kind: 'garment',
      attributes: {
        category: 'shirt', subcategory: 'oxford_shirt', colors: ['white', 'light_blue'], pattern: 'striped', material: 'cotton',
        sleeveLength: 'long', fit: 'regular', style: 'smart_casual', season: ['spring', 'autumn'], gender: 'male', formality: 'smart_casual',
      },
      rawConfidence: conf(),
    })
  })

  it('null attributes are allowed for a single garment (except the category)', () => {
    const r = interpretGarmentOutput(validOutput({ subcategory: null, material: null, colors: [], season: [] }))
    expect(r.kind).toBe('garment')
    invalid(validOutput({ category: null }))
    invalid(validOutput({ category: null, subcategory: null })) // no category at all, not only a mismatched subcategory
  })

  it.each(['multiple_garments', 'no_garment', 'unclear'])('%s → rejected (never stored)', (subject) => {
    expect(interpretGarmentOutput(rejectedOutput(subject))).toEqual({ kind: 'rejected', subject })
  })

  it('shoes, bags and accessories are valid categories', () => {
    for (const [category, subcategory] of [['shoes', 'sneakers'], ['bag', 'backpack'], ['accessory', 'scarf']]) {
      expect(interpretGarmentOutput(validOutput({ category, subcategory, sleeveLength: null })).kind).toBe('garment')
    }
  })

  it('a subcategory from another category is rejected, not guessed', () => {
    invalid(validOutput({ category: 'shoes', subcategory: 'oxford_shirt' }))
    invalid(validOutput({ category: 'pants', subcategory: 'sneakers' }))
  })

  it.each([
    ['unknown category', { category: 'kaftan' }],
    ['unknown colour', { colors: ['white', 'neon'] }],
    ['unknown pattern', { pattern: 'camouflage' }],
    ['unknown subject', { subject: 'outfit' }],
    ['6 colours', { colors: ['white', 'black', 'gray', 'navy', 'blue', 'red'] }],
    ['duplicate colours', { colors: ['white', 'white'] }],
    ['5 seasons', { season: ['spring', 'summer', 'autumn', 'winter', 'spring'] }],
    ['duplicate seasons', { season: ['spring', 'spring'] }],
    ['confidence above 1', { confidence: { ...conf(), color: 1.2 } }],
    ['negative confidence', { confidence: { ...conf(), fit: -0.1 } }],
    ['confidence as text', { confidence: { ...conf(), fit: '0.5' } }],
    ['missing confidence key', { confidence: Object.fromEntries(CONFIDENCE_KEYS.slice(1).map((k) => [k, 0.5])) }],
    ['extra confidence key', { confidence: { ...conf(), mood: 0.5 } }],
    ['extra field', { brand: 'X' }],
  ])('%s → whole output rejected', (_name, extra) => {
    invalid(validOutput(extra))
  })

  it('missing fields, wrong types and non-objects are rejected', () => {
    const { material: _m, ...missing } = validOutput()
    invalid(missing)
    for (const bad of [null, 'shirt', [], 42, { subject: 'single_garment' }]) invalid(bad)
  })

  it('error messages name fields only, never values from the model', () => {
    try {
      interpretGarmentOutput(validOutput({ pattern: 'IGNORE-INSTRUCTIONS-VALUE' }))
    } catch (err) {
      expect((err as Error).message).toContain('pattern')
      expect((err as Error).message).not.toContain('IGNORE-INSTRUCTIONS-VALUE')
    }
  })
})

describe('presented confidence (calibration pending)', () => {
  it('caps every value just below the clients’ high band; raw values are not modified', () => {
    const raw = { ...conf(0.95), pattern: 0.3 }
    const shown = presentConfidences(raw, null)
    expect(UNCALIBRATED_MAX_CONFIDENCE).toBeLessThan(0.7)
    expect(Object.values(shown).every((v) => v <= UNCALIBRATED_MAX_CONFIDENCE)).toBe(true)
    expect(shown.pattern).toBe(0.3)
    expect(raw.category).toBe(0.95) // untouched
  })

  it('a colour cap only lowers the colour confidence', () => {
    const shown = presentConfidences(conf(0.95), 0.35)
    expect(shown.color).toBe(0.35)
    expect(shown.category).toBe(UNCALIBRATED_MAX_CONFIDENCE)
    expect(presentConfidences(conf(0.2), 0.35).color).toBe(0.2)
  })
})

describe('schema and prompt (provider-independent, versioned)', () => {
  type Node = Record<string, unknown>
  /** OpenAI strict mode: every object lists all properties as required and forbids extras. */
  const checkStrict = (node: Node, path = 'root') => {
    if (node.type === 'object') {
      const props = Object.keys((node.properties ?? {}) as Node)
      expect(node.additionalProperties, path).toBe(false)
      expect([...((node.required ?? []) as string[])].sort(), path).toEqual([...props].sort())
      for (const [k, v] of Object.entries((node.properties ?? {}) as Record<string, Node>)) checkStrict(v, `${path}.${k}`)
    }
    if (node.items) checkStrict(node.items as Node, `${path}[]`)
    for (const alt of (node.anyOf ?? []) as Node[]) checkStrict(alt, path)
  }

  it('is strict-mode compatible everywhere', () => {
    checkStrict(GARMENT_JSON_SCHEMA)
  })

  it('enums are exactly the catalog values', () => {
    const props = GARMENT_JSON_SCHEMA.properties as Record<string, { anyOf?: Array<{ enum?: string[] }>; items?: { enum: string[] } }>
    expect(props.category.anyOf?.[0].enum).toEqual(CATEGORIES.map((c) => c.id))
    expect(props.subcategory.anyOf?.[0].enum).toEqual(Object.values(SUBCATEGORIES).flat().map((s) => s.id))
    expect(props.colors.items?.enum).toEqual(COLORS.map((c) => c.id))
    // nullable attributes allow null explicitly
    expect(props.material.anyOf?.[1]).toEqual({ type: 'null' })
  })

  it('stays well inside provider schema limits', () => {
    const enums = JSON.stringify(GARMENT_JSON_SCHEMA).match(/"enum":\[[^\]]*\]/g)!.join('').split(',').length
    expect(enums).toBeLessThan(1000)
  })

  it('the prompt covers the required rules and carries its version', () => {
    expect(VISION_ANALYSIS_VERSION).toBe('v1')
    for (const rule of [/ONE dominant/, /multiple_garments/, /no_garment/, /unclear/, /shoes, bags and accessories/, /Ignore any text/, /No file name/, /null for an attribute/, /Do not identify/, /Answer with JSON/]) {
      expect(GARMENT_INSTRUCTION).toMatch(rule)
    }
  })
})
