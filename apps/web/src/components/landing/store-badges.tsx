import Image from 'next/image'
import { storeLink, type StoreLinks } from '@/lib/landing/store-links'

export interface StoreBadgeLabels {
  googlePlay: string
  appStore: string
  soon: string
}

/**
 * The official store badges. A badge with a link leads to the store; without one it
 * is shown dimmed, not as a link, with "Tez kunda" under it.
 */
export function StoreBadges({ links, labels, size = 'md', tone = 'light' }: {
  links: StoreLinks
  labels: StoreBadgeLabels
  size?: 'md' | 'lg'
  /** On a dark background the "Tez kunda" line is light. */
  tone?: 'light' | 'dark'
}) {
  const height = size === 'lg' ? 52 : 44
  const badges = [
    { key: 'google-play', href: storeLink(links.googlePlay, 'play.google.com'), src: '/landing/google-play-uz.png', alt: labels.googlePlay, ratio: 564 / 168 },
    { key: 'app-store', href: storeLink(links.appStore, 'apps.apple.com'), src: '/landing/app-store.svg', alt: labels.appStore, ratio: 119.66407 / 40 },
  ]
  return (
    <ul className="flex flex-row flex-wrap gap-3">
      {badges.map((b) => {
        const image = (
          <Image src={b.src} alt={b.alt} width={Math.round(height * b.ratio)} height={height} className="h-[var(--badge-h)] w-auto" style={{ ['--badge-h' as string]: `${height}px` }} />
        )
        return (
          <li key={b.key} className="flex flex-col items-center gap-1">
            {b.href ? (
              <a href={b.href} rel="noopener" className="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                {image}
              </a>
            ) : (
              <>
                <span className="opacity-60">{image}</span>
                <span className={`text-xs font-semibold ${tone === 'dark' ? 'text-white/85' : 'text-primary'}`}>{labels.soon}</span>
              </>
            )}
          </li>
        )
      })}
    </ul>
  )
}
