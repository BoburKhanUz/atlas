import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth, unauthorized } from '@/lib/api-helpers'
import { withApi, parseJson } from '@/server/http'
import { log } from '@/server/log'
import { OutfitGenerateRequest } from '@/server/schemas/requests'
import { getWeatherProvider } from '@/lib/weather/provider'
import { generateOutfitResult, outfitKey, slotOf, type GenerateProblem, type WardrobeItemSummary, type WeatherSnapshot } from '@/lib/ai/outfit-engine'
import { rerankAndExplain } from '@/lib/ai/outfit-intelligence'
import { presentPrimaryImage } from '@/lib/storage/media'

export const runtime = 'nodejs'
export const maxDuration = 60

const FEEDBACK_DAYS = 30

/** Why no outfit could be made, for the user. */
const PROBLEM_MESSAGES: Record<GenerateProblem, string> = {
  empty_wardrobe: 'Garderobingiz bo‘sh. Avval kiyim qo‘shing — keyin sizga mos outfitlarni tavsiya qilamiz.',
  no_footwear: 'Outfit uchun oyoq kiyim kerak. Garderobingizga kamida bitta oyoq kiyim qo‘shing.',
  no_main_pieces: 'Outfit tuzish uchun yetarli kiyim yo‘q: ustki va pastki kiyim (yoki ko‘ylak-ayol) hamda oyoq kiyim qo‘shing.',
  nothing_suitable: 'Garderobingizdagi kiyimlar bugungi ob-havo yoki tadbirga mos kelmadi. Boshqa kiyimlar qo‘shib ko‘ring.',
}

