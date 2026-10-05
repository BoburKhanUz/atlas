/**
 * Clothing attribute catalog — single source of truth for all category/color/
 * pattern/material/style values used across the app (UI labels, AI mock, LLM
 * prompts, validation). Spec section 5, 18.
 *
 * Each entry has an id (machine value, used in DB and LLM prompts) and a Uzbek
 * label shown in the UI. Keeps presentation Uzbek without polluting prompts.
 */

export interface CatalogEntry {
  id: string
  label: string
}

// ─── Categories (spec section 18: Hammasi / Ustki kiyim / Shim / Ko'ylak /
//     Oyoq kiyim / Sumka / Aksessuarlar) ─────────────────────────────────────
export const CATEGORIES: CatalogEntry[] = [
  { id: 'outerwear', label: 'Ustki kiyim' },
  { id: 'shirt', label: 'Ko‘ylak / Rubah' },
  { id: 'pants', label: 'Shim' },
  { id: 'dress', label: 'Ko‘ylak ( ayol )' },
  { id: 'shoes', label: 'Oyoq kiyim' },
  { id: 'bag', label: 'Sumka' },
  { id: 'accessory', label: 'Aksessuar' },
]

// Subcategories per category — used by mock vision to pick a plausible one.
export const SUBCATEGORIES: Record<string, CatalogEntry[]> = {
  outerwear: [
    { id: 'jacket', label: 'Kurtka' },
    { id: 'blazer', label: 'Bleyzer' },
    { id: 'coat', label: 'Palto' },
    { id: 'windbreaker', label: 'Vetrovka' },
  ],
  shirt: [
    { id: 'tshirt', label: 'Futbolka' },
    { id: 'oxford_shirt', label: 'Oksford ko‘ylak' },
    { id: 'polo', label: 'Polo' },
    { id: 'blouse', label: 'Bluzka' },
    { id: 'knit', label: 'Nitki' },
  ],
  pants: [
    { id: 'jeans', label: 'Jins' },
    { id: 'chinos', label: 'Chinos' },
    { id: 'trousers', label: 'Shim (klasik)' },
    { id: 'shorts', label: 'Shorts' },
  ],
  dress: [
    { id: 'casual_dress', label: 'Kasual ko‘ylak' },
    { id: 'evening_dress', label: 'Kechki ko‘ylak' },
    { id: 'midi_dress', label: 'Midi ko‘ylak' },
  ],
  shoes: [
    { id: 'sneakers', label: 'Krossovka' },
    { id: 'loafers', label: 'Mokasin' },
    { id: 'oxford_shoes', label: 'Oksford' },
    { id: 'boots', label: 'Botinka' },
    { id: 'sandals', label: 'Sandalli' },
  ],
  bag: [
    { id: 'tote', label: 'Tote sumka' },
    { id: 'backpack', label: 'Ryukzak' },
    { id: 'crossbody', label: 'Kross-bodi' },
    { id: 'clutch', label: 'Klutch' },
  ],
  accessory: [
    { id: 'belt', label: 'Remen' },
    { id: 'scarf', label: 'Sharf' },
    { id: 'hat', label: 'Shlyapa' },
    { id: 'watch', label: 'Soat' },
    { id: 'sunglasses', label: 'Quyosh ko‘zoynagi' },
  ],
}

// ─── Colors (used for AI detection + UI swatches) ────────────────────────────
// `hex` is used for UI swatches; LLM only sees the id and label.
export const COLORS: (CatalogEntry & { hex: string })[] = [
  { id: 'white', label: 'Oq', hex: '#FFFFFF' },
  { id: 'black', label: 'Qora', hex: '#111111' },
  { id: 'beige', label: 'Bej', hex: '#E8DCC8' },
  { id: 'gray', label: 'Kulrang', hex: '#9CA3AF' },
  { id: 'navy', label: 'Ko‘k (navy)', hex: '#1E3A5F' },
  { id: 'blue', label: 'Ko‘k', hex: '#3B82F6' },
  { id: 'light_blue', label: 'Och ko‘k', hex: '#A5C9E8' },
  { id: 'green', label: 'Yashil', hex: '#22C55E' },
  { id: 'olive', label: 'Zaytun', hex: '#6B7F3C' },
  { id: 'khaki', label: 'Xaki', hex: '#BDB76B' },
  { id: 'brown', label: 'Jigarron', hex: '#7B4B2A' },
  { id: 'tan', label: 'Sarg‘ish-jigarron', hex: '#D2B48C' },
  { id: 'red', label: 'Qizil', hex: '#EF4444' },
  { id: 'burgundy', label: 'Bordo', hex: '#7E1D2A' },
  { id: 'pink', label: 'Pushti', hex: '#F9A8C9' },
  { id: 'orange', label: 'To‘q sariq', hex: '#F97316' },
  { id: 'yellow', label: 'Sariq', hex: '#FACC15' },
  { id: 'purple', label: 'Binafsha', hex: '#8B5CF6' },
  { id: 'teal', label: 'Zavorq (teal)', hex: '#0F766E' },
  { id: 'cream', label: 'Krem', hex: '#F5F0E1' },
  { id: 'ivory', label: 'Och krem', hex: '#FFFFF0' },
  { id: 'rust', label: 'Zang (rust)', hex: '#B7410E' },
  { id: 'mustard', label: 'Xantal', hex: '#D4A017' },
]

