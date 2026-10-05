'use client'

import { AlertCircle, RefreshCw } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'

/** Compact inline error with a retry action (for non-blocking sections). */
export function InlineError({
  message,
  onRetry,
  className,
}: {
  message: string
  onRetry: () => void
  className?: string
}) {
  const t = useTranslations('common')
  return (
    <div
      role="alert"
      className={cn(
        'surface-card p-4 flex items-center gap-3 text-left',
        className,
      )}
    >
      <AlertCircle className="w-5 h-5 text-destructive shrink-0" />
      <p className="text-sm text-muted-foreground flex-1">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 text-xs text-primary font-medium px-2 py-1 rounded-md hover:bg-primary/8"
      >
        <RefreshCw className="w-3.5 h-3.5" />
        {t('retry')}
      </button>
    </div>
  )
}
