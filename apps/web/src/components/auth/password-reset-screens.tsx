'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError, postJson } from '@/lib/api-client'
import { routes } from '@/lib/routes'

const MIN_PASSWORD = 8

function Card({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-12 max-w-md mx-auto w-full">
        <div className="surface-card p-6 w-full">
          <h1 className="display-md text-foreground mb-2">{title}</h1>
          {description && <p className="text-sm text-muted-foreground leading-relaxed mb-6">{description}</p>}
          {children}
        </div>
      </main>
    </div>
  )
}

function Notice({ tone, children }: { tone: 'error' | 'success'; children: React.ReactNode }) {
  const style =
    tone === 'error'
      ? 'text-destructive bg-destructive/5 border-destructive/20'
      : 'text-foreground bg-primary/5 border-primary/20'
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`text-sm border rounded-lg px-3 py-2 ${style}`}>
      {children}
    </div>
  )
}

/**
 * /reset-password?token=…: the page an e-mailed link opens; sets a new
 * password. The Go server signs every session of the account out; the user
 * signs in again in the phone app.
 */
export function ResetPasswordScreen() {
  const t = useTranslations('passwordReset')
  const tAuth = useTranslations('auth')
  const tErrors = useTranslations('errors')
  const token = useSearchParams().get('token')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(!token)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy || !token) return
    setError(null)
    const problem = password.length < MIN_PASSWORD ? t('tooShort') : password !== confirm ? t('mismatch') : null
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    try {
      await postJson('/api/v1/auth/password/reset', { token, password })
      // The link is spent: keep it out of the history.
      window.history.replaceState(null, '', '/reset-password')
      setDone(true)
    } catch (err) {
      if (err instanceof ApiError && err.code === 'RESET_TOKEN_INVALID') setInvalid(true)
      else setError(err instanceof ApiError ? err.message : tErrors('network'))
    }
    setBusy(false)
  }

  if (done) {
    return (
      <Card title={t('savedTitle')}>
        <div className="space-y-4">
          <Notice tone="success">{t('saved')}</Notice>
          <Link
            href={routes.home()}
            className="inline-flex items-center justify-center w-full h-11 rounded-md bg-primary text-primary-foreground text-base font-medium hover:bg-primary/90"
          >
            {t('toHome')}
          </Link>
        </div>
      </Card>
    )
  }

  if (invalid) {
    return (
      <Card title={t('resetTitle')}>
        <div className="space-y-4">
          <Notice tone="error">{t('invalidLink')}</Notice>
          <Link href={routes.home()} className="block text-center text-sm font-medium text-foreground underline underline-offset-2">
            {t('toHome')}
          </Link>
        </div>
      </Card>
    )
  }

  return (
    <Card title={t('resetTitle')} description={t('resetDescription')}>
      {/* noValidate: the checks below say what is wrong in Uzbek; the browser's own would block them. */}
      <form onSubmit={submit} noValidate className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="password" className="text-sm font-medium">
            {t('newPasswordLabel')}
          </Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-11"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD}
          />
          <p className="text-xs text-muted-foreground">{tAuth('passwordHint')}</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm" className="text-sm font-medium">
            {t('confirmPasswordLabel')}
          </Label>
          <Input
            id="confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="h-11"
            autoComplete="new-password"
            required
          />
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" disabled={busy} className="w-full h-11 text-base font-medium">
          {busy ? tAuth('busy') : t('save')}
        </Button>
      </form>
    </Card>
  )
}
