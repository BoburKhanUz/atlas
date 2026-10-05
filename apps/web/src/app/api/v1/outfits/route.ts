import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { presentPrimaryImage } from '@/lib/storage/media'
import { requireAuth, unauthorized } from '@/lib/api-helpers'
import { ApiError, withApi, parseJson, validate } from '@/server/http'
import { OutfitListQuery, OutfitSaveRequest } from '@/server/schemas/requests'

export const runtime = 'nodejs'

// GET /api/v1/outfits — list user's saved/generated outfits.
// Spec section 23.
export const GET = withApi(async (req) => {
  const authUser = await requireAuth(req)
  if (!authUser) return unauthorized()

  const savedParam = new URL(req.url).searchParams.get('saved')
  const query = validate(savedParam ? { saved: savedParam } : {}, OutfitListQuery)
  const savedOnly = query.saved === '1' || query.saved === 'true'

  const outfits = await db.outfit.findMany({
    where: {
      userId: authUser.sub,
      ...(savedOnly ? { isSaved: true } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: {
      items: {
        include: {
          wardrobeItem: {
            select: {
              id: true,
              category: true,
              subcategory: true,
              colors: true,
              style: true,
              material: true,
              season: true,
              images: {
                select: { id: true, storageKey: true, displayKey: true, thumbnailKey: true, isPrimary: true },
              },
            },
          },
        },
      },
    },
  })

  const out = outfits.map((o) => ({
    id: o.id,
    name: o.name,
    occasion: o.occasion,
    score: o.score,
    reasons: JSON.parse(o.reasonsJson),
    explanation: o.explanation,
    isSaved: o.isSaved,
    weatherSnapshot: JSON.parse(o.weatherSnapshot || '{}'),
    createdAt: o.createdAt,
    items: o.items.map((oi) => ({
      id: oi.wardrobeItem.id,
      role: oi.role,
      category: oi.wardrobeItem.category,
      subcategory: oi.wardrobeItem.subcategory,
      colors: JSON.parse(oi.wardrobeItem.colors),
      style: oi.wardrobeItem.style,
      material: oi.wardrobeItem.material,
      season: JSON.parse(oi.wardrobeItem.season),
      image: presentPrimaryImage(oi.wardrobeItem.images),
    })),
  }))

  return NextResponse.json({ outfits: out })
})

// POST /api/v1/outfits — persist a generated outfit (after user clicked Save
// or after generation). Spec section 12, 17.
export const POST = withApi(async (req) => {
  const authUser = await requireAuth(req)
  if (!authUser) return unauthorized()

  const { items, occasion, weather, name, score, reasons, explanation, isSaved } = await parseJson(
    req,
    OutfitSaveRequest,
  )

  // Authorisation: ensure all item ids belong to this user before linking
  const itemIds = Array.from(new Set(items.map((i) => i.itemId)))
  const owned = await db.wardrobeItem.findMany({
    where: { id: { in: itemIds }, userId: authUser.sub },
    select: { id: true },
  })
  if (owned.length !== itemIds.length) {
    throw new ApiError('FORBIDDEN', "Ba'zi kiyimlar topilmadi yoki sizga tegishli emas")
  }

  const outfit = await db.outfit.create({
    data: {
      userId: authUser.sub,
      name: name || null,
      occasion: occasion ?? null,
      weatherSnapshot: JSON.stringify(weather ?? {}),
      score: score == null ? null : Math.round(score),
      reasonsJson: JSON.stringify(reasons ?? []),
      explanation: explanation ?? null,
      isSaved: isSaved ?? false,
      items: {
        create: items.map((it) => ({
          wardrobeItemId: it.itemId,
          role: it.role,
        })),
      },
    },
    include: { items: true },
  })

  return NextResponse.json({ outfit }, { status: 201 })
})
