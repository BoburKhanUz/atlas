import type { Metadata } from 'next'
import { Suspense } from 'react'
import { ResetPasswordScreen } from '@/components/auth/password-reset-screens'

// The URL carries a one-time token: never sent on as a Referer, never indexed.
export const metadata: Metadata = { title: 'Yangi parol', referrer: 'no-referrer', robots: { index: false, follow: false } }

/** The page of the e-mailed reset link: public, signed in or not (src/proxy.ts). */
export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordScreen />
    </Suspense>
  )
}
