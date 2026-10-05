import type { Metadata } from 'next'
import { ColorAnalysisScreen } from '@/components/screens/color-analysis-screen'

export const metadata: Metadata = { title: 'Rang tahlili' }

export default function ColorAnalysisPage() {
  return <ColorAnalysisScreen />
}
