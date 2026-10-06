import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { presentPrimaryImage } from '@/lib/storage/media'
import { requireAuth, unauthorized } from '@/lib/api-helpers'
import { ApiError, withApi, parseJson, validate } from '@/server/http'
import { OutfitListQuery, OutfitSaveRequest } from '@/server/schemas/requests'
import { CATEGORY_SLOT } from '@/lib/ai/outfit-config'
import { ROLES_FOR_SLOT, SAVE_ROLES, validateComposition, type CompositionError } from '@/lib/ai/outfit-engine'

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

const COMPOSITION_MESSAGES: Record<CompositionError, string> = {
  duplicate_item: 'Bitta kiyim outfitda ikki marta bo‘lishi mumkin emas',
  unknown_category: 'Kiyim turi outfit uchun mos emas',
  missing_footwear: 'Outfitda oyoq kiyim bo‘lishi kerak',
  multiple_footwear: 'Outfitda bitta oyoq kiyim bo‘lishi kerak',
  missing_main: 'Outfitda ustki va pastki kiyim yoki ko‘ylak (ayol) bo‘lishi kerak',
  dress_with_top_or_bottom: 'Ko‘ylak (ayol) boshqa ustki yoki pastki kiyim bilan birga saqlanmaydi',
  multiple_primary: 'Har bir asosiy qismdan (ustki, pastki, ko‘ylak, ustki kiyim) bittadan bo‘lishi kerak',
  too_many_accessories: 'Aksessuarlar juda ko‘p',
}

// POST /api/v1/outfits — persist a generated outfit (after user clicked Save
// or after generation). Spec section 12, 17. Phase 4.4: the items must form a
// valid outfit (roles, composition, no duplicates); score and reasons are
// stored as supplied by the generation result (not recomputed).
export const POST = withApi(async (req) => {
  const authUser = await requireAuth(req)
  if (!authUser) return unauthorized()

  const { items, occasion, weather, name, score, reasons, explanation, isSaved } = await parseJson(
    req,
    OutfitSaveRequest,
  )

  const invalid = (message: string, path = 'items'): never => {
    throw new ApiError('VALIDATION_ERROR', message, [{ path, message }])
  }
  items.forEach((it, i) => {
    if (!(SAVE_ROLES as readonly string[]).includes(it.role)) invalid(`Noma’lum rol: ${SAVE_ROLES.join(', ')} bo‘lishi kerak`, `items.${i}.role`)
  })
  if (new Set(items.map((i) => i.itemId)).size !== items.length) invalid(COMPOSITION_MESSAGES.duplicate_item)

  // Authorisation: ensure all item ids belong to this user before linking
  const itemIds = items.map((i) => i.itemId)
  const owned = await db.wardrobeItem.findMany({
    where: { id: { in: itemIds }, userId: authUser.sub },
    select: { id: true, category: true },
  })
  if (owned.length !== itemIds.length) {
    throw new ApiError('FORBIDDEN', "Ba'zi kiyimlar topilmadi yoki sizga tegishli emas")
  }
  const categoryOf = new Map(owned.map((o) => [o.id, o.category]))
  items.forEach((it, i) => {
    const slot = CATEGORY_SLOT[categoryOf.get(it.itemId) ?? '']
    if (slot && !ROLES_FOR_SLOT[slot].includes(it.role)) invalid(`Rol kiyim turiga mos emas (${ROLES_FOR_SLOT[slot].join(' / ')})`, `items.${i}.role`)
  })
  const composition = validateComposition(itemIds.map((id) => ({ id, category: categoryOf.get(id)! })))
  if (composition) invalid(COMPOSITION_MESSAGES[composition])

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
