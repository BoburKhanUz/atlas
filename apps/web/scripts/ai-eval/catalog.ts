/**
 * The clothing catalog as the Go service embeds it
 * (apps/api/internal/catalog/catalog.json): the harness's vocabularies, so
 * cases and scoring use exactly the server's ids (docs/plan/B7.md, B7.4c).
 */
import catalog from '../../../api/internal/catalog/catalog.json'

export interface CatalogEntry {
  id: string
  label: string
}

export const CATEGORIES: CatalogEntry[] = catalog.categories
export const SUBCATEGORIES: Record<string, CatalogEntry[]> = Object.fromEntries(catalog.subcategories.map((s) => [s.category, s.entries]))
export const COLORS: (CatalogEntry & { hex: string })[] = catalog.colors
export const PATTERNS: CatalogEntry[] = catalog.patterns
export const MATERIALS: CatalogEntry[] = catalog.materials
export const STYLES: CatalogEntry[] = catalog.styles
export const SLEEVE_LENGTHS: CatalogEntry[] = catalog.sleeveLengths
export const FITS: CatalogEntry[] = catalog.fits
export const SEASONS: CatalogEntry[] = catalog.seasons
export const FORMALITIES: CatalogEntry[] = catalog.formalities
export const GENDERS: CatalogEntry[] = catalog.genders
export const OCCASIONS: CatalogEntry[] = catalog.occasions

/** What a garment photo shows, as the vision schema names it. */
export const SUBJECTS = ['single_garment', 'multiple_garments', 'no_garment', 'unclear'] as const
export type GarmentSubject = (typeof SUBJECTS)[number]

/** The garment analysis's confidence keys (colour is `color`). */
export const CONFIDENCE_KEYS = ['category', 'subcategory', 'color', 'pattern', 'material', 'sleeveLength', 'fit', 'style', 'season', 'gender', 'formality'] as const
export type ConfidenceKey = (typeof CONFIDENCE_KEYS)[number]
