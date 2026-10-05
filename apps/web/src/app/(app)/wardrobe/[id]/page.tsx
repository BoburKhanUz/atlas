import type { Metadata } from 'next'
import { WardrobeItemDetail } from '@/components/screens/wardrobe-item-detail'

export const metadata: Metadata = { title: 'Kiyim' }

export default async function WardrobeItemPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <WardrobeItemDetail id={id} />
}
