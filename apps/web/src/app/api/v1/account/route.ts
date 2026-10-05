import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth, unauthorized } from '@/lib/api-helpers'
import { ApiError, withApi } from '@/server/http'
import { log } from '@/server/log'
import { getStorageProvider } from '@/lib/storage/provider'

export const runtime = 'nodejs'

/**
 * DELETE /api/v1/account — delete the current user's account and ALL
 * associated data (cascade via Prisma onDelete). Spec section 29: "users
 * can delete their account" + "user data isolation".
 *
 * We rely on the Prisma schema's onDelete: Cascade relationships to remove
 * profile, preferences, wardrobe items, conversations, etc.
 *
 * NOTE: In a real production deployment we would:
 *   - Require re-entry of the user's password
 *   - Send a confirmation email
 *   - Implement a soft-delete + grace period
 * For MVP we hard-delete the user row (cascading to all owned rows) and then
 * delete the user's storage directory.
 */
export const DELETE = withApi(async (req) => {
  const authUser = await requireAuth(req)
  if (!authUser) return unauthorized()

  // Verify the user exists before deleting
  const user = await db.user.findUnique({ where: { id: authUser.sub } })
  if (!user) {
    throw new ApiError('NOT_FOUND', 'Foydalanuvchi topilmadi')
  }

  // Cascade delete — removes profile, preferences, wardrobe, outfits,
  // feedback, conversations, memories and color profiles (schema onDelete).
  await db.user.delete({ where: { id: authUser.sub } })

  // Then purge the user's image files from storage.
  try {
    await getStorageProvider().deleteOwner(authUser.sub)
  } catch (err) {
    // The account is already gone; log so leftover files can be cleaned up.
    log.warn('account storage cleanup failed after deletion', { err })
  }

  return NextResponse.json({ ok: true })
})
