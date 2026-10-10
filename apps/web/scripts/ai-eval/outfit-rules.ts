/**
 * Independent outfit rules (what a stylist would require), shared by the
 * realistic engine validation (real-data/outfit-realistic.ts) and the outfit
 * fixture evaluator (outfit-fixtures.ts). Written independently of the
 * engine's scoring. Each rule returns a stable tag; the tag prefix says which
 * metric it belongs to: validity_ / layering_ (structure), weather_,
 * occasion_, preference_.
 */
export interface RuleItem {
  id: string
  category: string
  subcategory: string | null
  colors: readonly string[]
  material: string | null
}

export interface RuleContext {
  /** Ids of everything the user owns: an item outside it is foreign. */
  wardrobeIds: ReadonlySet<string>
  /** Feels-like temperature (°C); undefined = no weather. */
  feelsLike?: number
  /** Weather condition id (rain, snow…); undefined = no weather. */
  condition?: string
  /** The wardrobe has an outer layer (so a cold outfit without one is avoidable). */
  hasOuter: boolean
  /** The occasion requires formal pieces (no shorts, t-shirts or sneakers). */
  formal?: boolean
  /** Disliked colours, checked only when `checkPreference` (the top outfit, when avoidable). */
  dislikedColors?: ReadonlySet<string>
  checkPreference?: boolean
}

/** The failed rules of one outfit (empty when every rule holds). */
export function outfitRuleViolations(items: readonly RuleItem[], ctx: RuleContext): string[] {
  const failed: string[] = []
  const cats = items.map((i) => i.category)
  const subs = items.map((i) => i.subcategory ?? '')
  if (!cats.includes('shoes')) failed.push('validity_no_footwear')
  if (!(cats.includes('dress') || (cats.includes('shirt') && cats.includes('pants')))) failed.push('validity_no_main_pieces')
  if (new Set(items.map((i) => i.id)).size !== items.length) failed.push('validity_duplicate_item')
  if (items.some((i) => !ctx.wardrobeIds.has(i.id))) failed.push('validity_foreign_item')
  if (cats.filter((x) => x === 'outerwear').length > 1) failed.push('layering_two_outer_layers')
  if (cats.includes('dress') && cats.includes('pants')) failed.push('layering_dress_with_bottoms')
  const feels = ctx.feelsLike
  if (feels !== undefined && feels <= 5) {
    if (ctx.hasOuter && !cats.includes('outerwear')) failed.push('weather_cold_without_outer_layer')
    if (subs.includes('shorts') || subs.includes('sandals')) failed.push('weather_cold_shorts_or_sandals')
  }
  if (feels !== undefined && feels >= 30 && (subs.includes('coat') || items.some((i) => i.subcategory === 'knit' && i.material === 'wool'))) failed.push('weather_heat_heavy_layer')
  if ((ctx.condition === 'rain' || ctx.condition === 'snow') && subs.includes('sandals')) failed.push('weather_wet_sandals')
  if (ctx.formal && (subs.includes('shorts') || subs.includes('tshirt') || subs.includes('sneakers'))) failed.push('occasion_formal_casual_piece')
  if (ctx.checkPreference && ctx.dislikedColors?.size && items.some((i) => i.colors.some((col) => ctx.dislikedColors!.has(col)))) failed.push('preference_disliked_color_in_top_outfit')
  return failed
}
