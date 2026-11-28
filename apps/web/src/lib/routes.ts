/**
 * Typed route helpers — the single source of truth for the site's URLs: the
 * landing page and the legal documents (the reset page is reached only from
 * an e-mailed link). Everything else is the phone app's (ADR 0012).
 */
export const routes = {
  home: () => '/',
  privacy: () => '/privacy',
  terms: () => '/terms',
} as const
