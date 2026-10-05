import type { Metadata } from 'next'
import { Suspense } from 'react'
import { OutfitsScreen } from '@/components/screens/outfits-screen'

export const metadata: Metadata = { title: 'Outfitlar' }

export default function OutfitsPage() {
  // OutfitsScreen reads ?occasion= via useSearchParams → needs a Suspense boundary.
  return (
    <Suspense>
      <OutfitsScreen />
    </Suspense>
  )
}
