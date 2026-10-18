import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { ConsentScreen } from '@/components/legal/consent-screen'
import { LEGAL_VERSION } from '@/lib/legal/version'
import { routes, safeNextPath } from '@/lib/routes'
import { getCurrentUser } from '@/lib/session'
import { consentRequired } from '@/server/legal-consent'

export const metadata: Metadata = { title: 'Hujjatlar yangilandi', robots: { index: false, follow: false } }

/**
 * The legal texts changed since the user accepted them: accept the new ones,
 * sign out, or delete the account. Outside the app shell, which sends here.
 */
export default async function ConsentPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNextPath((await searchParams).next)
  const user = await getCurrentUser()
  if (!user) redirect(routes.login())
  if (!(await consentRequired(user.id))) redirect(next)
  // Rendered per request: the version is the one this server checks.
  return <ConsentScreen version={LEGAL_VERSION} next={next} />
}
