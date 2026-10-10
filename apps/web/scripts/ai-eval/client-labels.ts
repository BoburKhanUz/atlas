/**
 * The Flutter client's user-facing Uzbek labels for the catalog ids in the
 * Uzbek output policy's scope (clothing and colour descriptions, plus the
 * occasion "casual"). The mobile app shows these labels, not the web
 * catalog's (src/lib/ai/catalog.ts), so both are canonical user-facing
 * wording until the owner unifies them (docs/ai/uzbek-output-policy.md).
 *
 * READ-ONLY COPY, verified entry by entry against the Dart sources by
 * tests/unit/ai/uzbek-output-policy.test.ts:
 * - apps/mobile/lib/features/wardrobe/presentation/wardrobe_labels.dart
 *   (categories, _subcategories, _patterns, _materials, _sleeves, _fits, _formality)
 * - apps/mobile/lib/features/onboarding/data/options.dart (StyleOption, ColorOption, FitOption)
 * - apps/mobile/lib/features/outfits/presentation/outfit_labels.dart (_occasions)
 * Outfit roles, weather conditions, seasons and genders are out of scope.
 */
export const MOBILE_LABELS: Readonly<Record<string, readonly string[]>> = {
  // wardrobe_labels.dart: categories
  outerwear: ['Ustki kiyim'], shirt: ['Ko‘ylaklar'], pants: ['Shimlar'], dress: ['Ko‘ylak (ayollar)'], shoes: ['Poyabzal'],
  bag: ['Sumkalar'], accessory: ['Aksessuarlar'],
  // _subcategories
  jacket: ['Kurtka'], blazer: ['Blazer'], coat: ['Palto'], windbreaker: ['Shamoldan himoya kurtka'], tshirt: ['Futbolka'],
  oxford_shirt: ['Oksford ko‘ylak'], polo: ['Polo'], blouse: ['Bluzka'], knit: ['Trikotaj'], jeans: ['Jinsi'], chinos: ['Chinos'],
  trousers: ['Klassik shim'], shorts: ['Shorti'], casual_dress: ['Kundalik ko‘ylak'], evening_dress: ['Kechki ko‘ylak'],
  midi_dress: ['Midi ko‘ylak'], sneakers: ['Krossovka'], loafers: ['Lofer'], oxford_shoes: ['Oksford tufli'], boots: ['Botinka'],
  sandals: ['Sandal'], tote: ['Tote sumka'], backpack: ['Ryukzak'], crossbody: ['Yelka sumkasi'], clutch: ['Klatch'], belt: ['Kamar'],
  scarf: ['Sharf'], hat: ['Bosh kiyim'], watch: ['Soat'], sunglasses: ['Quyosh ko‘zoynagi'],
  // _patterns and _materials (knit and denim appear in both with the same label)
  solid: ['Bir rangli'], striped: ['Yo‘l-yo‘l'], checked: ['Katak'], plaid: ['Shotland katak'], floral: ['Gulli'], graphic: ['Grafik'],
  color_block: ['Rang bloklari'], denim: ['Denim'], cotton: ['Paxta'], linen: ['Zig‘ir'], wool: ['Jun'], cashmere: ['Kashemir'],
  silk: ['Ipak'], polyester: ['Poliester'], nylon: ['Neylon'], leather: ['Charm'], suede: ['Zamsh'], blend: ['Aralash'],
  // _sleeves, _fits + FitOption, _formality + StyleOption (+ the occasion "casual")
  short: ['Kalta yeng'], long: ['Uzun yeng'], sleeveless: ['Yengsiz'], three_quarter: ['Uchdan to‘rt yeng'],
  slim: ['Tor'], regular: ['O‘rtacha'], relaxed: ['Erkin'], oversized: ['Keng', 'Keng (oversize)'],
  casual: ['Kundalik'], smart_casual: ['Smart-casual'], formal: ['Rasmiy'], black_tie: ['Tantanali'],
  sporty: ['Sport'], bohemian: ['Bogema'], minimal: ['Minimalist'], streetwear: ['Ko‘cha uslubi'], classic: ['Klassik'], preppy: ['Preppi'],
  // ColorOption
  white: ['Oq'], black: ['Qora'], beige: ['Bej'], gray: ['Kulrang'], navy: ['To‘q ko‘k'], blue: ['Ko‘k'], light_blue: ['Havorang'],
  green: ['Yashil'], olive: ['Zaytun'], khaki: ['Xaki'], brown: ['Jigarrang'], tan: ['Och jigarrang'], red: ['Qizil'], burgundy: ['Bordo'],
  pink: ['Pushti'], orange: ['To‘q sariq'], yellow: ['Sariq'], purple: ['Binafsha'], teal: ['Feruza'], cream: ['Krem'],
  ivory: ['Fil suyagi'], rust: ['Zang rang'], mustard: ['Xantal'],
}
