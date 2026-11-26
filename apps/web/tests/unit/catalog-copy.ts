/**
 * The catalog as the Go service embeds it: every vocabulary in its order,
 * subcategories as a list per category (a JSON object would lose the order
 * in Go). Shared by scripts/catalog-copy.ts and catalog-copy.test.ts.
 */
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
} from '@/lib/ai/catalog'

export function catalogCopy(): string {
  const entries = (list: { id: string; label: string }[]) => list.map(({ id, label }) => ({ id, label }))
  return (
    JSON.stringify(
      {
        categories: entries(CATEGORIES),
        subcategories: Object.entries(SUBCATEGORIES).map(([category, list]) => ({ category, entries: entries(list) })),
        colors: COLORS.map(({ id, label, hex }) => ({ id, label, hex })),
        patterns: entries(PATTERNS),
        materials: entries(MATERIALS),
        styles: entries(STYLES),
        sleeveLengths: entries(SLEEVE_LENGTHS),
        fits: entries(FITS),
        seasons: entries(SEASONS),
        formalities: entries(FORMALITIES),
        genders: entries(GENDERS),
        occasions: entries(OCCASIONS),
      },
      null,
      1,
    ) + '\n'
  )
}
