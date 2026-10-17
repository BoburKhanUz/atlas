/**
 * Password reset by e-mail link (POST /api/v1/auth/password/forgot and
 * /api/v1/auth/password/reset).
 *
 * - A request gets the same answer whether or not the e-mail has an account:
 *   the link is made and sent in the background, so neither the answer nor
 *   its timing tells them apart.
 * - The link carries a 256-bit random token; only its SHA-256 hash is stored.
 *   It works once, for RESET_TOKEN_TTL_MINUTES. A new request replaces the
 *   user's earlier links.
 * - The reset is one session-protocol transaction: the user row and the token
 *   row are locked (in that order, as a new request locks them), the new
 *   password hash is set, the user's links are deleted and every live session
 *   family is revoked ('password_reset'), so every device signs in again.
 */
import crypto from 'crypto'
import { db } from '@/lib/db'
import { hashPassword, hashToken } from '@/lib/auth'
import { log } from '@/server/log'
import { sendMail, type MailMessage } from '@/server/mail'
import { mailLinkOrigin } from '@/server/mail-config'
import { inSessionTransaction, revokeUserFamilies } from '@/server/session/protocol'

export const RESET_TOKEN_TTL_MINUTES = 60

export function resetLink(token: string): string {
  return `${mailLinkOrigin()}/reset-password?token=${encodeURIComponent(token)}`
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** The reset e-mail (Uzbek). It names no one: only the link is personal. */
export function resetEmail(to: string, link: string): MailMessage {
  const lines = [
    'Salom!',
    'ATLAS hisobingiz uchun parolni tiklash so‘raldi. Yangi parol o‘rnatish uchun havolani oching:',
    link,
    `Havola ${RESET_TOKEN_TTL_MINUTES} daqiqa amal qiladi va faqat bir marta ishlaydi. Yangi parol o‘rnatilgach, barcha qurilmalardagi kirishlar yakunlanadi.`,
    'Agar buni siz so‘ramagan bo‘lsangiz, xatni e’tiborsiz qoldiring: parolingiz o‘zgarmaydi.',
    'ATLAS',
  ]
  const html = lines
    .map((l) => (l === link ? `<p><a href="${escapeHtml(link)}">Yangi parol o‘rnatish</a></p>` : `<p>${escapeHtml(l)}</p>`))
    .join('\n')
  return { to, subject: 'ATLAS: parolni tiklash', text: lines.join('\n\n'), html }
}

/** Makes a link for the account of `email` (already normalised), if there is one, and e-mails it. */
export async function startPasswordReset(email: string): Promise<void> {
  const user = await db.user.findUnique({ where: { email }, select: { id: true, email: true } })
  if (!user) return
  const token = crypto.randomBytes(32).toString('base64url')
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "User" WHERE "id" = ${user.id} FOR UPDATE`
    const [{ t }] = await tx.$queryRaw<{ t: Date }[]>`SELECT atlas_now() AS t`
    await tx.passwordResetToken.deleteMany({ where: { userId: user.id } })
    await tx.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        createdAt: t,
        expiresAt: new Date(t.getTime() + RESET_TOKEN_TTL_MINUTES * 60_000),
      },
    })
  })
  await sendMail(resetEmail(user.email, resetLink(token)))
  log.info('password reset link sent', { userId: user.id })
}

const pending = new Set<Promise<void>>()

/** Starts a reset in the background: the HTTP answer never waits for it. */
export function schedulePasswordReset(email: string): void {
  const task: Promise<void> = startPasswordReset(email)
    .catch((err) => log.error('password reset request failed', { err }))
    .finally(() => pending.delete(task))
  pending.add(task)
}

/** Tests: waits for the background resets started so far. */
export async function settlePasswordResets(): Promise<void> {
  while (pending.size) await Promise.all([...pending])
}

/**
 * Sets a new password with a reset token. Returns false, and changes
 * nothing, when the token is unknown, already used or expired.
 */
export async function completePasswordReset(token: string, newPassword: string): Promise<boolean> {
  // Hashed before the transaction (bcrypt is slow), also for a bad token.
  const passwordHash = await hashPassword(newPassword)
  const tokenHash = hashToken(token)
  const done = await inSessionTransaction(db, async (tx, t) => {
    const found = await tx.passwordResetToken.findUnique({ where: { tokenHash }, select: { userId: true } })
    if (!found) return null
    await tx.$queryRaw`SELECT 1 FROM "User" WHERE "id" = ${found.userId} FOR UPDATE`
    const rows = await tx.$queryRaw<{ expiresAt: Date }[]>`
      SELECT "expiresAt" FROM "PasswordResetToken" WHERE "tokenHash" = ${tokenHash} FOR UPDATE`
    if (!rows[0] || rows[0].expiresAt.getTime() <= t.getTime()) return null
    await tx.user.update({ where: { id: found.userId }, data: { passwordHash } })
    await tx.passwordResetToken.deleteMany({ where: { userId: found.userId } })
    const families = await revokeUserFamilies(tx, found.userId, t)
    return { userId: found.userId, families }
  })
  if (!done) return false
  log.info('password reset completed', done)
  return true
}
