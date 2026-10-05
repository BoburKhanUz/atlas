import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/session'
import { AppShell } from '@/components/app-shell'
import { UserProvider } from '@/components/user-provider'

/**
 * Authenticated area. src/proxy.ts already redirects signed-out page requests
 * to /login?next=…; this server-side check is defence in depth.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  return (
    <UserProvider user={{ id: user.id, email: user.email, name: user.name }}>
      <AppShell>{children}</AppShell>
    </UserProvider>
  )
}
