import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { routes } from '@/lib/routes'

export function NotFoundView({ fullScreen = false }: { fullScreen?: boolean }) {
  const t = useTranslations('errors')
  const tCommon = useTranslations('common')
  return (
    <div
      className={
        fullScreen
          ? 'min-h-screen flex items-center justify-center px-6 bg-background'
          : 'px-5 pt-24 pb-6 flex justify-center'
      }
    >
      <div className="surface-card p-8 text-center max-w-sm w-full">
        <p className="text-4xl font-semibold text-primary mb-3">404</p>
        <h1 className="font-semibold text-foreground mb-1.5">{t('notFoundTitle')}</h1>
        <p className="text-sm text-muted-foreground leading-relaxed mb-5">
          {t('notFoundDescription')}
        </p>
        <Link
          href={routes.home()}
          className="inline-flex items-center justify-center h-11 px-5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {tCommon('goHome')}
        </Link>
      </div>
    </div>
  )
}
