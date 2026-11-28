import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { StoreBadges } from '@/components/landing/store-badges'
import { storeLink } from '@/lib/landing/store-links'

const labels = { googlePlay: 'Google Play orqali oling', appStore: 'Download on the App Store', soon: 'Tez kunda' }

describe('store badges', () => {
  it('without links: no link, "Tez kunda" under each badge', () => {
    const html = renderToStaticMarkup(<StoreBadges links={{ googlePlay: null, appStore: null }} labels={labels} />)
    expect(html).not.toContain('<a ')
    expect(html.match(/Tez kunda/g)).toHaveLength(2)
  })

  it('with links: each badge leads to its store, and no "Tez kunda"', () => {
    const html = renderToStaticMarkup(
      <StoreBadges links={{ googlePlay: 'https://play.google.com/store/apps/details?id=uz.lookly', appStore: 'https://apps.apple.com/app/id1' }} labels={labels} />,
    )
    expect(html).toContain('href="https://play.google.com/store/apps/details?id=uz.lookly"')
    expect(html).toContain('href="https://apps.apple.com/app/id1"')
    expect(html).not.toContain('Tez kunda')
  })

  it('one link set: that badge links, the other waits', () => {
    const html = renderToStaticMarkup(<StoreBadges links={{ googlePlay: 'https://play.google.com/store/apps/details?id=uz.lookly', appStore: null }} labels={labels} />)
    expect(html.match(/<a /g)).toHaveLength(1)
    expect(html.match(/Tez kunda/g)).toHaveLength(1)
  })
})

describe('storeLink', () => {
  it('takes only an https address of that store', () => {
    expect(storeLink('https://play.google.com/store/apps/details?id=x', 'play.google.com')).toBe('https://play.google.com/store/apps/details?id=x')
    for (const bad of ['http://play.google.com/x', 'https://play.google.com.evil.example/x', 'javascript:alert(1)', 'not a url', '']) {
      expect(storeLink(bad, 'play.google.com'), bad).toBeNull()
    }
    expect(storeLink('https://apps.apple.com/app/id1', 'play.google.com')).toBeNull()
    expect(storeLink(null, 'apps.apple.com')).toBeNull()
  })
})
