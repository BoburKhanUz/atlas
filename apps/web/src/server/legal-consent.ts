/**
 * Consent to the legal texts (src/lib/legal/version.ts). Registration records
 * the first consent; after a change that needs new consent
 * (LEGAL_CONSENT_MIN_VERSION raised), the user accepts again through
 * POST /api/v1/legal/consent. Until then every authenticated route answers
 * CONSENT_REQUIRED (requireAuth), except the ones that let the user review and
 * accept the texts, sign out or delete the account.
 */
import { db } from '@/lib/db'
import { consentStillValid } from '@/lib/legal/version'
import { ApiError } from '@/server/http'

/** True when none of the user's consents covers the current texts. */
export async function consentRequired(userId: string): Promise<boolean> {
  const consents = await db.legalConsent.findMany({ where: { userId }, select: { version: true } })
  if (consents.some((c) => consentStillValid(c.version))) return false
  // No consent at all: a deleted account (its access token lives on for a few
  // minutes) is the route's business, not a consent question.
  if (consents.length === 0 && !(await db.user.findUnique({ where: { id: userId }, select: { id: true } }))) return false
  return true
}

/** Throws CONSENT_REQUIRED unless the user has accepted the current texts. */
export async function assertConsent(userId: string): Promise<void> {
  if (await consentRequired(userId)) throw new ApiError('CONSENT_REQUIRED')
}

/** Records the user's acceptance of `version` (the current one, validated by the caller); a repeat is a no-op. */
export async function recordConsent(userId: string, version: string, ageConfirmed: boolean): Promise<void> {
  const existing = await db.legalConsent.findFirst({ where: { userId, version }, select: { id: true } })
  if (!existing) await db.legalConsent.create({ data: { userId, version, ageConfirmed } })
}
