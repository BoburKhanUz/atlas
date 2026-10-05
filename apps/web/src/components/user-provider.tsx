'use client'

import { createContext, useContext } from 'react'

/** Mirrors SessionUser from src/lib/session.ts (server-only module). */
export interface AppUser {
  id: string
  email: string
  name: string | null
}

const UserContext = createContext<AppUser | null>(null)

/**
 * Provides the signed-in user, resolved server-side in (app)/layout.tsx via
 * getCurrentUser(). Replaces the old client-side useAuthStore.
 */
export function UserProvider({
  user,
  children,
}: {
  user: AppUser
  children: React.ReactNode
}) {
  return <UserContext.Provider value={user}>{children}</UserContext.Provider>
}

/** The signed-in user. Only valid inside the (app) route group. */
export function useUser(): AppUser {
  const user = useContext(UserContext)
  if (!user) throw new Error('useUser must be used inside <UserProvider>')
  return user
}
