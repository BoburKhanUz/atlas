/**
 * Zod schemas derived from the clothing catalog (src/lib/ai/catalog.ts),
 * which stays the single source of truth for attribute ids.
 */
import { z } from 'zod'
import {
  CATEGORIES,
  SUBCATEGORIES,
  COLORS,
  PATTERNS,
  MATERIALS,
  STYLES,
  SLEEVE_LENGTHS,
  FITS,
  SEASONS,
  FORMALITIES,
  GENDERS,
  OCCASIONS,
  type CatalogEntry,
} from '@/lib/ai/catalog'
import type { Occasion } from '@/lib/ai/color-theory'

function idEnum(entries: readonly CatalogEntry[]) {
  return z.enum(entries.map((e) => e.id) as [string, ...string[]])
}

export const categorySchema = idEnum(CATEGORIES)
export const subcategorySchema = idEnum(Object.values(SUBCATEGORIES).flat())
export const colorSchema = idEnum(COLORS)
export const patternSchema = idEnum(PATTERNS)
export const materialSchema = idEnum(MATERIALS)
export const sleeveLengthSchema = idEnum(SLEEVE_LENGTHS)
export const fitSchema = idEnum(FITS)
export const styleSchema = idEnum(STYLES)
export const seasonSchema = idEnum(SEASONS)
export const genderSchema = idEnum(GENDERS)
export const formalitySchema = idEnum(FORMALITIES)
export const occasionSchema = z.enum(OCCASIONS.map((o) => o.id) as [Occasion, ...Occasion[]])

export const colorsSchema = z.array(colorSchema).max(5)
export const seasonsSchema = z.array(seasonSchema).max(4)

/** Subcategory ids valid for a category (empty when the category is unknown). */
export function subcategoriesOf(category: string): string[] {
  return (SUBCATEGORIES[category] ?? []).map((s) => s.id)
}

/**
 * Other labels accepted as an `event` for an occasion: legacy and client
 * labels (Flutter shows "Kundalik"). Input matching only; the catalog labels
 * shown to users do not change.
 */
export const OCCASION_ALIASES: Readonly<Partial<Record<Occasion, readonly string[]>>> = {
  casual: ['Kasual', 'Kundalik'],
  wedding: ["To'y"],
}

/** Trimmed, lower-cased, with ' ’ ‘ ʻ ʼ treated as one apostrophe. */
function normalizeEvent(text: string): string {
  return text.trim().toLowerCase().replace(/[’‘ʻʼ]/g, "'")
}

/**
 * Exact-match lookup from normalized id, label and alias to occasion id.
 * Throws if one normalized key would name two occasions.
 */
export function buildOccasionLookup(
  entries: readonly CatalogEntry[],
  aliases: Readonly<Partial<Record<string, readonly string[]>>>,
): ReadonlyMap<string, string> {
  const lookup = new Map<string, string>()
  const add = (key: string, id: string) => {
    const k = normalizeEvent(key)
    const existing = lookup.get(k)
    if (existing !== undefined && existing !== id) {
      throw new Error(`occasion alias "${key}" maps to both ${existing} and ${id}`)
    }
    lookup.set(k, id)
  }
  for (const o of entries) {
    add(o.id, o.id)
    add(o.label, o.id)
  }
  for (const [id, list] of Object.entries(aliases)) {
    if (!entries.some((o) => o.id === id)) throw new Error(`occasion alias for unknown id ${id}`)
    for (const alias of list ?? []) add(alias, id)
  }
  return lookup
}

const OCCASION_LOOKUP = buildOccasionLookup(OCCASIONS, OCCASION_ALIASES)

/**
 * Map a free-text event to an occasion id. Accepts an exact id ("wedding"),
 * catalog label ("To‘y") or alias ("To'y", "Kundalik"), case-insensitive.
 * Anything else is free text.
 */
export function occasionFromEvent(event: string | null | undefined): Occasion | undefined {
  if (!event) return undefined
  return OCCASION_LOOKUP.get(normalizeEvent(event)) as Occasion | undefined
}
