/**
 * Version of the legal documents (privacy policy and terms of use) that a user
 * accepts when registering. Bump LEGAL_VERSION with every change to
 * documents.ts: each consent stores the version it accepted (LegalConsent).
 * Kept apart from the texts so client components can import it cheaply.
 */
export const LEGAL_VERSION = '2026-10-17.2-draft'

/** Date the documents take effect (YYYY-MM-DD). */
export const LEGAL_EFFECTIVE_DATE = '2026-10-17'

/**
 * True until counsel approves the texts. Clients show a draft notice while it
 * is set, and the texts may still hold [bracketed] placeholders; a test
 * refuses placeholders once it is false.
 */
export const LEGAL_DRAFT = true
