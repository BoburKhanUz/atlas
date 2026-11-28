/**
 * Typed route helpers — the single source of truth for the site's URLs: the
 * landing page, the legal documents and the page an e-mailed password reset
 * link opens. Everything else is the phone app's (ADR 0012).
 */
export const routes = {
  home: () => '/',
  privacy: () => '/privacy',
  terms: () => '/terms',
  resetPassword: () => '/reset-password',
} as const
