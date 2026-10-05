import { NextResponse } from 'next/server'
import { requireAuth, unauthorized } from '@/lib/api-helpers'
import { db } from '@/lib/db'
import { ApiError, withApi, validate } from '@/server/http'
import { idParamsSchema } from '@/server/schemas/common'

export const runtime = 'nodejs'

// GET /api/v1/stylist/conversations/[id] — load full conversation with all
// messages. Used when the user reopens an old chat.
export const GET = withApi<{ params: Promise<{ id: string }> }>(async (req, ctx) => {
  const authUser = await requireAuth(req)
  if (!authUser) return unauthorized()

  const { id } = validate(await ctx.params, idParamsSchema)
  const conversation = await db.aiConversation.findFirst({
    where: { id, userId: authUser.sub },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, role: true, content: true, createdAt: true },
      },
    },
  })
  if (!conversation) throw new ApiError('NOT_FOUND')

  return NextResponse.json({ conversation })
})
