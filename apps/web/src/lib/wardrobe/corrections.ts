/**
 * The correction rules of PATCH /api/v1/wardrobe/items/[id]: which fields a
 * correction changes, how each change is logged, and whether the
 * subcategory fits the category the item ends up with. Pure, so that the Go
 * port is checked against this code (scripts/golden-wardrobe.ts).
 */

import type { WardrobeItem } from '@prisma/client'
import type { z } from 'zod'
import type { WardrobeItemPatchRequest } from '@/server/schemas/requests'
import { subcategoriesOf } from '@/server/schemas/catalog'
import type { CorrectionLogEntry } from './serialize'

export type WardrobeItemPatch = z.infer<typeof WardrobeItemPatchRequest>

/** The stored columns a correction reads (lists as their JSON text). */
export type CorrectableColumns = Pick<
  WardrobeItem,
  | 'category'
  | 'subcategory'
  | 'colors'
  | 'pattern'
  | 'material'
  | 'sleeveLength'
  | 'fit'
  | 'style'
  | 'season'
  | 'gender'
  | 'formality'
>

export const SUBCATEGORY_MISMATCH_MESSAGE = 'Bu tur tanlangan toifaga mos emas'

/**
 * Whether the subcategory the item would end up with belongs to its
 * category (either may change alone; a stale subcategory is not kept
 * silently).
 */
export function subcategoryMismatch(current: CorrectableColumns, data: WardrobeItemPatch): boolean {
  if (data.category === undefined && data.subcategory === undefined) return false
  const category = data.category ?? current.category
  const subcategory = data.subcategory !== undefined ? data.subcategory : current.subcategory
  return subcategory != null && !subcategoriesOf(category).includes(subcategory)
}

/**
 * The fields that differ, each logged with its old and new value as text,
 * and the column values to write (lists as JSON text). Nothing is returned
 * for a field that is unchanged.
 */
export function computeCorrections(
  current: CorrectableColumns,
  data: WardrobeItemPatch,
  now: string,
): { corrections: CorrectionLogEntry[]; update: Record<string, unknown> } {
  const corrections: CorrectionLogEntry[] = []
  const update: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(data)) {
    if (value === undefined) continue
    const fromValue = (current as unknown as Record<string, unknown>)[field]
    const fromStr = Array.isArray(fromValue) ? JSON.stringify(fromValue) : String(fromValue ?? '')
    const toStr = Array.isArray(value) ? JSON.stringify(value) : String(value ?? '')
    if (fromStr !== toStr) {
      corrections.push({ field, from: fromStr, to: toStr, at: now })
      // JSON-array fields need serialisation; primitives can pass through
      update[field] = ['colors', 'season'].includes(field) ? JSON.stringify(value) : value
    }
  }
  return { corrections, update }
}
