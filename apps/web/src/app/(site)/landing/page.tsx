import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { LandingPage } from '@/components/landing/landing-page'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('landing.meta')
  return {
    title: { absolute: t('title') },
    description: t('description'),
    openGraph: { title: t('title'), description: t('description'), siteName: 'Lookly', type: 'website', locale: 'uz_UZ' },
  }
}

export default function Landing() {
  return <LandingPage />
}