// ─── Patterns ───────────────────────────────────────────────────────────────
export const PATTERNS: CatalogEntry[] = [
  { id: 'solid', label: 'Bir rangli' },
  { id: 'striped', label: 'Chiziqli' },
  { id: 'checked', label: 'Katakli' },
  { id: 'plaid', label: 'Plaid' },
  { id: 'floral', label: 'Gulli' },
  { id: 'graphic', label: 'Grafikali' },
  { id: 'color_block', label: 'Rangli blok' },
  { id: 'denim', label: 'Jins naqshi' },
]

// ─── Materials ──────────────────────────────────────────────────────────────
export const MATERIALS: CatalogEntry[] = [
  { id: 'cotton', label: 'Paxta' },
  { id: 'linen', label: 'Zig‘ir' },
  { id: 'denim', label: 'Jins matosi' },
  { id: 'wool', label: 'Jun' },
  { id: 'cashmere', label: 'Kashmir' },
  { id: 'silk', label: 'Ipak' },
  { id: 'polyester', label: 'Poliester' },
  { id: 'nylon', label: 'Neylon' },
  { id: 'leather', label: 'Teri' },
  { id: 'suede', label: 'Zamsh' },
  { id: 'knit', label: 'Trikotaj' },
  { id: 'blend', label: 'Aralash' },
]

// ─── Styles ─────────────────────────────────────────────────────────────────
export const STYLES: CatalogEntry[] = [
  { id: 'casual', label: 'Kasual' },
  { id: 'smart_casual', label: 'Smart-casual' },
  { id: 'formal', label: 'Formal' },
  { id: 'sporty', label: 'Sport' },
  { id: 'bohemian', label: 'Bohemian' },
  { id: 'minimal', label: 'Minimal' },
  { id: 'streetwear', label: 'Streetwear' },
  { id: 'classic', label: 'Klassik' },
  { id: 'preppy', label: 'Preppi' },
]

// ─── Sleeve lengths (spec section 5) ─────────────────────────────────────────
export const SLEEVE_LENGTHS: CatalogEntry[] = [
  { id: 'short', label: 'Qisqa yeng' },
  { id: 'long', label: 'Uzun yeng' },
  { id: 'sleeveless', label: 'Yengsiz' },
  { id: 'three_quarter', label: '3/4 yeng' },
]

// ─── Fit ────────────────────────────────────────────────────────────────────
export const FITS: CatalogEntry[] = [
  { id: 'slim', label: 'Slim' },
  { id: 'regular', label: 'Regular' },
  { id: 'relaxed', label: 'Relaxed' },
  { id: 'oversized', label: 'Oversize' },
]

// ─── Seasons ────────────────────────────────────────────────────────────────
export const SEASONS: CatalogEntry[] = [
  { id: 'spring', label: 'Bahor' },
  { id: 'summer', label: 'Yoz' },
  { id: 'autumn', label: 'Kuz' },
  { id: 'winter', label: 'Qish' },
]

// ─── Formality ──────────────────────────────────────────────────────────────
export const FORMALITIES: CatalogEntry[] = [
  { id: 'casual', label: 'Kasual' },
  { id: 'smart_casual', label: 'Smart-casual' },
  { id: 'formal', label: 'Formal' },
  { id: 'black_tie', label: 'Black tie' },
]

// ─── Gender suitability ─────────────────────────────────────────────────────
export const GENDERS: CatalogEntry[] = [
  { id: 'male', label: 'Erkak' },
  { id: 'female', label: 'Ayol' },
  { id: 'unisex', label: 'Unisex' },
]

// ─── Occasions (spec section 16 — Home quick actions) ────────────────────────
export const OCCASIONS: CatalogEntry[] = [
  { id: 'work', label: 'Ish' },
  { id: 'wedding', label: 'To‘y' },
  { id: 'date', label: 'Uchrashuv' },
  { id: 'travel', label: 'Sayohat' },
  { id: 'casual', label: 'Casual' },
  { id: 'other', label: 'Boshqa' },
]

// ─── Lookup helpers ─────────────────────────────────────────────────────────
export const colorById = (id: string) => COLORS.find((c) => c.id === id)
export const labelById = (
  catalog: CatalogEntry[],
  id: string | null | undefined,
): string | null => (id ? catalog.find((c) => c.id === id)?.label ?? id : null)

/** Canonical list used by the wardrobe filter tabs. Spec section 18. */
export const WARDROBE_TABS = [
  { id: 'all', label: 'Hammasi' },
  { id: 'outerwear', label: 'Ustki kiyim' },
  { id: 'pants', label: 'Shim' },
  { id: 'shirt', label: 'Ko‘ylak' },
  { id: 'shoes', label: 'Oyoq kiyim' },
  { id: 'bag', label: 'Sumka' },
  { id: 'accessory', label: 'Aksessuar' },
] as const
