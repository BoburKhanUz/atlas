'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion } from 'framer-motion'
import { useTranslations } from 'next-intl'
import { Home, Shirt, Sparkle, Layers, User } from 'lucide-react'
import { routes } from '@/lib/routes'
import { useTrackInAppNavigation } from '@/hooks/use-back-navigation'
import { cn } from '@/lib/utils'

type NavKey = 'home' | 'wardrobe' | 'stylist' | 'outfits' | 'profile'

interface NavItem {
  key: NavKey
  href: string
  icon: React.ComponentType<{ className?: string }>
}

const NAV_ITEMS: NavItem[] = [
  { key: 'home', href: routes.home(), icon: Home },
  { key: 'wardrobe', href: routes.wardrobe(), icon: Shirt },
  { key: 'stylist', href: routes.stylist(), icon: Sparkle },
  { key: 'outfits', href: routes.outfits(), icon: Layers },
  { key: 'profile', href: routes.profile(), icon: User },
]

/** Which top-level section a pathname belongs to (sub-routes → parent tab). */
function activeSection(pathname: string): NavKey {
  if (pathname === '/') return 'home'
  for (const item of NAV_ITEMS) {
    if (item.href !== '/' && (pathname === item.href || pathname.startsWith(item.href + '/'))) {
      return item.key
    }
  }
  return 'home'
}

/**
 * Sub-screens (add item, item detail, color analysis) render full-screen on
 * mobile without the bottom nav, as before. On ≥md the sidebar stays.
 */
function isSubscreen(pathname: string): boolean {
  return (
    pathname.startsWith(routes.wardrobe() + '/') ||
    pathname.startsWith(routes.profile() + '/')
  )
}

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const t = useTranslations('nav')
  const tCommon = useTranslations('common')
  useTrackInAppNavigation()

  const active = activeSection(pathname)
  const sub = isSubscreen(pathname)

  return (
    <div className="app-shell min-h-screen md:flex">
      <a
        href="#main-content"
        className={cn(
          'sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60]',
          'focus:px-4 focus:py-2 focus:rounded-lg focus:bg-card focus:text-foreground focus:shadow-lg',
          focusRing,
        )}
      >
        {tCommon('skipToContent')}
      </a>

      {/* ≥768px: left sidebar (icon rail at md, full labels at lg) */}
      <aside className="hidden md:flex md:flex-col shrink-0 sticky top-0 h-screen w-20 lg:w-60 border-r bg-card/60">
        <Link
          href={routes.home()}
          className={cn(
            'flex items-center gap-3 h-16 px-4 lg:px-5 mt-4 mb-2 rounded-xl mx-2 justify-center lg:justify-start',
            focusRing,
          )}
          aria-label={tCommon('appName')}
        >
          <span className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Sparkle className="w-5 h-5 text-primary" />
          </span>
          <span className="hidden lg:inline font-semibold tracking-tight text-foreground">
            {tCommon('appName')}
          </span>
        </Link>
        <nav aria-label={t('label')} className="flex-1 px-2 lg:px-3">
          <ul className="flex flex-col gap-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon
              const isActive = active === item.key
              return (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    aria-current={isActive ? 'page' : undefined}
                    title={t(item.key)}
                    className={cn(
                      'relative flex items-center gap-3 rounded-xl h-11 px-3 transition-colors',
                      'justify-center lg:justify-start',
                      isActive
                        ? 'text-primary bg-primary/8 font-medium'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                      focusRing,
                    )}
                  >
                    <Icon className="w-5 h-5 shrink-0" />
                    <span className="sr-only lg:not-sr-only text-sm">{t(item.key)}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
      </aside>

      <main
        id="main-content"
        tabIndex={-1}
        className={cn(
          'flex-1 min-w-0 w-full outline-none',
          // Mobile keeps room for the floating bottom nav.
          !sub && 'pb-24 md:pb-8',
        )}
      >
        <div
          className={cn(
            'w-full mx-auto',
            // Mobile: same 480px cap as before. Desktop: use the space,
            // but keep detail/flow screens at a comfortable reading width.
            'max-w-[480px]',
            sub ? 'md:max-w-2xl' : 'md:max-w-3xl lg:max-w-5xl md:px-4 lg:px-8',
          )}
        >
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          >
            {children}
          </motion.div>
        </div>
      </main>

      {/* <768px: bottom navigation — spec section 22 */}
      {!sub && (
        <nav
          aria-label={t('label')}
          className="md:hidden fixed bottom-0 left-0 right-0 z-40 pointer-events-none"
        >
          <div className="max-w-[480px] mx-auto px-4 pb-3 pt-2 pointer-events-auto">
            <div className="nav-bar rounded-2xl px-2 py-1.5">
              <ul className="grid grid-cols-5 gap-1">
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon
                  const isActive = active === item.key
                  return (
                    <li key={item.key}>
                      <Link
                        href={item.href}
                        aria-current={isActive ? 'page' : undefined}
                        className={cn(
                          'relative flex flex-col items-center gap-1 py-2 rounded-xl transition-all',
                          isActive
                            ? 'text-primary'
                            : 'text-muted-foreground hover:text-foreground',
                          focusRing,
                        )}
                      >
                        {isActive && (
                          <motion.div
                            layoutId="nav-active"
                            className="absolute inset-0 bg-primary/8 rounded-xl"
                            transition={{ type: 'spring', duration: 0.4, bounce: 0.15 }}
                          />
                        )}
                        <Icon className="w-5 h-5 relative z-10" />
                        <span className="text-[10px] font-medium relative z-10">
                          {t(item.key)}
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
        </nav>
      )}
    </div>
  )
}
