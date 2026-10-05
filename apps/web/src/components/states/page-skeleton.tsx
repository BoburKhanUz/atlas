import { useTranslations } from 'next-intl'

/** Route-level loading skeleton using the app's existing shimmer style. */
export function PageSkeleton() {
  const t = useTranslations('common')
  return (
    <div className="px-5 pt-12 pb-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">{t('loading')}</span>
      <div className="skeleton-shimmer h-4 w-28 rounded-md mb-3" />
      <div className="skeleton-shimmer h-8 w-56 rounded-lg mb-8" />
      <div className="skeleton-shimmer h-28 w-full rounded-[var(--radius-lg)] mb-6" />
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton-shimmer aspect-[3/4] rounded-[var(--radius-lg)]" />
        ))}
      </div>
    </div>
  )
}
