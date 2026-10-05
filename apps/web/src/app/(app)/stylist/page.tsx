import type { Metadata } from 'next'
import { Suspense } from 'react'
import { StylistScreen } from '@/components/screens/stylist-screen'

export const metadata: Metadata = { title: 'AI Stilist' }

export default function StylistPage() {
  // StylistScreen reads ?event= via useSearchParams → needs a Suspense boundary.
  return (
    <Suspense>
      <StylistScreen />
    </Suspense>
  )
}
