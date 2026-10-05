'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  LogOut,
  ChevronRight,
  User as UserIcon,
  Palette,
  Shield,
  Trash2,
  Loader2,
  AlertCircle,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { api, ApiError, logoutRequest } from '@/lib/api-client'
import { routes } from '@/lib/routes'
import { useUser } from '@/components/user-provider'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ProfileResponse {
  // The raw `user` field from the API includes nested profile/preferences
  // (with JSON-stringified arrays from SQLite). We ignore those and use the
  // TOP-LEVEL `profile` + `preferences` fields instead, which the API
  // deserializes for us. This avoids the `preferredStyles.join` crash.
  user: {
    id: string
    email: string
    name: string | null
    createdAt: string
  }
  profile: {
    gender: string | null
    bodyShape: string | null
    skinTone: string | null
    skinUndertone: string | null
    hairColor: string | null
    eyeColor: string | null
    preferredFit: string | null
    clothingSize: string | null
  } | null
  preferences: {
    preferredStyles: string[]
    dislikedStyles: string[]
    favoriteColors: string[]
    dislikedColors: string[]
    language: string
  } | null
}

export function ProfileScreen() {
  const { toast } = useToast()
  const user = useUser()
  const router = useRouter()
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [profile, setProfile] = useState<ProfileResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [colorProfile, setColorProfile] = useState<{
    seasonLabel: string | null
  } | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await api<ProfileResponse>('/api/v1/profile')
      setProfile(res)
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Yuklanmadi'
      toast({ title: 'Xato', description: msg, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  // Phase 7: also fetch the color profile so the card on the profile screen
  // can show "X palitra tayyor" instead of the "Tez orada" placeholder.
  useEffect(() => {
    api<{
      colorProfile: {
        season: 'spring' | 'summer' | 'autumn' | 'winter'
      } | null
    }>('/api/v1/color-profile')
      .then((res) => {
        if (res.colorProfile) {
          const labels: Record<typeof res.colorProfile.season, string> = {
            spring: 'Bahor',
            summer: 'Yoz',
            autumn: 'Kuz',
            winter: 'Qish',
          }
          setColorProfile({ seasonLabel: labels[res.colorProfile.season] })
        }
      })
      .catch(() => {
        // Silent
      })
  }, [])

  async function handleLogout() {
    setBusy(true)
    await logoutRequest()
    toast({ title: 'Tizimdan chiqdingiz' })
    router.replace(routes.login())
    router.refresh()
  }

  async function handleDeleteAccount(): Promise<boolean> {
    setBusy(true)
    try {
      await api('/api/v1/account', { method: 'DELETE' })
      // Make sure session cookies are gone even if the server kept them.
      await logoutRequest()
      toast({ title: 'Hisob o‘chirildi', description: 'Barcha ma‘lumotlaringiz o‘chirildi' })
      router.replace(routes.login())
      router.refresh()
      return true
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "O'chirib bo'lmadi"
      toast({ title: 'Xato', description: msg, variant: 'destructive' })
      setBusy(false)
      return false
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-muted-foreground animate-spin" />
      </div>
    )
  }

  const u = profile?.user
  const profile_ = profile?.profile
  const prefs = profile?.preferences

  return (
    <div className="px-5 pt-12 pb-6">
      <h1 className="display-lg mb-6">Profil</h1>

      {/* User card */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="surface-card p-5 mb-4"
      >
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
            <UserIcon className="w-7 h-7 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-foreground truncate">
              {u?.name ?? user.name ?? 'Foydalanuvchi'}
            </p>
            <p className="text-sm text-muted-foreground truncate">{u?.email ?? user.email}</p>
          </div>
        </div>
        <div className="text-xs text-muted-foreground mt-4 pt-4 border-t">
          A'zo bo'lgan sana:{' '}
          {u ? new Date(u.createdAt).toLocaleDateString('uz') : '—'}
        </div>
      </motion.div>

      {/* Profile attributes — most optional per spec section 9 */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
        className="surface-card overflow-hidden mb-4"
      >
        <SectionHeader icon={UserIcon} title="Shaxsiy ma'lumotlar" subtitle="Ko'pchilik ixtiyoriy" />
        <AttributeRow label="Jins" value={profile_?.gender ?? null} />
        <AttributeRow label="Tana shakli" value={profile_?.bodyShape ?? null} />
        <AttributeRow label="Teri ohangi" value={profile_?.skinTone ?? null} />
        <AttributeRow label="Teri osti ohangi" value={profile_?.skinUndertone ?? null} />
        <AttributeRow label="Soch rangi" value={profile_?.hairColor ?? null} />
        <AttributeRow label="Ko'z rangi" value={profile_?.eyeColor ?? null} />
        <AttributeRow label="Afzallikdagi kesim" value={profile_?.preferredFit ?? null} last />
      </motion.div>

      {/* Preferences */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
        className="surface-card overflow-hidden mb-4"
      >
        <SectionHeader
          icon={Palette}
          title="Uslub afzalliklari"
          subtitle="Tavsiyalar bunga moslanadi"
        />
        <PrefRow
          label="Sevimli uslublar"
          value={prefs?.preferredStyles?.length ? prefs.preferredStyles.join(', ') : null}
        />
        <PrefRow
          label="Yoqtirmaydigan uslublar"
          value={prefs?.dislikedStyles?.length ? prefs.dislikedStyles.join(', ') : null}
        />
        <PrefRow
          label="Sevimli ranglar"
          value={prefs?.favoriteColors?.length ? prefs.favoriteColors.join(', ') : null}
        />
        <PrefRow
          label="Yoqtirmaydigan ranglar"
          value={prefs?.dislikedColors?.length ? prefs.dislikedColors.join(', ') : null}
          last
        />
      </motion.div>

      {/* Color analysis card — Phase 7. Tappable to navigate to analysis screen. */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
      >
      <Link
        href={routes.colorAnalysis()}
        className="w-full surface-card p-5 mb-4 text-left hover:border-primary/30 transition-colors group block"
      >
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Palette className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-sm">Rang tahlilisi</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {colorProfile ? `${colorProfile.seasonLabel} palitra tayyor` : 'Selfie yuklang — palitra aniqlaymiz'}
            </p>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {colorProfile
            ? 'Sizning tavsiya qilingan ranglaringizni ko\'rish yoki qayta tahlil qilish uchun bosing.'
            : 'Selfie yuklab, teri ohangi va underton asosida sizga mos rang palitrasini aniqlaymiz.'}
        </p>
      </Link>
      </motion.div>

      {/* Account actions */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="space-y-2"
      >
        <button
          onClick={handleLogout}
          disabled={busy}
          className="w-full surface-card p-4 flex items-center gap-3 hover:border-primary/30 transition-colors"
        >
          <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
            <LogOut className="w-5 h-5 text-foreground" />
          </div>
          <div className="flex-1 text-left">
            <p className="font-medium text-sm">Tizimdan chiqish</p>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </button>

        <button
          onClick={() => setConfirmDeleteOpen(true)}
          disabled={busy}
          className={cn(
            'w-full surface-card p-4 flex items-center gap-3 transition-colors text-left',
            'hover:border-destructive/30',
          )}
        >
          <div className="w-10 h-10 rounded-xl bg-destructive/8 flex items-center justify-center">
            {busy ? (
              <Loader2 className="w-5 h-5 text-destructive animate-spin" />
            ) : (
              <Trash2 className="w-5 h-5 text-destructive" />
            )}
          </div>
          <div className="flex-1">
            <p className="font-medium text-sm text-destructive">Hisobni o'chirish</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Barcha ma'lumotlaringiz o'chiriladi
            </p>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </button>
      </motion.div>

      {/* Privacy note */}
      <div className="flex items-start gap-2 text-xs text-muted-foreground mt-6 px-1 leading-relaxed">
        <Shield className="w-3.5 h-3.5 mt-0.5 text-primary shrink-0" />
        <p>
          Ma'lumotlaringiz shaxsiy saqlanadi. Rasmlaringiz modelni
          o'rgatish uchun ishlatilmaydi.
        </p>
      </div>

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title="Hisobni o'chirish"
        description={
          <>
            Hisobingiz va barcha ma'lumotlaringiz (garderob, outfitlar,
            suhbatlar, rang tahlili) butunlay o'chiriladi. Bu amalni qaytarib
            bo'lmaydi.
          </>
        }
        confirmLabel="Hisobni o'chirish"
        confirmWord="O'CHIRISH"
        onConfirm={handleDeleteAccount}
      />
    </div>
  )
}

function SectionHeader({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  subtitle: string
}) {
  return (
    <div className="flex items-center gap-3 p-4 border-b">
      <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center">
        <Icon className="w-4 h-4 text-foreground" />
      </div>
      <div>
        <p className="font-semibold text-sm">{title}</p>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  )
}

function AttributeRow({
  label,
  value,
  last,
}: {
  label: string
  value: string | null
  last?: boolean
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 px-4 py-3',
        !last && 'border-b',
      )}
    >
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={cn('text-sm font-medium text-right', !value && 'text-muted-foreground/60')}>
        {value ?? "Ko'rsatilmagan"}
      </span>
    </div>
  )
}

function PrefRow({
  label,
  value,
  last,
}: {
  label: string
  value: string | null
  last?: boolean
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 px-4 py-3',
        !last && 'border-b',
      )}
    >
      <span className="text-sm text-muted-foreground">{label}</span>
      {value ? (
        <span className="text-sm font-medium text-right">{value}</span>
      ) : (
        <span className="text-sm text-muted-foreground/60 flex items-center gap-1">
          <AlertCircle className="w-3 h-3" /> Hali yo'q
        </span>
      )}
    </div>
  )
}
