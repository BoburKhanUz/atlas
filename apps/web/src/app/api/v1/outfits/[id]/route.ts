import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { presentImage } from '@/lib/storage/media'
import { requireAuth, unauthorized } from '@/lib/api-helpers'
import { ApiError, withApi, parseJson, validate } from '@/server/http'
import { idParamsSchema } from '@/server/schemas/common'

type Ctx = { params: Promise<{ id: string }> }

async function outfitId(ctx: Ctx): Promise<string> {
  return validate(await ctx.params, idParamsSchema).id
}

export const runtime = 'nodejs'

// GET /api/v1/outfits/[id] — fetch one outfit (must belong to current user)
export const GET = withApi<Ctx>(async (req, ctx) => {
  const authUser = await requireAuth(req)
  if (!authUser) return unauthorized()

  const id = await outfitId(ctx)
  const outfit = await db.outfit.findFirst({
    where: { id, userId: authUser.sub },
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
              images: true,
            },
          },
        },
      },
    },
  })
  if (!outfit) throw new ApiError('NOT_FOUND')

  return NextResponse.json({
    outfit: {
      ...outfit,
      reasons: JSON.parse(outfit.reasonsJson),
      weatherSnapshot: JSON.parse(outfit.weatherSnapshot || '{}'),
      items: outfit.items.map((oi) => ({
        id: oi.id,
        role: oi.role,
        wardrobeItemId: oi.wardrobeItemId,
        item: {
          ...oi.wardrobeItem,
          colors: JSON.parse(oi.wardrobeItem.colors),
          season: JSON.parse(oi.wardrobeItem.season),
          images: oi.wardrobeItem.images.map(presentImage),
        },
      })),
    },
  })
})

// PATCH /api/v1/outfits/[id] — toggle isSaved, update name/explanation
const PatchSchema = z.object({
  isSaved: z.boolean().optional(),
  name: z.string().trim().max(80).nullable().optional(),
})

export const PATCH = withApi<Ctx>(async (req, ctx) => {
  const authUser = await requireAuth(req)
  if (!authUser) return unauthorized()

  const id = await outfitId(ctx)
  const data = await parseJson(req, PatchSchema)

  // Verify ownership
  const existing = await db.outfit.findFirst({
    where: { id, userId: authUser.sub },
  })
  if (!existing) throw new ApiError('NOT_FOUND')

  const updated = await db.outfit.update({
    where: { id },
    data,
  })
  return NextResponse.json({ outfit: updated })
})

// DELETE /api/v1/outfits/[id] — remove outfit + cascade-delete items/feedback
export const DELETE = withApi<Ctx>(async (req, ctx) => {
  const authUser = await requireAuth(req)
  if (!authUser) return unauthorized()

  const id = await outfitId(ctx)
  const existing = await db.outfit.findFirst({
    where: { id, userId: authUser.sub },
  })
  if (!existing) throw new ApiError('NOT_FOUND')

  await db.outfit.delete({ where: { id } })
  return NextResponse.json({ ok: true })
})
