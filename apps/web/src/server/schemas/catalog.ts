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
 * Map a free-text event to an occasion id. Accepts an exact id ("wedding") or
 * an exact catalog label ("To‘y"), case-insensitive. Anything else is free text.
 */
export function occasionFromEvent(event: string | null | undefined): Occasion | undefined {
  if (!event) return undefined
  const e = event.trim().toLowerCase()
  return OCCASIONS.find((o) => o.id === e || o.label.toLowerCase() === e)?.id as Occasion | undefined
}
