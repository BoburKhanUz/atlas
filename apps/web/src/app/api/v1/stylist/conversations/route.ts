import { NextResponse } from 'next/server'
import { requireAuth, unauthorized } from '@/lib/api-helpers'
import { withApi } from '@/server/http'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

// GET /api/v1/stylist/conversations — list of the user's conversations.
// Spec section 13, 23.
export const GET = withApi(async (req) => {
  const authUser = await requireAuth(req)
  if (!authUser) return unauthorized()

  const conversations = await db.aiConversation.findMany({
    where: { userId: authUser.sub },
    orderBy: { updatedAt: 'desc' },
    take: 50,
    select: {
      id: true,
      title: true,
      updatedAt: true,
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { content: true, role: true, createdAt: true },
      },
    },
  })

  const out = conversations.map((c) => ({
    id: c.id,
    title: c.title,
    updatedAt: c.updatedAt,
    lastMessage: c.messages[0]?.content ?? null,
    lastRole: c.messages[0]?.role ?? null,
  }))

  return NextResponse.json({ conversations: out })
})
