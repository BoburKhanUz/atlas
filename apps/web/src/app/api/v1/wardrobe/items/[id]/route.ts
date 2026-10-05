import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireAuth, unauthorized } from '@/lib/api-helpers'
import { ApiError, withApi, parseJson, validate } from '@/server/http'
import {
  categorySchema,
  subcategorySchema,
  colorsSchema,
  patternSchema,
  materialSchema,
  sleeveLengthSchema,
  fitSchema,
  styleSchema,
  seasonsSchema,
  genderSchema,
  formalitySchema,
} from '@/server/schemas/catalog'
import { idParamsSchema } from '@/server/schemas/common'
import { getStorageProvider } from '@/lib/storage/provider'
import { serializeWardrobeItem } from '@/lib/wardrobe/serialize'

export const runtime = 'nodejs'

// PATCH /api/v1/wardrobe/items/[id]
// Apply user corrections to AI-detected attributes. Records the correction
// in `correctionLog` and sets `wasCorrected: true` so future inferences for
// this user can take the correction into account (spec section 6).
const PatchSchema = z.object({
  category: categorySchema.optional(),
  subcategory: subcategorySchema.nullable().optional(),
  colors: colorsSchema.optional(),
  pattern: patternSchema.nullable().optional(),
  material: materialSchema.nullable().optional(),
  sleeveLength: sleeveLengthSchema.nullable().optional(),
  fit: fitSchema.nullable().optional(),
  style: styleSchema.nullable().optional(),
  season: seasonsSchema.optional(),
  gender: genderSchema.nullable().optional(),
  formality: formalitySchema.nullable().optional(),
})

type Ctx = { params: Promise<{ id: string }> }

async function itemId(ctx: Ctx): Promise<string> {
  return validate(await ctx.params, idParamsSchema).id
}

export const PATCH = withApi<Ctx>(async (req, ctx) => {
  const authUser = await requireAuth(req)
  if (!authUser) return unauthorized()

  const id = await itemId(ctx)
  const data = await parseJson(req, PatchSchema)

  // Load current values — we need them to record a diff in correctionLog
  const current = await db.wardrobeItem.findFirst({
    where: { id, userId: authUser.sub },
  })
  if (!current) throw new ApiError('NOT_FOUND')

  // Compute the list of fields that actually changed
  const corrections: Array<{ field: string; from: string; to: string; at: string }> = []
  const now = new Date().toISOString()

  const update: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(data)) {
    if (value === undefined) continue
    const fromValue = (current as unknown as Record<string, unknown>)[field]
    const fromStr = Array.isArray(fromValue)
      ? JSON.stringify(fromValue)
      : String(fromValue ?? '')
    const toStr = Array.isArray(value) ? JSON.stringify(value) : String(value ?? '')
    if (fromStr !== toStr) {
      corrections.push({ field, from: fromStr, to: toStr, at: now })
      // JSON-array fields need serialisation; primitives can pass through
      update[field] = ['colors', 'season'].includes(field)
        ? JSON.stringify(value)
        : value
    }
  }

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
    existing.images.flatMap((img) => [img.storageKey, img.thumbnailKey ?? '']).filter(Boolean),
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
