import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth, unauthorized } from '@/lib/api-helpers'
import { ApiError, withApi, parseJson } from '@/server/http'
import { ProfilePatchRequest } from '@/server/schemas/requests'

export const runtime = 'nodejs'

// GET /api/v1/profile — return current user's profile + preferences
export const GET = withApi(async (req) => {
  const authUser = await requireAuth(req)
  if (!authUser) return unauthorized()

  const user = await db.user.findUnique({
    where: { id: authUser.sub },
    select: {
      id: true,
      email: true,
      name: true,
      createdAt: true,
      profile: true,
      preferences: true,
    },
  })
  if (!user) throw new ApiError('NOT_FOUND')

  return NextResponse.json({
    user,
    profile: user.profile,
    preferences: user.preferences
      ? {
          ...user.preferences,
          preferredStyles: JSON.parse(user.preferences.preferredStyles),
          dislikedStyles: JSON.parse(user.preferences.dislikedStyles),
          favoriteColors: JSON.parse(user.preferences.favoriteColors),
          dislikedColors: JSON.parse(user.preferences.dislikedColors),
        }
      : null,
  })
})

export const PATCH = withApi(async (req) => {
  const authUser = await requireAuth(req)
  if (!authUser) return unauthorized()

  const { name, profile, preferences } = await parseJson(req, ProfilePatchRequest)

  // User.name update (separate table)
  if (name !== undefined) {
    await db.user.update({
      where: { id: authUser.sub },
      data: { name },
    })
  }

  // Upsert profile — note `language` is on UserPreferences, not UserProfile
  if (profile !== undefined) {
    await db.userProfile.upsert({
      where: { userId: authUser.sub },
      update: profile,
      create: { userId: authUser.sub, ...profile },
    })
  }

  // Upsert preferences — arrays must be serialized back to JSON strings
  if (preferences !== undefined) {
    const data: Record<string, unknown> = {}
    if (preferences.preferredStyles !== undefined)
      data.preferredStyles = JSON.stringify(preferences.preferredStyles)
    if (preferences.dislikedStyles !== undefined)
      data.dislikedStyles = JSON.stringify(preferences.dislikedStyles)
    if (preferences.favoriteColors !== undefined)
      data.favoriteColors = JSON.stringify(preferences.favoriteColors)
    if (preferences.dislikedColors !== undefined)
      data.dislikedColors = JSON.stringify(preferences.dislikedColors)
    if (preferences.language !== undefined) data.language = preferences.language

    await db.userPreferences.upsert({
      where: { userId: authUser.sub },
      update: data,
      create: { userId: authUser.sub, ...data },
    })
  }

  // Re-fetch and return fresh
  const fresh = await db.user.findUnique({
    where: { id: authUser.sub },
    select: {
      id: true,
      email: true,
      name: true,
      profile: true,
      preferences: true,
    },
  })
  return NextResponse.json({ user: fresh })
})
