import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/session'

/**
 * Auth pages (/login, /register). Already-signed-in users are sent home.
 * getCurrentUser() failures are treated as "signed out" so the login page
 * always renders.
 */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser().catch(() => null)
  if (user) redirect('/')
  return <>{children}</>
}
