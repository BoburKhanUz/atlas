/**
 * Version of the legal documents (privacy policy and terms of use) that a user
 * accepts when registering. Bump LEGAL_VERSION with every change to
 * documents.ts: each consent stores the version it accepted (LegalConsent).
 * Format `YYYY-MM-DD.N`, with `-draft` while counsel has not approved the texts.
 * Kept apart from the texts so client components can import it cheaply.
 */
export const LEGAL_VERSION = '2026-10-17.2-draft'

/**
 * The oldest accepted version that still counts. A user whose consents are all
 * older must accept the current texts again before using the app: every
 * authenticated route except review, accept, sign-out and account deletion
 * answers CONSENT_REQUIRED (src/server/legal-consent.ts). Raise it to
 * LEGAL_VERSION when a change needs new consent (a new use of data, a new
 * provider, new terms); leave it for wording fixes.
 */
export const LEGAL_CONSENT_MIN_VERSION = '2026-10-17.2-draft'

const VERSION_FORMAT = /^(\d{4}-\d{2}-\d{2})\.(\d+)(-draft)?$/

/**
 * Orders two versions: by date, then number, and a draft before the final text
 * of the same date and number. NaN when either is malformed.
 */
export function compareLegalVersions(a: string, b: string): number {
  const pa = VERSION_FORMAT.exec(a)
  const pb = VERSION_FORMAT.exec(b)
  if (!pa || !pb) return NaN
  if (pa[1] !== pb[1]) return pa[1] < pb[1] ? -1 : 1
  const na = Number(pa[2])
  const nb = Number(pb[2])
  if (na !== nb) return na < nb ? -1 : 1
  return (pa[3] ? 0 : 1) - (pb[3] ? 0 : 1)
}

/** Whether a consent to `accepted` still covers the current texts. */
export function consentStillValid(accepted: string): boolean {
  return compareLegalVersions(accepted, LEGAL_CONSENT_MIN_VERSION) >= 0
}

/** Date the documents take effect (YYYY-MM-DD). */
export const LEGAL_EFFECTIVE_DATE = '2026-10-17'

/**
 * True until counsel approves the texts. Clients show a draft notice while it
 * is set, and the texts may still hold [bracketed] placeholders; a test
 * refuses placeholders once it is false.
 */
export const LEGAL_DRAFT = true
