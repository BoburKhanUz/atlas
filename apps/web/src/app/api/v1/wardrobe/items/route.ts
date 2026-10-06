import { NextResponse } from 'next/server'
import type { WardrobeImage, WardrobeItem } from '@prisma/client'
import { db } from '@/lib/db'
import { requireAuth, unauthorized } from '@/lib/api-helpers'
import { ApiError, withApi, parseForm, validate, UPLOAD_BODY_LIMIT } from '@/server/http'
import { WardrobeListQuery } from '@/server/schemas/requests'
import {
  ImageDimensionsError,
  InvalidImageError,
  UnsupportedImageFormatError,
  checkImageEnvelope,
  getStorageProvider,
  type StoredImage,
} from '@/lib/storage/provider'
import { serializeWardrobeItem } from '@/lib/wardrobe/serialize'
import { analyzeGarment, type ClothingDetection } from '@/lib/ai/vision-service'
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  idempotencyKeyOf,
  multipartRequestHash,
  releaseIdempotencyKey,
  type Claim,
} from '@/server/idempotency'

export const runtime = 'nodejs'
export const maxDuration = 60 // image processing can be slow on cold start

const ROUTE = 'POST /api/v1/wardrobe/items'

/** Detection as stored on the item (used when replaying an idempotent request). */
function detectionFromItem(item: WardrobeItem): ClothingDetection {
  return {
    category: item.category,
    subcategory: item.subcategory,
    colors: JSON.parse(item.colors) as string[],
    pattern: item.pattern,
    material: item.material,
    sleeveLength: item.sleeveLength,
    fit: item.fit,
    style: item.style,
    season: JSON.parse(item.season) as string[],
    gender: item.gender,
    formality: item.formality,
    confidence: JSON.parse(item.confidences) as Record<string, number>,
    mock: true,
  }
}

function itemResponse(item: WardrobeItem & { images: WardrobeImage[] }, detection: ClothingDetection, replayed = false) {
  return NextResponse.json(
    { item: serializeWardrobeItem(item), detection },
    { status: 201, headers: replayed ? { 'Idempotent-Replayed': 'true' } : {} },
  )
}

/**
 * POST /api/v1/wardrobe/items
 * Multipart form-data:
 *   - file: image (required) — JPEG, PNG or WebP, ≤ 8 MB; shortest side
 *     ≥ 256 px, no side > 8000 px. HEIC/HEIF/AVIF → 415 (clients convert).
 *   - filename: optional override (defaults to file.name)
 * Optional header `Idempotency-Key` (8–128 chars [A-Za-z0-9_-]): a retry with
 * the same key and payload within 24 h returns the original item (201,
 * `Idempotent-Replayed: true`) instead of creating a duplicate.
 *
 * Returns the saved wardrobe item with AI-detected attributes. The frontend
 * can then `PATCH` to apply user corrections before showing the final state.
 * Spec section 7 flow: Upload → AI analysis → show attributes → confirm/save.
 */
export const POST = withApi(async (req) => {
  const authUser = await requireAuth(req)
  if (!authUser) return unauthorized()
  const idempotencyKey = idempotencyKeyOf(req)

  // Size/type checks happen before the body is read.
  const formData = await parseForm(req, UPLOAD_BODY_LIMIT)
  const file = formData.get('file')
  if (!(file instanceof File)) {
    throw new ApiError('BAD_REQUEST', 'Rasm fayli topilmadi')
  }
  const envelope = checkImageEnvelope({ type: file.type, size: file.size })
  if (envelope === 'unsupported_type') throw new ApiError('UNSUPPORTED_IMAGE_FORMAT')
  if (envelope === 'too_large') throw new ApiError('PAYLOAD_TOO_LARGE', 'Rasm hajmi 8 MB dan oshmasligi kerak')

  const buffer = Buffer.from(await file.arrayBuffer())
  const filenameField = formData.get('filename')
  const filename = typeof filenameField === 'string' && filenameField ? filenameField : file.name

  // Idempotency: claim the key before doing any work.
  let claim: Extract<Claim, { kind: 'claimed' }> | null = null
  if (idempotencyKey) {
    const fields: Record<string, string> = {}
    for (const [name, value] of formData.entries()) if (name !== 'file' && typeof value === 'string') fields[name] = value
    const result = await claimIdempotencyKey(db, {
      userId: authUser.sub,
      route: ROUTE,
      key: idempotencyKey,
      requestHash: multipartRequestHash({ fileBytes: buffer, filename: file.name, fields }),
    })
    if (result.kind === 'replay') {
      const original = result.resourceId
        ? await db.wardrobeItem.findFirst({ where: { id: result.resourceId, userId: authUser.sub }, include: { images: true } })
        : null
      if (!original) throw new ApiError('NOT_FOUND', 'Bu so‘rov bilan yaratilgan buyum o‘chirilgan')
      return itemResponse(original, detectionFromItem(original), true)
    }
    claim = result
  }

  const storage = getStorageProvider()
  let stored: StoredImage | null = null
  try {
    // 1. Store the image variants. The bytes are decoded here: wrong formats
    // (HEIC…) → 415, wrong dimensions → 422 IMAGE_DIMENSIONS, garbage → 422.
    try {
      stored = await storage.saveImage(buffer, authUser.sub)
    } catch (err) {
      if (err instanceof UnsupportedImageFormatError) throw new ApiError('UNSUPPORTED_IMAGE_FORMAT')
      if (err instanceof ImageDimensionsError) throw new ApiError('IMAGE_DIMENSIONS')
      if (err instanceof InvalidImageError) throw new ApiError('INVALID_IMAGE')
      throw err
    }
    const image = stored

    // 2. Clothing analysis (VisionService; the deterministic mock until Phase 4.1)
    const detection = await analyzeGarment({ buffer, filename })

    // 3. Persist the item + image row (+ complete the idempotency key) in one transaction.
    const item = await db.$transaction(async (tx) => {
      const created = await tx.wardrobeItem.create({
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
                storageKey: image.key,
                displayKey: image.displayKey,
                thumbnailKey: image.thumbnailKey,
                isPrimary: true,
                width: image.width,
                height: image.height,
                mimeType: image.mimeType,
                bytes: image.bytes,
                sha256: image.sha256,
              },
            ],
          },
        },
        include: { images: true },
      })
      if (claim) await completeIdempotencyKey(tx, claim, created.id, 201)
      return created
    })
    return itemResponse(item, detection)
  } catch (err) {
    // Nothing may be left behind: remove any stored variants, forget the claim.
    if (stored) await storage.deleteObjects([stored.key, stored.displayKey, stored.thumbnailKey]).catch(() => {})
    if (claim) await releaseIdempotencyKey(db, claim).catch(() => {})
    throw err
  }
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
  const { category, limit, cursor } = validate(raw, WardrobeListQuery)

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
