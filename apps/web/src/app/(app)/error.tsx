'use client'

import { useEffect } from 'react'
import { AlertCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const t = useTranslations('errors')
  const tCommon = useTranslations('common')

  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="px-5 pt-24 pb-6 flex justify-center">
      <div role="alert" className="surface-card p-8 text-center max-w-sm w-full">
        <div className="w-12 h-12 rounded-2xl bg-destructive/10 mx-auto mb-4 flex items-center justify-center">
          <AlertCircle className="w-6 h-6 text-destructive" />
        </div>
        <h1 className="font-semibold text-foreground mb-1.5">{t('pageTitle')}</h1>
        <p className="text-sm text-muted-foreground leading-relaxed mb-5">
          {t('pageDescription')}
        </p>
        <Button onClick={reset} className="h-11 px-5">
          {tCommon('retry')}
        </Button>
        {error.digest && (
          <p className="text-[11px] text-muted-foreground/70 mt-4 font-mono">{error.digest}</p>
        )}
      </div>
    </div>
  )
}
