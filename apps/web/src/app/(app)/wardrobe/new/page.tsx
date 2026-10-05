import type { Metadata } from 'next'
import { WardrobeAddFlow } from '@/components/screens/wardrobe-add-flow'

export const metadata: Metadata = { title: 'Kiyim qo‘shish' }

export default function WardrobeNewPage() {
  return <WardrobeAddFlow />
}
