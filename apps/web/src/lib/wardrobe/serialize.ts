/**
 * Single serializer for wardrobe items in API responses. Deserialises the
 * JSON-in-TEXT columns and turns private storage keys into signed URLs.
 * Every wardrobe endpoint returns this same shape.
 */

import type { WardrobeImage, WardrobeItem } from '@prisma/client'
import { presentImage, presentPrimaryImage } from '@/lib/storage/media'

export type CorrectionLogEntry = { field: string; from: string; to: string; at: string }

export function serializeWardrobeItem(item: WardrobeItem & { images: WardrobeImage[] }) {
  return {
    id: item.id,
    category: item.category,
    subcategory: item.subcategory,
    colors: JSON.parse(item.colors) as string[],
    pattern: item.pattern,
    material: item.material,
    sleeveLength: item.sleeveLength,
    fit: item.fit,
    style: item.style,
    season: JSON.parse(item.season) as string[],
    gender: item.gender,
    formality: item.formality,
    confidences: JSON.parse(item.confidences) as Record<string, number>,
    wasCorrected: item.wasCorrected,
    correctionLog: JSON.parse(item.correctionLog) as CorrectionLogEntry[],
    images: item.images.map(presentImage),
    primaryImage: presentPrimaryImage(item.images),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }
}
