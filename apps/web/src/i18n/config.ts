/**
 * i18n configuration (no locale-prefixed routing — URLs stay `/wardrobe`,
 * not `/uz/wardrobe`).
 *
 * HOW TO ADD A LOCALE (e.g. Russian / English) LATER:
 *   1. Create `messages/ru.json` (and/or `messages/en.json`) with the same
 *      namespaces/keys as `messages/uz.json`.
 *   2. Add the code to `locales` below, e.g. `['uz', 'ru', 'en'] as const`.
 *   3. Let the user choose: set the `LOCALE_COOKIE` cookie (e.g. from a
 *      server action or route handler: `cookies().set(LOCALE_COOKIE, 'ru',
 *      { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' })`) and then
 *      `router.refresh()`. `src/i18n/request.ts` already reads the cookie as
 *      soon as more than one locale is configured.
 *   4. Optionally fall back to the `Accept-Language` header in request.ts.
 */
export const locales = ['uz'] as const
export type AppLocale = (typeof locales)[number]
export const defaultLocale: AppLocale = 'uz'
export const LOCALE_COOKIE = 'NEXT_LOCALE'

export function isAppLocale(value: string | undefined | null): value is AppLocale {
  return !!value && (locales as readonly string[]).includes(value)
}
