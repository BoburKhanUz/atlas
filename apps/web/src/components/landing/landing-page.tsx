import Image from 'next/image'
import Link from 'next/link'
import { Manrope } from 'next/font/google'
import { getTranslations } from 'next-intl/server'
import { CalendarDays, ChevronDown, CircleCheck, Globe, Lock, Menu, Palette, Shirt, Sparkles } from 'lucide-react'
import { StoreBadges } from '@/components/landing/store-badges'
import { BRAND } from '@/lib/brand-colors'
import { STORE_LINKS } from '@/lib/landing/store-links'

/**
 * The landing page (docs/plan/W0.md), built to the owner's mockup
 * (apps/web/design/landing-*.png) with the app's palette and font. Static: no
 * session, no API call; the store links come from STORE_LINKS.
 */
const manrope = Manrope({ subsets: ['latin', 'latin-ext'], display: 'swap' })

const SECTIONS = { features: 'imkoniyatlar', how: 'qanday-ishlaydi', faq: 'savollar', download: 'yuklab-olish' } as const

export async function LandingPage() {
  const t = await getTranslations('landing')
  const badgeLabels = { googlePlay: t('stores.googlePlay'), appStore: t('stores.appStore'), soon: t('stores.soon') }
  const navLinks = [
    { href: `#${SECTIONS.features}`, label: t('nav.features') },
    { href: `#${SECTIONS.how}`, label: t('nav.how') },
    { href: `#${SECTIONS.faq}`, label: t('nav.faq') },
  ]
  const features = [
    { icon: Shirt, title: t('features.wardrobeTitle'), text: t('features.wardrobeText') },
    { icon: CalendarDays, title: t('features.outfitTitle'), text: t('features.outfitText') },
    { icon: Sparkles, title: t('features.stylistTitle'), text: t('features.stylistText') },
    { icon: Palette, title: t('features.colorTitle'), text: t('features.colorText') },
  ]
  const steps = [
    { image: '/landing/step-photo.webp', width: 385, height: 425, text: t('how.step1') },
    { image: '/landing/step-outfit.webp', width: 405, height: 423, text: t('how.step2') },
    { image: '/landing/step-wear.webp', width: 418, height: 390, text: t('how.step3') },
  ]
  const faq = (['free', 'phones', 'photos', 'stylist'] as const).map((k) => ({ q: t(`faq.${k}Q`), a: t(`faq.${k}A`) }))

  return (
    <div className={`${manrope.className} min-h-screen overflow-x-clip bg-background text-foreground`}>
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Link href="#" aria-label={t('nav.home')} className="text-3xl font-extrabold tracking-tight text-primary">
          Lookly
        </Link>
        <nav aria-label={t('nav.label')} className="hidden md:block">
          <ul className="flex items-center gap-10 text-sm font-semibold">
            {navLinks.map((l) => (
              <li key={l.href}>
                <a href={l.href} className="hover:text-primary">{l.label}</a>
              </li>
            ))}
          </ul>
        </nav>
        <a href={`#${SECTIONS.download}`} className="hidden rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-white shadow-md hover:bg-[var(--landing-accent-strong)] md:inline-block" style={{ ['--landing-accent-strong' as string]: BRAND.accentStrong }}>
          {t('nav.download')}
        </a>
        <details className="group relative md:hidden">
          <summary className="flex size-11 cursor-pointer list-none items-center justify-center rounded-full [&::-webkit-details-marker]:hidden">
            <Menu aria-hidden className="size-6" />
            <span className="sr-only">{t('nav.menu')}</span>
          </summary>
          <nav aria-label={t('nav.menu')} className="absolute right-0 z-10 mt-2 w-56 rounded-2xl border border-border bg-card p-2 shadow-lg">
            <ul className="flex flex-col text-base font-semibold">
              {[...navLinks, { href: `#${SECTIONS.download}`, label: t('nav.download') }].map((l) => (
                <li key={l.href}>
                  <a href={l.href} className="block rounded-xl px-4 py-3 hover:bg-secondary">{l.label}</a>
                </li>
              ))}
            </ul>
          </nav>
        </details>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-8 px-4 pb-16 pt-6 sm:px-6 md:grid-cols-2 md:pt-12">
          <div>
            <h1 className="text-[2.6rem] font-extrabold leading-[1.05] tracking-tight sm:text-6xl">{t('hero.title')}</h1>
            <p className="mt-3 text-2xl font-bold leading-tight sm:text-3xl" style={{ color: BRAND.accentBright }}>{t('hero.subtitle')}</p>
            <p className="mt-4 max-w-md text-base leading-relaxed text-muted-foreground sm:text-lg">{t('hero.text')}</p>
            <div className="mt-7">
              <StoreBadges links={STORE_LINKS} labels={badgeLabels} />
            </div>
            <ul className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
              <li className="flex items-center gap-1.5"><CircleCheck aria-hidden className="size-4 text-primary" />{t('hero.trustFree')}</li>
              <li className="flex items-center gap-1.5"><Globe aria-hidden className="size-4 text-primary" />{t('hero.trustUzbek')}</li>
              <li className="flex items-center gap-1.5"><Lock aria-hidden className="size-4 text-primary" />{t('hero.trustPrivate')}</li>
            </ul>
          </div>
          <div className="relative mx-auto w-full max-w-[460px]">
            <Image src="/landing/hero-phone.webp" alt={t('hero.imageAlt')} width={463} height={485} priority className="h-auto w-full" />
          </div>
        </section>

        {/* Features */}
        <section id={SECTIONS.features} aria-labelledby="features-title" className="mx-auto max-w-6xl scroll-mt-4 px-4 pb-16 sm:px-6">
          <h2 id="features-title" className="text-3xl font-extrabold tracking-tight sm:text-4xl">{t('features.title')}</h2>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {features.map((f) => (
              <li key={f.title} className="flex gap-4 rounded-3xl border border-border bg-card p-5 shadow-[0_8px_24px_rgba(31,17,71,0.06)] lg:flex-col">
                <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-secondary text-primary">
                  <f.icon aria-hidden className="size-7" />
                </span>
                <div>
                  <h3 className="text-lg font-extrabold">{f.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{f.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* How it works */}
        <section id={SECTIONS.how} aria-labelledby="how-title" className="mx-auto max-w-6xl scroll-mt-4 px-4 pb-16 sm:px-6">
          <h2 id="how-title" className="text-3xl font-extrabold tracking-tight sm:text-4xl">{t('how.title')}</h2>
          <ol className="mt-8 grid gap-6 md:grid-cols-3 md:gap-10">
            {steps.map((s, i) => (
              <li key={s.text} className="relative flex items-center gap-4 md:flex-col md:text-center">
                <span className="flex h-28 w-28 shrink-0 items-end justify-center sm:h-36 sm:w-36 md:h-60 md:w-full">
                  <Image src={s.image} alt="" width={s.width} height={s.height} className="h-auto max-h-full w-auto max-w-full" />
                </span>
                <p className="flex items-center gap-3 text-lg font-bold">
                  <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-base font-extrabold text-white">{i + 1}</span>
                  {s.text}
                </p>
                {i < steps.length - 1 && (
                  <span aria-hidden className="absolute -right-8 top-1/3 hidden w-6 border-t-2 border-dotted md:block" style={{ borderColor: BRAND.accentBright }} />
                )}
              </li>
            ))}
          </ol>
        </section>

        {/* Privacy */}
        <section aria-labelledby="privacy-title" className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
          <div className="flex flex-col items-start gap-6 rounded-3xl p-6 sm:flex-row sm:items-center sm:p-8" style={{ background: BRAND.accentSoft }}>
            <Image src="/landing/shield.webp" alt="" width={296} height={348} className="h-auto w-20 shrink-0 sm:w-28" />
            <div>
              <h2 id="privacy-title" className="text-2xl font-extrabold tracking-tight sm:text-3xl">{t('privacy.title')}</h2>
              <ul className="mt-4 grid gap-3 text-base md:grid-cols-3 md:gap-6">
                {[t('privacy.selfie'), t('privacy.photos'), t('privacy.delete')].map((line) => (
                  <li key={line} className="flex items-start gap-2">
                    <CircleCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Download */}
        <section id={SECTIONS.download} aria-labelledby="download-title" className="mx-auto max-w-6xl scroll-mt-4 px-4 pb-16 sm:px-6">
          <div className="relative grid items-center gap-8 overflow-hidden rounded-3xl px-6 py-10 text-white sm:px-10 md:grid-cols-[1fr_auto]" style={{ background: `linear-gradient(120deg, ${BRAND.ink}, ${BRAND.accentStrong})` }}>
            <div>
              <h2 id="download-title" className="max-w-md text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">{t('banner.title')}</h2>
              <div className="mt-6">
                <StoreBadges links={STORE_LINKS} labels={badgeLabels} size="lg" tone="dark" />
              </div>
            </div>
            <Image src="/landing/banner-phone.webp" alt="" width={377} height={470} className="hidden h-auto w-56 rotate-3 md:block lg:w-64" />
          </div>
        </section>

        {/* Questions and answers */}
        <section id={SECTIONS.faq} aria-labelledby="faq-title" className="mx-auto max-w-6xl scroll-mt-4 px-4 pb-16 sm:px-6">
          <h2 id="faq-title" className="text-3xl font-extrabold tracking-tight sm:text-4xl">{t('faq.title')}</h2>
          <div className="mt-6 flex flex-col gap-3">
            {faq.map((item) => (
              <details key={item.q} className="group rounded-2xl border border-border bg-card">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-base font-bold [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <ChevronDown aria-hidden className="size-5 shrink-0 transition-transform group-open:rotate-180" />
                </summary>
                <p className="px-5 pb-5 leading-relaxed text-muted-foreground">{item.a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <span className="text-2xl font-extrabold text-primary">Lookly</span>
            <span className="text-sm text-muted-foreground">{t('footer.tagline')}</span>
          </div>
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <li><Link href="/privacy" className="hover:text-primary">{t('footer.privacy')}</Link></li>
            <li><Link href="/terms" className="hover:text-primary">{t('footer.terms')}</Link></li>
          </ul>
          <p className="text-sm text-muted-foreground">{t('footer.copyright', { year: new Date().getFullYear() })}</p>
        </div>
      </footer>
    </div>
  )
}
