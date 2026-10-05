'use client'

import { useCallback, useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'

/**
 * Tracks whether the user has navigated *within* the app during this page
 * load. If they have, a sub-screen's back button can safely call
 * router.back(); if not (deep link, refresh, new tab), going back would leave
 * the app, so we replace the current entry with the parent route instead.
 *
 * Module-level state is per page load, which is exactly the lifetime of the
 * client-side history we care about.
 */
let lastPathname: string | null = null
let hasInAppHistory = false

/** Mounted once, in the AppShell. */
export function useTrackInAppNavigation() {
  const pathname = usePathname()
  useEffect(() => {
    if (pathname === lastPathname) return
    if (lastPathname !== null) hasInAppHistory = true
    lastPathname = pathname
  }, [pathname])
}

/** Returns a handler: router.back() if there is in-app history, else go to `fallback`. */
export function useBackNavigation(fallback: string) {
  const router = useRouter()
  return useCallback(() => {
    if (hasInAppHistory) {
      router.back()
    } else {
      router.replace(fallback)
    }
  }, [router, fallback])
}
