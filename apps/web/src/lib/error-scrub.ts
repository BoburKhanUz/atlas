/**
 * Scrubbing rules for error reports (crash monitoring), shared by the
 * browser reporter (src/lib/client-errors.ts) and the server
 * (src/server/client-errors.ts). An error text may quote a request: these
 * drop e-mail addresses, Bearer values, JWTs, URL query strings (signatures,
 * one-time tokens) and long opaque values (refresh/reset tokens, keys).
 */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const BEARER = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi
const JWT = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g
const URL_QUERY = /(https?:\/\/[^\s?#"'<>]+)\?[^\s#"'<>]*/g
// '/' is not part of it: paths in stack frames stay readable
const OPAQUE = /[A-Za-z0-9_+=-]{32,}/g
const ID_SEGMENT = /^[A-Za-z0-9_-]{16,}$/

export function scrubErrorText(s: string): string {
  return s
    .replace(BEARER, 'Bearer [REDACTED]')
    .replace(JWT, '[REDACTED_JWT]')
    .replace(EMAIL, '[REDACTED_EMAIL]')
    .replace(URL_QUERY, '$1?[REDACTED]')
    .replace(OPAQUE, '[REDACTED]')
}

/** /wardrobe/item/cmxyz…?a=b → /wardrobe/item/:id */
export function normalizeRoute(route: string): string {
  return route
    .split(/[?#]/)[0]
    .split('/')
    .map((segment) => (ID_SEGMENT.test(segment) ? ':id' : segment))
    .join('/')
}
