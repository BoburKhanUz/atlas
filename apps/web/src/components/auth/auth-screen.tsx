'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, ApiError } from '@/lib/api-client'
import { routes, safeNextPath } from '@/lib/routes'
import { useToast } from '@/hooks/use-toast'

export type AuthMode = 'login' | 'register'

interface AuthResponse {
  user: { id: string; email: string; name: string | null }
}

interface LegalResponse {
  version: string
}

/** Registration refused because the legal documents changed since they were loaded. */
function isOutdatedConsent(err: ApiError): boolean {
  return (
    err.code === 'VALIDATION_ERROR' &&
    Array.isArray(err.details) &&
    err.details.some((d) => (d as { path?: unknown })?.path === 'acceptedLegalVersion')
  )
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
  const [ageConfirmed, setAgeConfirmed] = useState(false)
  const [legalAccepted, setLegalAccepted] = useState(false)
  // The version of the documents behind the links (GET /api/v1/legal): the
  // server accepts only the current one, so it is not baked into the bundle.
  const [legalVersion, setLegalVersion] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (mode !== 'register' || legalVersion) return
    let cancelled = false
    api<LegalResponse>('/api/v1/legal')
      .then((r) => {
        if (!cancelled) setLegalVersion(r.version)
      })
      .catch(() => {}) // loaded again on submit
    return () => {
      cancelled = true
    }
  }, [mode, legalVersion])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setError(null)
    // Same rule as the server (RegisterRequest): both boxes are required.
    if (mode === 'register' && (!ageConfirmed || !legalAccepted)) {
      setError(ageConfirmed ? t('consentRequired') : t('ageRequired'))
      return
    }
    setBusy(true)

    try {
      const path = mode === 'login' ? '/api/v1/auth/login' : '/api/v1/auth/register'
      const body =
        mode === 'login'
          ? { email, password }
          : {
              email,
              password,
              name: name || undefined,
              acceptedLegalVersion: legalVersion ?? (await api<LegalResponse>('/api/v1/legal')).version,
              ageConfirmed,
            }
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
      if (err instanceof ApiError && isOutdatedConsent(err)) {
        // Load the new version and ask for the consent again.
        setLegalAccepted(false)
        setLegalVersion(null)
      }
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
          <Image src="/logo.png" alt="" width={64} height={64} priority className="inline-block w-16 h-16 mb-6" />
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
              {mode === 'login' && (
                <div className="text-right">
                  <Link
                    href={routes.forgotPassword()}
                    className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                  >
                    {t('forgotLink')}
                  </Link>
                </div>
              )}
            </div>

            {mode === 'register' && (
              <div className="space-y-3 pt-1">
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="ageConfirmed"
                    checked={ageConfirmed}
                    onCheckedChange={(v) => setAgeConfirmed(v === true)}
                    className="mt-0.5"
                  />
                  <Label htmlFor="ageConfirmed" className="font-normal leading-snug">
                    {t('ageLabel')}
                  </Label>
                </div>
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="legalAccepted"
                    checked={legalAccepted}
                    onCheckedChange={(v) => setLegalAccepted(v === true)}
                    className="mt-0.5"
                  />
                  {/* The links open in a new tab so the form keeps what was typed. */}
                  <Label htmlFor="legalAccepted" className="block font-normal leading-snug">
                    {t.rich('consentLabel', {
                      terms: (chunks) => <LegalLink href={routes.terms()}>{chunks}</LegalLink>,
                      privacy: (chunks) => <LegalLink href={routes.privacy()}>{chunks}</LegalLink>,
                    })}
                  </Label>
                </div>
              </div>
            )}

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

        <nav
          aria-label={t('legalLinks')}
          className="flex justify-center gap-2 text-xs text-muted-foreground mt-6"
        >
          <LegalLink href={routes.privacy()}>{t('privacyLink')}</LegalLink>
          <span aria-hidden="true">·</span>
          <LegalLink href={routes.terms()}>{t('termsLink')}</LegalLink>
        </nav>
      </div>
    </div>
  )
}

function LegalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2 hover:text-foreground"
    >
      {children}
    </Link>
  )
}
