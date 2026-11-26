import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth, unauthorized } from '@/lib/api-helpers'
import { ApiError, withApi, parseJson, validate } from '@/server/http'
import { WardrobeItemPatchRequest } from '@/server/schemas/requests'
import { idParamsSchema } from '@/server/schemas/common'
import { getStorageProvider } from '@/lib/storage/provider'
import { serializeWardrobeItem } from '@/lib/wardrobe/serialize'
import { SUBCATEGORY_MISMATCH_MESSAGE, computeCorrections, subcategoryMismatch } from '@/lib/wardrobe/corrections'

export const runtime = 'nodejs'

// PATCH /api/v1/wardrobe/items/[id]
// Apply user corrections to AI-detected attributes. Records the correction
// in `correctionLog` and sets `wasCorrected: true` so future inferences for
// this user can take the correction into account (spec section 6).
type Ctx = { params: Promise<{ id: string }> }

async function itemId(ctx: Ctx): Promise<string> {
  return validate(await ctx.params, idParamsSchema).id
}

export const PATCH = withApi<Ctx>(async (req, ctx) => {
  const authUser = await requireAuth(req)
  if (!authUser) return unauthorized()

  const id = await itemId(ctx)
  const data = await parseJson(req, WardrobeItemPatchRequest)

  // Load current values — we need them to record a diff in correctionLog
  const current = await db.wardrobeItem.findFirst({
    where: { id, userId: authUser.sub },
  })
  if (!current) throw new ApiError('NOT_FOUND')

  // The subcategory must belong to the category the item ends up with.
  if (subcategoryMismatch(current, data)) {
    const message = SUBCATEGORY_MISMATCH_MESSAGE
    throw new ApiError('VALIDATION_ERROR', message, [{ path: 'subcategory', message }])
  }

  // The fields that actually changed
  const { corrections, update } = computeCorrections(current, data, new Date().toISOString())

  if (Object.keys(update).length === 0) {
    // No-op patch — just return current item (with JSON fields deserialised)
    const fresh = await db.wardrobeItem.findUnique({
      where: { id },
      include: { images: true },
    })
    if (!fresh) throw new ApiError('NOT_FOUND')
    return NextResponse.json({
      item: serializeWardrobeItem(fresh),
      corrections: [],
    })
  }

  if (corrections.length > 0) {
    update.wasCorrected = true
    const existingLog = JSON.parse(current.correctionLog || '[]') as typeof corrections
    update.correctionLog = JSON.stringify([...existingLog, ...corrections])
  }

  const updated = await db.wardrobeItem.update({
    where: { id },
    data: update,
    include: { images: true },
  })

  // Deserialise JSON fields for the frontend — same shape as GET
  return NextResponse.json({
    item: serializeWardrobeItem(updated),
    corrections,
  })
})

export const DELETE = withApi<Ctx>(async (req, ctx) => {
  const authUser = await requireAuth(req)
  if (!authUser) return unauthorized()

  const id = await itemId(ctx)

  // Authorization check: confirm this item belongs to the requesting user
  // before deleting (spec section 28, 29).
  const existing = await db.wardrobeItem.findFirst({
    where: { id, userId: authUser.sub },
    include: { images: true },
  })
  if (!existing) throw new ApiError('NOT_FOUND')

  await db.wardrobeItem.delete({ where: { id } })
  // Remove the image files too — the DB rows are gone via cascade.
  await getStorageProvider().deleteObjects(
    existing.images.flatMap((img) => [img.storageKey, img.displayKey, img.thumbnailKey]),
  )
  return NextResponse.json({ ok: true })
})

export const GET = withApi<Ctx>(async (req, ctx) => {
  const authUser = await requireAuth(req)
  if (!authUser) return unauthorized()

  const id = await itemId(ctx)
  const item = await db.wardrobeItem.findFirst({
    where: { id, userId: authUser.sub },
    include: { images: true },
  })
  if (!item) throw new ApiError('NOT_FOUND')

  return NextResponse.json({ item: serializeWardrobeItem(item) })
})
