import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth, unauthorized } from '@/lib/api-helpers'
import { withApi, parseJson } from '@/server/http'
import { log } from '@/server/log'
import { OutfitGenerateRequest } from '@/server/schemas/requests'
import { getWeatherProvider } from '@/lib/weather/provider'
import {
  generateOutfits,
  type OutfitCandidate,
  type WardrobeItemSummary,
  type WeatherSnapshot,
} from '@/lib/ai/recommendation'
import { presentPrimaryImage } from '@/lib/storage/media'
import { explainOutfit } from '@/lib/ai/outfit-intelligence'

export const runtime = 'nodejs'
export const maxDuration = 60

interface GenerateResponse {
  outfits: Array<{
    tempId: string
    score: number
    factors: OutfitCandidate['factors']
    reasons: string[]
    contrastLevel: 'low' | 'medium' | 'high'
    items: Array<{
      id: string
      role: string
      category: string
      subcategory: string | null
      colors: string[]
      style: string | null
      material: string | null
      season: string[]
      imageUrl: string | null
    }>
    explanation: string | null
  }>
  weatherUsed: WeatherSnapshot | null
  occasion: string | null
  wardrobeItemCount: number
  message?: string
}

// POST /api/v1/outfits/generate
// Spec section 12: full pipeline (NOT a single LLM prompt).
export const POST = withApi(async (req) => {
  const authUser = await requireAuth(req)
  if (!authUser) return unauthorized()

  const { occasion, weather: clientWeather, lat, lon, seed, topN } = await parseJson(req, OutfitGenerateRequest)

  // ── 1. Load user's wardrobe ───────────────────────────────────────────────
  const items = await db.wardrobeItem.findMany({
    where: { userId: authUser.sub },
    include: { images: true },
    orderBy: { createdAt: 'asc' },
  })

  const wardrobe: WardrobeItemSummary[] = items.map((i) => ({
    id: i.id,
    category: i.category,
    subcategory: i.subcategory,
    colors: JSON.parse(i.colors) as string[],
    pattern: i.pattern,
    material: i.material,
    sleeveLength: i.sleeveLength,
    fit: i.fit,
    style: i.style,
    season: JSON.parse(i.season) as string[],
    gender: i.gender,
    formality: i.formality,
  }))

  if (wardrobe.length === 0) {
    return NextResponse.json<GenerateResponse>({
      outfits: [],
      weatherUsed: null,
      occasion: occasion ?? null,
      wardrobeItemCount: 0,
      message:
        'Garderobingiz bo‘sh. Avval kiyim qo‘shing — keyin sizga mos outfitlarni tavsiya qilamiz.',
    })
  }

  // ── 2. Load user profile + preferences ────────────────────────────────────
  const user = await db.user.findUnique({
    where: { id: authUser.sub },
    select: { profile: true, preferences: true },
  })

  const profile = user?.profile
    ? {
        gender: user.profile.gender,
        preferredStyles: user.preferences
          ? (JSON.parse(user.preferences.preferredStyles) as string[])
          : [],
        dislikedStyles: user.preferences
          ? (JSON.parse(user.preferences.dislikedStyles) as string[])
          : [],
        favoriteColors: user.preferences
          ? (JSON.parse(user.preferences.favoriteColors) as string[])
          : [],
        dislikedColors: user.preferences
          ? (JSON.parse(user.preferences.dislikedColors) as string[])
          : [],
        preferredFit: user.profile.preferredFit,
      }
    : undefined

  // ── 3. Resolve weather ─────────────────────────────────────────────────────
  // Priority: client-provided weather > server-fetched from lat/lon > none.
  let weather: WeatherSnapshot | undefined = clientWeather ?? undefined
  if (!weather && lat != null && lon != null) {
    try {
      const provider = getWeatherProvider()
      const w = await provider.getCurrent(lat, lon)
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
      // Soft-fail: continue without weather
    }
  }

  // ── 4. Load user feedback history (rejected / liked items) ────────────────
  // We look at the last 30 days of feedback to bias future recommendations.
  // Spec section 12: "previously rejected combinations"
  //
  // We do this in two queries to avoid Prisma `include: { outfit: {...} }`
  // chains, which can hit stale Prisma client cache in dev mode.
  const feedbackRows = await db.outfitFeedback.findMany({
    where: {
      userId: authUser.sub,
      createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    },
    select: { outfitId: true, feedback: true },
  })

  const rejectedItemIds = new Set<string>()
  const likedItemIds = new Set<string>()

  if (feedbackRows.length > 0) {
    const outfitIds = feedbackRows.map((f) => f.outfitId)
    const outfitItemsRows = await db.outfitItem.findMany({
      where: { outfitId: { in: outfitIds } },
      select: { outfitId: true, wardrobeItemId: true },
    })
    const byOutfit = new Map<string, string[]>()
    for (const oi of outfitItemsRows) {
      const arr = byOutfit.get(oi.outfitId) ?? []
      arr.push(oi.wardrobeItemId)
      byOutfit.set(oi.outfitId, arr)
    }
    for (const f of feedbackRows) {
      const itemsInThisOutfit = byOutfit.get(f.outfitId) ?? []
      if (f.feedback === 'disliked' || f.feedback === 'rejected') {
        for (const id of itemsInThisOutfit) rejectedItemIds.add(id)
      } else if (f.feedback === 'liked' || f.feedback === 'saved') {
        for (const id of itemsInThisOutfit) likedItemIds.add(id)
      }
    }
  }

  // ── 5. Run the recommendation engine (pure scoring, no LLM) ────────────────
  const candidates = generateOutfits({
    wardrobe,
    weather,
    occasion: occasion ?? undefined,
    profile,
    feedback: {
      rejectedItemIds: Array.from(rejectedItemIds),
      likedItemIds: Array.from(likedItemIds),
    },
    topN: topN ?? 3,
    seed: seed ?? Date.now(),
  })

  if (candidates.length === 0) {
    // Engine returned nothing — typically means wardrobe is too sparse
    // (e.g., only tops, no bottoms). Be honest per spec rule 13.
    return NextResponse.json<GenerateResponse>({
      outfits: [],
      weatherUsed: weather ?? null,
      occasion: occasion ?? null,
      wardrobeItemCount: wardrobe.length,
      message:
        'Garderobingizda outfit tuzish uchun yetarli xilma-xil kiyim yo‘q. ' +
        'Yana kamida bitta pastki kiyim (shim) va oyoq kiyim qo‘shing.',
    })
  }

  // ── 6. Natural-language explanation for the top candidate only ───────────
  // Spec section 17: "Nega?" expandable explanation. One AI call per generate
  // request; a failure leaves the explanation null (soft fail).
  const topExplanation = await explainOutfit(candidates[0], occasion ?? undefined)

  // ── 7. Serialize candidates for the response ──────────────────────────────
  const imageUrlFor = (itemId: string): string | null => {
    const row = items.find((i) => i.id === itemId)
    if (!row) return null
    const image = presentPrimaryImage(row.images)
    return image?.thumbnailUrl ?? image?.url ?? null
  }

  const responseOutfits = candidates.map((c, idx) => ({
    tempId: c.tempId,
    score: c.score,
    factors: c.factors,
    reasons: c.reasons,
    contrastLevel: c.contrastLevel,
    items: c.items.map((it) => ({
      id: it.item.id,
      role: it.role,
      category: it.item.category,
      subcategory: it.item.subcategory,
      colors: it.item.colors,
      style: it.item.style,
      material: it.item.material,
      season: it.item.season,
      imageUrl: imageUrlFor(it.item.id),
    })),
    explanation: idx === 0 ? topExplanation : null,
  }))

  return NextResponse.json<GenerateResponse>({
    outfits: responseOutfits,
    weatherUsed: weather ?? null,
    occasion: occasion ?? null,
    wardrobeItemCount: wardrobe.length,
  })
})
