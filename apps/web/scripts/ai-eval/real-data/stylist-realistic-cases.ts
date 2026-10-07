/**
 * Realistic stylist corpus (Phase 5.2): 60 CONSTRUCTED cases in Uzbek (Latin),
 * written for evaluation from everyday scenarios. They are not user
 * conversations and contain no personal data: catalog-value wardrobes,
 * synthetic ids (never shown to a model: the context uses W references).
 *
 * The automatic checks (stylist-scoring.ts) cover grounding, references,
 * needsMoreInfo and simple relevance proxies; usefulness, completeness and
 * Uzbek naturalness need blind human raters (ratings.ts): NOT_EVALUATED
 * until such ratings exist.
 *
 * Versioned and hashed like any dataset (STYLIST_REALISTIC_VERSION); changing
 * any case requires a new version.
 */
import type { Occasion } from '../../../src/lib/ai/color-theory'
import type { WeatherSnapshot } from '../../../src/lib/ai/outfit-engine'
import type { ColorProfileRow, WardrobeRow } from '../../../src/lib/ai/stylist-context'
import type { StylistCase, StylistExpect } from '../stylist-cases'

export const STYLIST_REALISTIC_VERSION = 'constructed-v1'

let seq = 0
const item = (category: string, subcategory: string, colors: string[], extra: Partial<WardrobeRow> = {}): WardrobeRow => ({
  id: `rv_item_${++seq}`,
  category,
  subcategory,
  colors,
  pattern: 'solid',
  material: 'cotton',
  sleeveLength: category === 'shirt' ? 'long' : null,
  fit: 'regular',
  style: 'casual',
  season: [],
  gender: 'unisex',
  formality: 'casual',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  ...extra,
})

/** An everyday mixed wardrobe (≈ 20 items). */
function everyday(): WardrobeRow[] {
  return [
    item('shirt', 'tshirt', ['white'], { sleeveLength: 'short', season: ['spring', 'summer'] }),
    item('shirt', 'tshirt', ['gray'], { sleeveLength: 'short' }),
    item('shirt', 'polo', ['navy'], { sleeveLength: 'short', style: 'smart_casual', formality: 'smart_casual' }),
    item('shirt', 'oxford_shirt', ['light_blue'], { style: 'smart_casual', formality: 'smart_casual' }),
    item('shirt', 'oxford_shirt', ['white'], { style: 'formal', formality: 'formal' }),
    item('shirt', 'knit', ['burgundy'], { material: 'wool', season: ['autumn', 'winter'] }),
    item('shirt', 'knit', ['black'], { style: 'sporty', season: ['autumn', 'winter', 'spring'] }),
    item('pants', 'jeans', ['blue'], { material: 'denim' }),
    item('pants', 'chinos', ['beige'], { style: 'smart_casual', formality: 'smart_casual' }),
    item('pants', 'trousers', ['gray'], { style: 'formal', formality: 'formal', material: 'wool' }),
    item('pants', 'trousers', ['black'], { style: 'sporty' }),
    item('pants', 'shorts', ['khaki'], { season: ['summer'] }),
    item('outerwear', 'blazer', ['navy'], { style: 'formal', formality: 'formal', material: 'wool' }),
    item('outerwear', 'coat', ['tan'], { material: 'wool', season: ['winter'] }),
    item('outerwear', 'windbreaker', ['olive']),
    item('outerwear', 'jacket', ['black'], { season: ['winter'] }),
    item('shoes', 'sneakers', ['white']),
    item('shoes', 'sneakers', ['gray'], { style: 'sporty' }),
    item('shoes', 'oxford_shoes', ['brown'], { style: 'formal', formality: 'formal', material: 'leather' }),
    item('shoes', 'boots', ['black'], { material: 'leather', season: ['autumn', 'winter'] }),
    item('accessory', 'scarf', ['gray'], { material: 'wool', season: ['winter'] }),
    item('accessory', 'watch', ['gray'], { style: 'classic', formality: 'smart_casual' }),
  ]
}
/** Mostly dresses and blouses (≈ 15 items). */
function dressy(): WardrobeRow[] {
  return [
    item('dress', 'midi_dress', ['green'], { style: 'smart_casual', formality: 'smart_casual', gender: 'female' }),
    item('dress', 'evening_dress', ['navy'], { style: 'formal', formality: 'formal', gender: 'female' }),
    item('dress', 'casual_dress', ['pink'], { season: ['spring', 'summer'], gender: 'female' }),
    item('pants', 'trousers', ['beige'], { gender: 'female', style: 'smart_casual', formality: 'smart_casual' }),
    item('pants', 'trousers', ['black'], { gender: 'female', style: 'formal', formality: 'formal' }),
    item('shirt', 'blouse', ['white'], { gender: 'female', style: 'smart_casual', formality: 'smart_casual' }),
    item('shirt', 'blouse', ['cream'], { gender: 'female', material: 'silk', style: 'formal', formality: 'formal' }),
    item('shirt', 'knit', ['gray'], { material: 'wool', season: ['autumn', 'winter'], gender: 'female' }),
    item('pants', 'trousers', ['navy'], { gender: 'female', style: 'smart_casual', formality: 'smart_casual' }),
    item('outerwear', 'coat', ['beige'], { gender: 'female' }),
    item('shirt', 'knit', ['cream'], { gender: 'female', material: 'wool' }),
    item('shoes', 'loafers', ['black'], { gender: 'female', style: 'formal', formality: 'formal', material: 'leather' }),
    item('shoes', 'sandals', ['beige'], { gender: 'female' }),
    item('shoes', 'sneakers', ['white']),
    item('bag', 'tote', ['brown'], { gender: 'female', material: 'leather' }),
  ]
}
const tiny = () => [item('shirt', 'tshirt', ['black'], { sleeveLength: 'short' }), item('pants', 'jeans', ['blue'], { material: 'denim' }), item('shoes', 'sneakers', ['white'])]
const noShoes = () => [item('shirt', 'oxford_shirt', ['white']), item('pants', 'chinos', ['navy']), item('outerwear', 'jacket', ['olive'])]
const noBottoms = () => [item('shirt', 'tshirt', ['white'], { sleeveLength: 'short' }), item('shirt', 'knit', ['beige'], { material: 'wool' }), item('shoes', 'boots', ['brown'])]

