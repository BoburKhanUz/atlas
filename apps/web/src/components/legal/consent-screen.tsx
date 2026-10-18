'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { useToast } from '@/hooks/use-toast'
import { api, ApiError, logoutRequest } from '@/lib/api-client'
import { routes } from '@/lib/routes'

/** The texts changed again while this page was open. */
function isOutdated(err: ApiError): boolean {
  return (
    err.code === 'VALIDATION_ERROR' &&
    Array.isArray(err.details) &&
    err.details.some((d) => (d as { path?: unknown })?.path === 'acceptedLegalVersion')
  )
}

/**
 * /consent: the privacy policy or the terms of use changed. The user accepts
 * the new texts (POST /api/v1/legal/consent) and returns to `next`, or signs
 * out, or declines by deleting the account.
 */
export function ConsentScreen({ version, next }: { version: string; next: string }) {
  const t = useTranslations('consent')
  const tAuth = useTranslations('auth')
  const tErrors = useTranslations('errors')
  const router = useRouter()
  const { toast } = useToast()
  const [ageConfirmed, setAgeConfirmed] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)

  async function accept(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    if (!ageConfirmed || !accepted) {
      setError(ageConfirmed ? t('required') : tAuth('ageRequired'))
      return
    }
    setError(null)
    setBusy(true)
    try {
      await api('/api/v1/legal/consent', { method: 'POST', body: { acceptedLegalVersion: version, ageConfirmed } })
      router.replace(next)
      router.refresh()
    } catch (err) {
      // Changed again since the page loaded: show the newest texts.
      if (err instanceof ApiError && isOutdated(err)) return window.location.reload()
      setError(err instanceof ApiError ? err.message : tErrors('network'))
      setBusy(false)
    }
  }

  async function signOut() {
    setBusy(true)
    await logoutRequest()
    router.replace(routes.login())
    router.refresh()
  }

  async function deleteAccount(): Promise<boolean> {
    setBusy(true)
    try {
      await api('/api/v1/account', { method: 'DELETE' })
      await logoutRequest()
      toast({ title: t('deleted') })
      router.replace(routes.login())
      router.refresh()
      return true
    } catch (err) {
      toast({ title: t('deleteFailed'), description: err instanceof ApiError ? err.message : undefined, variant: 'destructive' })
      setBusy(false)
      return false
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-12 max-w-md mx-auto w-full">
        <form onSubmit={accept} className="surface-card p-6 w-full space-y-5">
          <div>
            <h1 className="display-md text-foreground mb-2">{t('title')}</h1>
            <p className="text-sm text-muted-foreground leading-relaxed">{t('description')}</p>
          </div>

          {/* New tabs: the choices made here stay as they are. */}
          <nav aria-label={tAuth('legalLinks')} className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-medium">
            <DocumentLink href={routes.privacy()}>{tAuth('privacyLink')}</DocumentLink>
            <DocumentLink href={routes.terms()}>{tAuth('termsLink')}</DocumentLink>
          </nav>

          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <Checkbox id="ageConfirmed" checked={ageConfirmed} onCheckedChange={(v) => setAgeConfirmed(v === true)} className="mt-0.5" />
              <Label htmlFor="ageConfirmed" className="font-normal leading-snug">
                {tAuth('ageLabel')}
              </Label>
            </div>
            <div className="flex items-start gap-3">
              <Checkbox id="legalAccepted" checked={accepted} onCheckedChange={(v) => setAccepted(v === true)} className="mt-0.5" />
              <Label htmlFor="legalAccepted" className="block font-normal leading-snug">
                {tAuth.rich('consentLabel', {
                  terms: (chunks) => <DocumentLink href={routes.terms()}>{chunks}</DocumentLink>,
                  privacy: (chunks) => <DocumentLink href={routes.privacy()}>{chunks}</DocumentLink>,
                })}
              </Label>
            </div>
          </div>

          {error && (
            <div role="alert" className="text-sm text-destructive bg-destructive/5 border border-destructive/20 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <Button type="submit" disabled={busy} className="w-full h-11 text-base font-medium">
            {busy ? tAuth('busy') : t('accept')}
          </Button>

          <div className="flex items-center justify-between gap-3 text-sm">
            <button type="button" onClick={signOut} disabled={busy} className="text-muted-foreground hover:text-foreground">
              {t('signOut')}
            </button>
            <button type="button" onClick={() => setDeleteOpen(true)} disabled={busy} className="text-destructive hover:underline underline-offset-2">
              {t('decline')}
            </button>
          </div>
        </form>
      </main>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('deleteTitle')}
        description={t('deleteDescription')}
        confirmLabel={t('deleteTitle')}
        confirmWord="O'CHIRISH"
        onConfirm={deleteAccount}
      />
    </div>
  )
}

function DocumentLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">
      {children}
    </Link>
  )
}
