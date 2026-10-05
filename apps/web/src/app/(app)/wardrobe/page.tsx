import type { Metadata } from 'next'
import { WardrobeScreen } from '@/components/screens/wardrobe-screen'

export const metadata: Metadata = { title: 'Garderob' }

export default function WardrobePage() {
  return <WardrobeScreen />
}