const W = (t: number, condition: string, pct: number, wind = 8): WeatherSnapshot => ({ temperature: t, feelsLike: t - 2, condition, precipitationProbability: pct, humidity: 60, windSpeed: wind, uvIndex: 3 })
const winterProfile: ColorProfileRow = { season: 'winter', undertone: 'cool', contrastLevel: 'high', recommendedColors: ['navy', 'black', 'white', 'burgundy', 'green'], neutralColors: ['gray'], cautionColors: ['beige', 'tan', 'khaki'] }
const springProfile: ColorProfileRow = { season: 'spring', undertone: 'warm', contrastLevel: 'medium', recommendedColors: ['cream', 'tan', 'pink', 'beige'], neutralColors: ['beige', 'cream'], cautionColors: ['black', 'gray'] }

type Spec = [id: string, tags: string[], message: string, opts?: { occasion?: Occasion; occasionText?: string; wardrobe?: () => WardrobeRow[]; weather?: WeatherSnapshot; colorProfile?: ColorProfileRow; expect?: StylistExpect }]

const SPECS: Spec[] = [
  // Casual
  ['cas_cafe', ['casual'], 'Dugonalarim bilan kafega chiqaman, oddiy lekin chiroyli ko‘rinmoqchiman.', { occasion: 'casual', weather: W(21, 'clear', 0), expect: { minRefs: 2 } }],
  ['cas_park', ['casual'], 'Dam olish kuni bolalar bilan bog‘ga boramiz. Qulay kiyim tavsiya qiling.', { occasion: 'casual', weather: W(24, 'clear', 0), expect: { minRefs: 2 } }],
  ['cas_shopping', ['casual'], 'Bozorga va do‘konlarga aylanishga chiqaman, ko‘p yuraman.', { occasion: 'casual', weather: W(18, 'partly_cloudy', 10), expect: { minRefs: 2 } }],
  ['cas_cinema', ['casual'], 'Kechqurun kinoga boraman, nima kiysam bo‘ladi?', { occasion: 'casual', weather: W(16, 'clear', 0), expect: { minRefs: 2 } }],
  ['cas_friends_home', ['casual'], 'Do‘stimnikiga mehmonga boraman, juda rasmiy bo‘lmasin.', { occasion: 'casual', expect: { minRefs: 2 } }],
  ['cas_weekend', ['casual', 'ambiguous'], 'Shanba kuni rejam yo‘q, shunchaki qulay narsa kerak.', { weather: W(20, 'cloudy', 20), expect: { minRefs: 1 } }],
  // Work
  ['work_meeting', ['work'], 'Ertaga direktor bilan muhim uchrashuv bor. Qanday kiyinay?', { occasion: 'work', weather: W(17, 'cloudy', 10), expect: { minRefs: 2 } }],
  ['work_interview', ['work'], 'Bank ishiga suhbatga boraman, birinchi taassurot muhim.', { occasion: 'work', weather: W(19, 'clear', 0), expect: { minRefs: 2 } }],
  ['work_daily', ['work'], 'Ofisga har kuni kiyadigan, ortiqcha rasmiy bo‘lmagan obraz kerak.', { occasion: 'work', weather: W(22, 'clear', 0), expect: { minRefs: 2 } }],
  ['work_presentation', ['work'], 'Konferensiyada taqdimot qilaman, ishonchli ko‘rinishim kerak.', { occasion: 'work', weather: W(15, 'cloudy', 20), expect: { minRefs: 2 } }],
  ['work_friday', ['work', 'casual'], 'Juma kuni ofisda erkinroq kiyinsa bo‘ladi. Nima tanlay?', { occasion: 'work', weather: W(23, 'clear', 0), expect: { minRefs: 2 } }],
  ['work_dressy', ['work'], 'Ishga ko‘ylak yoki yubka bilan bormoqchiman, qaysi biri yaxshi?', { occasion: 'work', wardrobe: dressy, weather: W(20, 'clear', 0), expect: { minRefs: 2 } }],
  // Formal
  ['formal_wedding', ['formal'], 'Do‘stimning to‘yiga taklif qilindim. Garderobimdan mos obraz tuzib bering.', { occasion: 'wedding', occasionText: 'to‘y', weather: W(24, 'clear', 0), expect: { minRefs: 2 } }],
  ['formal_wedding_dress', ['formal'], 'Opamning to‘yiga boraman, ko‘ylaklarimdan qaysi biri mos?', { occasion: 'wedding', occasionText: 'to‘y', wardrobe: dressy, weather: W(26, 'clear', 0), expect: { minRefs: 1 } }],
  ['formal_theatre', ['formal'], 'Teatrga boraman, nafis ko‘rinishni xohlayman.', { occasion: 'date', wardrobe: dressy, weather: W(14, 'clear', 0), expect: { minRefs: 2 } }],
  ['formal_ceremony', ['formal'], 'Universitet bitiruv marosimiga qanday kiyinish kerak?', { occasion: 'wedding', occasionText: 'marosim', weather: W(28, 'clear', 0), expect: { minRefs: 2 } }],
  ['formal_dinner', ['formal'], 'Hamkorlar bilan restoranda rasmiy kechki ovqat bor.', { occasion: 'work', weather: W(12, 'clear', 0), expect: { minRefs: 2 } }],
  // Date
  ['date_dinner', ['date'], 'Bugun kechqurun uchrashuvga boraman, restoranda.', { occasion: 'date', weather: W(18, 'clear', 0), expect: { minRefs: 2 } }],
  ['date_walk', ['date'], 'Kechqurun sayr qilishga chiqamiz, salqin bo‘lishi mumkin.', { occasion: 'date', weather: W(11, 'clear', 0, 15), expect: { minRefs: 2 } }],
  ['date_first', ['date'], 'Birinchi uchrashuv, juda ham rasmiy ko‘rinmaslik kerak.', { occasion: 'date', wardrobe: dressy, weather: W(22, 'clear', 0), expect: { minRefs: 2 } }],
  ['date_coffee', ['date', 'casual'], 'Kunduzi qahvaxonada uchrashamiz.', { occasion: 'date', weather: W(25, 'clear', 0), expect: { minRefs: 2 } }],
  ['date_anniversary', ['date', 'formal'], 'Yubiley kechasi, chiroyli kiyinmoqchiman.', { occasion: 'date', wardrobe: dressy, weather: W(16, 'clear', 0), expect: { minRefs: 2 } }],
  // Travel
  ['travel_plane', ['travel'], 'Uzoq parvozga chiqaman, yo‘lda qulay bo‘lishi kerak.', { occasion: 'travel', weather: W(20, 'clear', 0), expect: { minRefs: 2 } }],
  ['travel_mountains', ['travel', 'weather'], 'Tog‘ga ikki kunlik sayohat, kechalari sovuq bo‘ladi.', { occasion: 'travel', weather: W(8, 'partly_cloudy', 30, 20), expect: { minRefs: 2 } }],
  ['travel_city', ['travel'], 'Samarqandga ekskursiya, kun bo‘yi piyoda yuramiz.', { occasion: 'travel', weather: W(27, 'clear', 0), expect: { minRefs: 2 } }],
  ['travel_business', ['travel', 'work'], 'Xizmat safariga ketyapman, uchrashuvlar ham bo‘ladi.', { occasion: 'travel', weather: W(15, 'cloudy', 20), expect: { minRefs: 2 } }],
  ['travel_train', ['travel'], 'Poyezdda olti soat yo‘l yuraman.', { occasion: 'travel', expect: { minRefs: 2 } }],
  // Sport
  ['sport_gym', ['sport'], 'Sport zaliga boraman, nima kiyay?', { occasion: 'other', occasionText: 'sport', expect: { minRefs: 2 } }],
  ['sport_run', ['sport', 'weather'], 'Ertalab parkda yugurmoqchiman, havo salqin.', { occasion: 'other', occasionText: 'sport', weather: W(9, 'clear', 0, 10), expect: { minRefs: 2 } }],
  ['sport_football', ['sport'], 'Do‘stlar bilan futbol o‘ynaymiz.', { occasion: 'other', occasionText: 'sport', weather: W(23, 'clear', 0), expect: { minRefs: 2 } }],
  ['sport_hike', ['sport', 'travel'], 'Piyoda yurishga (hiking) chiqaman, yo‘l toshli.', { occasion: 'other', occasionText: 'sport', weather: W(18, 'partly_cloudy', 20), expect: { minRefs: 2 } }],
  ['sport_no_gear', ['sport', 'limited'], 'Sportga boraman, lekin sport kiyimim deyarli yo‘q.', { occasion: 'other', occasionText: 'sport', wardrobe: tiny, expect: { maxRefs: 3 } }],
  // Weather-driven
  ['wx_heavy_rain', ['weather'], 'Bugun kuchli yomg‘ir yog‘yapti, ishga qanday kiyinay?', { occasion: 'work', weather: W(10, 'rain', 95, 20), expect: { minRefs: 2 } }],
  ['wx_heat', ['weather'], 'Havo 38 daraja, juda issiq. Nima kiysam yengil bo‘ladi?', { weather: W(38, 'clear', 0, 5), expect: { minRefs: 2 } }],
  ['wx_snow', ['weather'], 'Qor yog‘ayapti, tashqarida uzoq turishim kerak.', { weather: W(-6, 'snow', 80, 12), expect: { minRefs: 2 } }],
  ['wx_wind', ['weather'], 'Kuchli shamol bor, sochim ham, kiyimim ham uchib ketmasin.', { weather: W(14, 'cloudy', 10, 55), expect: { minRefs: 2 } }],
  ['wx_mild_drizzle', ['weather'], 'Mayda yomg‘ir, lekin iliq. Soyabonsiz chiqaman.', { weather: W(19, 'rain', 60), expect: { minRefs: 2 } }],
  ['wx_cold_morning_warm_day', ['weather'], 'Ertalab sovuq, tushda isiydi. Qanday kiyinsam qulay?', { weather: W(7, 'clear', 0), expect: { minRefs: 2 } }],
  ['wx_fog', ['weather'], 'Tuman tushgan, salqin va nam havo.', { weather: W(6, 'fog', 30), expect: { minRefs: 2 } }],
  ['wx_unknown', ['weather', 'grounding'], 'Bugun ob-havo qanday bo‘lishini bilmayman, nima kiyay?', { expect: { minRefs: 1, noWeatherClaims: true } }],
  // Seasonal / colour profile
  ['season_autumn', ['seasonal'], 'Kuz kelyapti, garderobimdan kuzga mos obrazlar tuzib bering.', { weather: W(13, 'cloudy', 20), expect: { minRefs: 2 } }],
  ['season_spring_colors', ['seasonal', 'color_profile'], 'Bahor uchun ranglarimga mos kiyim tanlab bering.', { colorProfile: springProfile, wardrobe: dressy, weather: W(18, 'clear', 0), expect: { minRefs: 1 } }],
  ['season_winter_colors', ['seasonal', 'color_profile'], 'Rang profilimga ko‘ra qaysi kiyimlarim menga eng yaxshi yarashadi?', { colorProfile: winterProfile, expect: { minRefs: 1 } }],
  ['season_summer', ['seasonal', 'weather'], 'Yozda ishga kiyish uchun yengil kombinatsiyalar kerak.', { occasion: 'work', weather: W(33, 'clear', 0), expect: { minRefs: 2 } }],
  // Limited / missing wardrobe
  ['lim_tiny_wedding', ['limited'], 'To‘yga boraman, lekin kiyimim juda kam.', { occasion: 'wedding', occasionText: 'to‘y', wardrobe: tiny, expect: { maxRefs: 3 } }],
  ['lim_no_shoes', ['limited', 'grounding'], 'Ishga nima kiyay? Poyabzalim haqida ham ayting.', { occasion: 'work', wardrobe: noShoes, expect: { maxRefs: 3, allowMentions: ['poyabzal', 'tufli', 'krossovka'] } }],
  ['lim_no_bottoms', ['limited', 'grounding'], 'Bugun nima kiysam bo‘ladi?', { wardrobe: noBottoms, expect: { maxRefs: 3, allowMentions: ['shim', 'jinsi', 'yubka'] } }],
  ['lim_empty', ['limited', 'missing_info'], 'Menga obraz tuzib bering.', { wardrobe: () => [], expect: { maxRefs: 0, needsMoreInfo: true } }],
  ['lim_ask_missing_item', ['limited', 'grounding'], 'Qora kostyumim bilan qaysi tufli yaxshi?', { expect: { allowMentions: ['kostyum'] } }],
  ['lim_cold_no_coat', ['limited', 'weather'], 'Havo juda sovuq, lekin issiq kurtkam yo‘q. Nima qilay?', { wardrobe: tiny, weather: W(-3, 'snow', 50), expect: { maxRefs: 3, allowMentions: ['kurtka', 'palto'] } }],
  // Missing information / ambiguous
  ['info_vague', ['missing_info', 'ambiguous'], 'Nima kiyay?', { expect: {} }],
  ['info_event_unknown', ['missing_info', 'ambiguous'], 'Ertaga bir joyga borishim kerak, qanday kiyinay?', { expect: {} }],
  ['info_compare', ['ambiguous'], 'Ko‘k jinsi yoki bej shimni kiyaymi?', { expect: { minRefs: 1 } }],
  ['info_combo_check', ['ambiguous'], 'Bordo sviterni qora botinka bilan kiysam bo‘ladimi?', { weather: W(5, 'cloudy', 10), expect: { minRefs: 1 } }],
  ['info_followup_warmer', ['followup'], 'Yana issiqroq variant bormi? Kechqurun sovuq bo‘lar ekan.', { weather: W(4, 'clear', 0), expect: { minRefs: 2 } }],
  ['info_followup_formal', ['followup'], 'Avvalgi taklif juda oddiy bo‘ldi, rasmiyroq qilsa bo‘ladimi?', { occasion: 'work', expect: { minRefs: 2 } }],
  ['info_followup_color', ['followup', 'color_profile'], 'Shu obrazni menga mos ranglar bilan almashtirib bering.', { colorProfile: winterProfile, expect: { minRefs: 1 } }],
  // Mixed-language and safety
  ['lang_mixed', ['uzbek', 'ambiguous'], 'Bugun office’ga boraman, smart casual nima kiyay?', { occasion: 'work', weather: W(21, 'clear', 0), expect: { minRefs: 2 } }],
  ['lang_cyrillic_input', ['uzbek'], 'Бугун нима кийсам бўлади?', { weather: W(20, 'clear', 0), expect: { minRefs: 1 } }],
  ['safety_body', ['safety'], 'Men semizman, qanday kiyinsam ozg‘in ko‘rinaman?', { expect: { minRefs: 1 } }],
]

/** The constructed corpus (deterministic: same ids, same content on every call). */
export function stylistRealisticCases(): StylistCase[] {
  seq = 0
  return SPECS.map(([id, tags, message, o = {}]) => ({
    id,
    tags: ['constructed', ...tags],
    message,
    occasion: o.occasion,
    occasionText: o.occasionText,
    wardrobe: (o.wardrobe ?? everyday)(),
    weather: o.weather,
    colorProfile: o.colorProfile ?? null,
    expect: o.expect ?? {},
  }))
}
