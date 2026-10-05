import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireAuth, unauthorized } from '@/lib/api-helpers'
import { ApiError, withApi, parseForm, validate, UPLOAD_BODY_LIMIT } from '@/server/http'
import { categorySchema } from '@/server/schemas/catalog'
import { idSchema } from '@/server/schemas/common'
import { getStorageProvider, validateImageFile, InvalidImageError } from '@/lib/storage/provider'
import { serializeWardrobeItem } from '@/lib/wardrobe/serialize'
import { analyzeClothing } from '@/lib/ai/mock-vision'

export const runtime = 'nodejs'
export const maxDuration = 60 // image processing can be slow on cold start

/**
 * POST /api/v1/wardrobe/items
 * Multipart form-data:
 *   - file: image (required)
 *   - filename: optional override (defaults to file.name)
 *
 * Returns the saved wardrobe item with AI-detected attributes. The frontend
 * can then `PATCH` to apply user corrections before showing the final state.
 *
 * Spec section 7 flow: Upload → AI analysis → show attributes → confirm/save.
 * In this MVP we combine upload + analysis into one call to keep the UX
 * extremely fast, and treat the saved row as "pending confirmation".
 */
export const POST = withApi(async (req) => {
  const authUser = await requireAuth(req)
  if (!authUser) return unauthorized()

  // Size/type checks happen before the body is read.
  const formData = await parseForm(req, UPLOAD_BODY_LIMIT)
  const file = formData.get('file')
  if (!(file instanceof File)) {
    throw new ApiError('BAD_REQUEST', 'Rasm fayli topilmadi')
  }

  const validationError = validateImageFile({
    name: file.name,
    type: file.type,
    size: file.size,
  })
  if (validationError) {
    throw new ApiError('INVALID_IMAGE', validationError)
  }

  // Convert File → Buffer for storage + sharp analysis
  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  // 1. Store image (original + thumbnail). The bytes are decoded here, so a
  // non-image with a spoofed MIME type is rejected with 422.
  const storage = getStorageProvider()
  let stored
  try {
    stored = await storage.saveImage(buffer, authUser.sub)
  } catch (err) {
    if (err instanceof InvalidImageError) {
      throw new ApiError('INVALID_IMAGE')
    }
    throw err
  }

  // If anything below fails, remove the stored files so they are not orphaned.
  let detection: Awaited<ReturnType<typeof analyzeClothing>>
  let item
  try {
    // 2. Run mock vision analysis
    detection = await analyzeClothing({
      buffer,
      filename: file.name,
    })

    // 3. Persist the wardrobe item with detected attributes (transactional:
    // item + image row)
    item = await db.$transaction(async (tx) => {
      const wardrobItem = await tx.wardrobeItem.create({
        data: {
          userId: authUser.sub,
          category: detection.category,
          subcategory: detection.subcategory,
          colors: JSON.stringify(detection.colors),
          pattern: detection.pattern,
          material: detection.material,
          sleeveLength: detection.sleeveLength,
          fit: detection.fit,
          style: detection.style,
          season: JSON.stringify(detection.season),
          gender: detection.gender,
          formality: detection.formality,
          confidences: JSON.stringify(detection.confidence),
          wasCorrected: false,
          correctionLog: '[]',
          images: {
            create: [
              {
                storageKey: stored.key,
                thumbnailKey: stored.thumbnailKey,
                isPrimary: true,
                width: stored.width,
                height: stored.height,
              },
            ],
          },
        },
        include: { images: true },
      })
      return wardrobItem
    })
  } catch (err) {
    await storage.deleteObjects([stored.key, stored.thumbnailKey]).catch(() => {})
    throw err
  }

  return NextResponse.json({ item: serializeWardrobeItem(item), detection }, { status: 201 })
})

const ListQuerySchema = z.object({
  category: z.union([z.literal('all'), categorySchema]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  cursor: idSchema.optional(),
})

/**
 * GET /api/v1/wardrobe/items?category=...&limit=...&cursor=...
 * Returns the current user's wardrobe items (newest first), scoped by
 * category. Cursor pagination: `cursor` is the id of the last item of the
 * previous page; the response is `{ items, nextCursor }` (null on the last page).
 */
export const GET = withApi(async (req) => {
  const authUser = await requireAuth(req)
  if (!authUser) return unauthorized()

  const params = new URL(req.url).searchParams
  const raw: Record<string, string> = {}
  for (const key of ['category', 'limit', 'cursor']) {
    const v = params.get(key)
    if (v) raw[key] = v
  }
  const { category, limit, cursor } = validate(raw, ListQuerySchema)

  const rows = await db.wardrobeItem.findMany({
    where: {
      userId: authUser.sub,
      ...(category && category !== 'all' ? { category } : {}),
    },
    include: { images: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  })

  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  return NextResponse.json({
    items: page.map(serializeWardrobeItem),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  })
})
