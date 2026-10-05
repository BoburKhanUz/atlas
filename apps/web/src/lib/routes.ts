/**
 * Typed route helpers — the single source of truth for in-app URLs.
 * Use with next/link (`<Link href={routes.wardrobe()}>`) or useRouter().
 */

function withQuery(path: string, query: Record<string, string | null | undefined>): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v) qs.set(k, v)
  }
  const s = qs.toString()
  return s ? `${path}?${s}` : path
}

export const routes = {
  home: () => '/',
  wardrobe: () => '/wardrobe',
  wardrobeNew: () => '/wardrobe/new',
  wardrobeItem: (id: string) => `/wardrobe/${encodeURIComponent(id)}`,
  outfits: (opts: { occasion?: string | null } = {}) =>
    withQuery('/outfits', { occasion: opts.occasion }),
  stylist: (opts: { event?: string | null } = {}) =>
    withQuery('/stylist', { event: opts.event }),
  profile: () => '/profile',
  colorAnalysis: () => '/profile/color-analysis',
  login: (opts: { next?: string | null; expired?: boolean } = {}) =>
    withQuery('/login', { next: opts.next, expired: opts.expired ? '1' : null }),
  register: (opts: { next?: string | null } = {}) =>
    withQuery('/register', { next: opts.next }),
} as const

/**
 * Only allow same-origin relative paths as a redirect target (prevents open
 * redirects). Shared by the client (post-login) and the server proxy.
 * Rejects `//host`, any backslash, and control characters — browsers strip
 * tabs/newlines from URLs, so `/\t/evil.com` would otherwise become
 * `//evil.com`. Auth pages are never a valid target (avoids loops).
 */
export function safeNextPath(raw: string | null | undefined, fallback: string = routes.home()): string {
  if (!raw || raw.length > 2048) return fallback
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return fallback
  if (/[\u0000-\u001f\u007f]/.test(raw)) return fallback
  if (/^\/(login|register)(\/|\?|#|$)/.test(raw)) return fallback
  return raw
}
