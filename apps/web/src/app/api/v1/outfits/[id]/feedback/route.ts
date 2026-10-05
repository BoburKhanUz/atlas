import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireAuth, unauthorized } from '@/lib/api-helpers'
import { ApiError, withApi, parseJson, validate } from '@/server/http'
import { idParamsSchema } from '@/server/schemas/common'

export const runtime = 'nodejs'

// POST /api/v1/outfits/[id]/feedback — record user feedback (liked/disliked/
// saved/rejected). Spec section 12 ("previously rejected combinations") +
// section 17 ("👍 Yoqdi / 👎 Yoqmadi / ❤️ Saqlash / 🔄 Boshqa variant").
const FeedbackSchema = z.object({
  feedback: z.enum(['liked', 'disliked', 'saved', 'rejected']),
  note: z.string().trim().max(500).optional(),
})

export const POST = withApi<{ params: Promise<{ id: string }> }>(async (req, ctx) => {
  const authUser = await requireAuth(req)
  if (!authUser) return unauthorized()

  const { id } = validate(await ctx.params, idParamsSchema)
  const data = await parseJson(req, FeedbackSchema)

  // Verify ownership of the outfit
  const outfit = await db.outfit.findFirst({
    where: { id, userId: authUser.sub },
  })
  if (!outfit) throw new ApiError('NOT_FOUND')

  // Create the feedback row
  const feedback = await db.outfitFeedback.create({
    data: {
      userId: authUser.sub,
      outfitId: id,
      feedback: data.feedback,
      note: data.note ?? null,
    },
  })

  // If the feedback is "saved" → also flip outfit.isSaved = true
  if (data.feedback === 'saved' && !outfit.isSaved) {
    await db.outfit.update({
      where: { id },
      data: { isSaved: true },
    })
  }
  // If "rejected" → flip isSaved back off (user changed their mind)
  if (data.feedback === 'rejected' && outfit.isSaved) {
    await db.outfit.update({
      where: { id },
      data: { isSaved: false },
    })
  }

  return NextResponse.json({ feedback }, { status: 201 })
})
