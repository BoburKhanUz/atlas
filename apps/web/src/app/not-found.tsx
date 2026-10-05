import type { Metadata } from 'next'
import { NotFoundView } from '@/components/states/not-found-view'

export const metadata: Metadata = { title: '404' }

/** Global 404 for any unmatched URL. */
export default function NotFound() {
  return <NotFoundView fullScreen />
}
