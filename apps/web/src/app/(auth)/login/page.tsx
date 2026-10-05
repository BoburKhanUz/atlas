import type { Metadata } from 'next'
import { Suspense } from 'react'
import { AuthScreen } from '@/components/auth/auth-screen'

export const metadata: Metadata = { title: "Kirish" }

export default function LoginPage() {
  return (
    <Suspense>
      <AuthScreen mode="login" />
    </Suspense>
  )
}