const json = <T>(raw: string, fallback: T): T => {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/**
 * POST /api/v1/outfits/generate — deterministic outfit engine
 * (src/lib/ai/outfit-engine.ts) + optional AI reranking/explanation
 * (src/lib/ai/outfit-intelligence.ts). Nothing is stored. The AI step never
 * fails the request: without it (mock, quota, error) `fallback` is true and
 * the order and explanations are deterministic.
 */
export const POST = withApi(async (req) => {
  const authUser = await requireAuth(req)
  if (!authUser) return unauthorized()
  const userId = authUser.sub

  const { occasion, weather: clientWeather, lat, lon, seed, topN } = await parseJson(req, OutfitGenerateRequest)

  // ── 1. The user's own wardrobe, in a fixed order (database order never matters).
  const rows = await db.wardrobeItem.findMany({ where: { userId }, include: { images: true }, orderBy: { id: 'asc' } })
  const wardrobe: WardrobeItemSummary[] = rows.map((i) => ({
    id: i.id,
    category: i.category,
    subcategory: i.subcategory,
    colors: json<string[]>(i.colors, []),
    pattern: i.pattern,
    material: i.material,
    sleeveLength: i.sleeveLength,
    fit: i.fit,
    style: i.style,
    season: json<string[]>(i.season, []),
    gender: i.gender,
    formality: i.formality,
  }))

  // ── 2. Profile, preferences and the stored colour profile (never fabricated).
  const user = await db.user.findUnique({ where: { id: userId }, select: { profile: { include: { colorProfile: true } }, preferences: true } })
  const prefs = user?.preferences
  const profile = {
    gender: user?.profile?.gender ?? null,
    preferredStyles: prefs ? json<string[]>(prefs.preferredStyles, []) : [],
    dislikedStyles: prefs ? json<string[]>(prefs.dislikedStyles, []) : [],
    favoriteColors: prefs ? json<string[]>(prefs.favoriteColors, []) : [],
    dislikedColors: prefs ? json<string[]>(prefs.dislikedColors, []) : [],
    preferredFit: user?.profile?.preferredFit ?? null,
  }
  const cp = user?.profile?.colorProfile
  const colorProfile = cp
    ? {
        season: cp.season,
        secondarySeason: cp.secondarySeason,
        undertone: cp.undertone,
        confidence: cp.confidence,
        undertoneConfidence: cp.undertoneConfidence,
        secondaryConfidence: cp.secondaryConfidence,
        recommendedColors: json<string[]>(cp.recommendedColors, []),
        neutralColors: json<string[]>(cp.neutralColors, []),
        cautionColors: json<string[]>(cp.cautionColors, []),
      }
    : null

  // ── 3. Weather: the client's snapshot, else the weather service for the coordinates, else none.
  let weather: WeatherSnapshot | undefined = clientWeather ?? undefined
  if (!weather && lat != null && lon != null && wardrobe.length > 0) {
    try {
      const w = await getWeatherProvider().getCurrent(lat, lon)
      weather = {
        temperature: w.temperature,
        feelsLike: w.feelsLike,
        condition: w.condition,
        precipitationProbability: w.precipitationProbability,
        humidity: w.humidity,
        windSpeed: w.windSpeed,
        uvIndex: w.uvIndex,
      }
    } catch (err) {
      log.warn('outfit generate: weather fetch failed', { err })
    }
  }

  // ── 4. Real feedback from the last 30 days: liked/rejected items and rejected compositions.
  const feedbackRows = await db.outfitFeedback.findMany({
    where: { userId, createdAt: { gte: new Date(Date.now() - FEEDBACK_DAYS * 86_400_000) } },
    select: { outfitId: true, feedback: true },
  })
  const rejectedItemIds = new Set<string>()
  const likedItemIds = new Set<string>()
  const rejectedOutfitKeys = new Set<string>()
  if (feedbackRows.length > 0) {
    const outfitItems = await db.outfitItem.findMany({
      where: { outfitId: { in: [...new Set(feedbackRows.map((f) => f.outfitId))] }, outfit: { userId } },
      select: { outfitId: true, wardrobeItem: { select: { id: true, category: true } } },
    })
    const byOutfit = new Map<string, Array<{ id: string; category: string }>>()
    for (const oi of outfitItems) byOutfit.set(oi.outfitId, [...(byOutfit.get(oi.outfitId) ?? []), oi.wardrobeItem])
    for (const f of feedbackRows) {
      const items = byOutfit.get(f.outfitId) ?? []
      if (f.feedback === 'disliked' || f.feedback === 'rejected') {
        for (const i of items) rejectedItemIds.add(i.id)
        const main = items
          .map((i) => ({ item: { id: i.id }, slot: slotOf({ category: i.category } as WardrobeItemSummary) }))
          .filter((p): p is { item: { id: string }; slot: NonNullable<typeof p.slot> } => !!p.slot && p.slot !== 'accessory')
        if (main.length > 0) rejectedOutfitKeys.add(outfitKey(main))
      } else if (f.feedback === 'liked' || f.feedback === 'saved') {
        for (const i of items) likedItemIds.add(i.id)
      }
    }
  }

  // ── 5. The deterministic engine.
  const result = generateOutfitResult({
    wardrobe,
    weather,
    occasion: occasion ?? undefined,
    profile,
    colorProfile,
    feedback: { rejectedItemIds: [...rejectedItemIds].sort(), likedItemIds: [...likedItemIds].sort(), rejectedOutfitKeys: [...rejectedOutfitKeys].sort() },
    topN: topN ?? 3,
    seed,
  })

  if (result.outfits.length === 0) {
    return NextResponse.json({
      outfits: [],
      weatherUsed: weather ?? null,
      occasion: occasion ?? null,
      wardrobeItemCount: wardrobe.length,
      fallback: true,
      message: PROBLEM_MESSAGES[result.problem ?? 'nothing_suitable'],
    })
  }

  // ── 6. Optional AI reranking + explanation (deterministic fallback on any failure).
  const ranked = await rerankAndExplain({ userId, candidates: result.outfits, occasion: occasion ?? undefined, weather: result.weather, colorProfile })

  const imageUrlFor = (itemId: string): string | null => {
    const row = rows.find((i) => i.id === itemId)
    if (!row) return null
    const image = presentPrimaryImage(row.images)
    return image?.thumbnailUrl ?? image?.url ?? null
  }

  return NextResponse.json({
    outfits: ranked.outfits.map(({ candidate: c, explanation }) => ({
      tempId: c.tempId,
      score: c.score,
      factors: c.factors,
      reasons: c.reasons,
      reasonLabels: c.reasonLabels,
      contrastLevel: c.contrastLevel,
      items: c.items.map((it) => ({
        id: it.item.id,
        role: it.role,
        layeringRole: it.slot,
        category: it.item.category,
        subcategory: it.item.subcategory,
        colors: it.item.colors,
        style: it.item.style,
        material: it.item.material,
        season: it.item.season,
        imageUrl: imageUrlFor(it.item.id),
      })),
      explanation,
    })),
    weatherUsed: weather ?? null,
    occasion: occasion ?? null,
    wardrobeItemCount: wardrobe.length,
    fallback: ranked.fallback,
  })
})
