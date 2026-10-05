'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, ApiError } from '@/lib/api-client'
import { routes, safeNextPath } from '@/lib/routes'
import { useToast } from '@/hooks/use-toast'

export type AuthMode = 'login' | 'register'

interface AuthResponse {
  user: { id: string; email: string; name: string | null }
}

/**
 * Login / register screen. Rendered by /login and /register (the mode toggle
 * is a pair of links so each mode has its own URL). Must be rendered inside
 * <Suspense> because it reads ?next= and ?expired= via useSearchParams.
 */
export function AuthScreen({ mode }: { mode: AuthMode }) {
  const { toast } = useToast()
  const t = useTranslations('auth')
  const tErrors = useTranslations('errors')
  const tCommon = useTranslations('common')
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextParam = searchParams.get('next')
  const expired = searchParams.get('expired') === '1'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setError(null)
    setBusy(true)

    try {
      const path = mode === 'login' ? '/api/v1/auth/login' : '/api/v1/auth/register'
      const body =
        mode === 'login'
          ? { email, password }
          : { email, password, name: name || undefined }
      // Server sets HttpOnly session cookies; the body only carries the user.
      await api<AuthResponse>(path, { method: 'POST', body })
      toast({
        title: mode === 'login' ? t('welcomeTitle') : t('registeredTitle'),
        description: t('welcomeDescription'),
      })
      router.replace(safeNextPath(nextParam))
      // Keep `busy` on while navigating away.
      return
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : tErrors('network')
      setError(msg)
    }
    setBusy(false)
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 max-w-md mx-auto w-full">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="text-center mb-12"
        >
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 mb-6">
            <SparkleIcon className="w-7 h-7 text-primary" />
          </div>
          <h1 className="display-xl text-foreground mb-3">
            {tCommon('appName')}
          </h1>
          <p className="text-base text-muted-foreground leading-relaxed max-w-sm">
            {t('tagline')}
          </p>
        </motion.div>

        {/* Auth card */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          className="surface-card p-6 w-full"
        >
          {/* Mode toggle */}
          {expired && mode === 'login' && (
            <div
              role="status"
              className="text-sm text-foreground bg-primary/5 border border-primary/20 rounded-lg px-3 py-2 mb-4"
            >
              {t('sessionExpired')}
            </div>
          )}

          <nav aria-label={t('modeLabel')} className="grid grid-cols-2 gap-1 p-1 bg-muted rounded-xl mb-6">
            {(['login', 'register'] as AuthMode[]).map((m) => {
              const href =
                m === 'login'
                  ? routes.login({ next: nextParam })
                  : routes.register({ next: nextParam })
              return (
                <Link
                  key={m}
                  href={href}
                  replace
                  aria-current={mode === m ? 'page' : undefined}
                  className={`text-center text-sm font-medium py-2 rounded-lg transition-all ${
                    mode === m
                      ? 'bg-white text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {m === 'login' ? t('login') : t('register')}
                </Link>
              )
            })}
          </nav>

          <form onSubmit={submit} className="space-y-4">
            <AnimatePresence mode="popLayout">
              {mode === 'register' && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="space-y-2"
                >
                  <Label htmlFor="name" className="text-sm font-medium">
                    {t('nameLabel')}
                  </Label>
                  <Input
                    id="name"
                    type="text"
                    placeholder={t('namePlaceholder')}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="h-11"
                    autoComplete="name"
                  />
                </motion.div>
              )}
            </AnimatePresence>

            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium">
                {t('emailLabel')}
              </Label>
              <Input
                id="email"
                type="email"
                placeholder={t('emailPlaceholder')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-11"
                autoComplete="email"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm font-medium">
                {t('passwordLabel')}
              </Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                minLength={mode === 'register' ? 8 : undefined}
              />
              {mode === 'register' && (
                <p className="text-xs text-muted-foreground">
                  {t('passwordHint')}
                </p>
              )}
            </div>

            {error && (
              <motion.div
                role="alert"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-sm text-destructive bg-destructive/5 border border-destructive/20 rounded-lg px-3 py-2"
              >
                {error}
              </motion.div>
            )}

            <Button
              type="submit"
              disabled={busy}
              className="w-full h-11 text-base font-medium"
            >
              {busy
                ? t('busy')
                : mode === 'login'
                  ? t('submitLogin')
                  : t('submitRegister')}
            </Button>
          </form>
        </motion.div>

        <p className="text-xs text-muted-foreground text-center mt-6 leading-relaxed">
          {t('terms')}
        </p>
      </div>
    </div>
  )
}

function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3 L13.5 9 L19 10.5 L13.5 12 L12 18 L10.5 12 L5 10.5 L10.5 9 Z" />
      <path d="M19 3 L19.7 5.3 L22 6 L19.7 6.7 L19 9 L18.3 6.7 L16 6 L18.3 5.3 Z" opacity="0.5" />
    </svg>
  )
}
