import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/session'
import { routes } from '@/lib/routes'
import { consentRequired } from '@/server/legal-consent'
import { AppShell } from '@/components/app-shell'
import { UserProvider } from '@/components/user-provider'

/**
 * Authenticated area. src/proxy.ts already redirects signed-out page requests
 * to /login?next=…; this server-side check is defence in depth. After the
 * legal texts changed, the user accepts them first (/consent): the API
 * refuses everything else until then.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  if (await consentRequired(user.id)) redirect(routes.consent())

  return (
    <UserProvider user={{ id: user.id, email: user.email, name: user.name }}>
      <AppShell>{children}</AppShell>
    </UserProvider>
  )
}
