import { cookies } from 'next/headers'
import { getRequestConfig } from 'next-intl/server'
import { defaultLocale, isAppLocale, locales, LOCALE_COOKIE, type AppLocale } from './config'

/**
 * Per-request next-intl config (wired up via createNextIntlPlugin in
 * next.config.ts). Without `[locale]` routing, `requestLocale` is undefined,
 * so the locale is resolved here: explicit override → cookie → default.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  let locale: AppLocale = defaultLocale

  const requested = await requestLocale
  if (isAppLocale(requested)) {
    locale = requested
  } else if (locales.length > 1) {
    // Only read cookies once there's actually a choice — keeps static pages
    // (e.g. not-found) static while 'uz' is the only locale.
    const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value
    if (isAppLocale(fromCookie)) locale = fromCookie
  }

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    timeZone: 'Asia/Tashkent',
  }
})
