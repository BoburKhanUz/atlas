/**
 * Where the landing page's store badges lead (docs/plan/W0.md). The links are set
 * in the admin panel (B8/W2: a public Go endpoint the page reads); until then the app
 * is in no store, so none is set and each badge says "Tez kunda".
 */
export interface StoreLinks {
  googlePlay: string | null
  appStore: string | null
}

export const STORE_LINKS: StoreLinks = { googlePlay: null, appStore: null }

/** A store link is used only when it is an https address of that store. */
export function storeLink(url: string | null, host: 'play.google.com' | 'apps.apple.com'): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && u.hostname === host ? u.toString() : null
  } catch {
    return null
  }
}
