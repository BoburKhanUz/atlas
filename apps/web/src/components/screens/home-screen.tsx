'use client'

import { useEffect, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import {
  Briefcase,
  Heart,
  Plane,
  Coffee,
  Calendar,
  Sparkle,
  ChevronRight,
  CloudSun,
  MapPin,
  Loader2,
} from 'lucide-react'
import Link from 'next/link'
import { api, ApiError } from '@/lib/api-client'
import { routes } from '@/lib/routes'
import { useUser } from '@/components/user-provider'
import { OCCASIONS, type CatalogEntry } from '@/lib/ai/catalog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { InlineError } from '@/components/states/inline-error'

interface WeatherData {
  temperature: number
  feelsLike: number
  condition: string
  conditionLabel: string
  precipitationProbability: number
  humidity: number
  windSpeed: number
  uvIndex: number
  source: string
  cached: boolean
}

// Quick action visual config
const QUICK_ACTIONS: Array<CatalogEntry & { icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'work', label: 'Ish', icon: Briefcase },
  { id: 'wedding', label: "To'y", icon: Heart },
  { id: 'date', label: 'Uchrashuv', icon: Coffee },
  { id: 'travel', label: 'Sayohat', icon: Plane },
  { id: 'casual', label: 'Casual', icon: Calendar },
  { id: 'other', label: 'Boshqa', icon: Sparkle },
]

export function HomeScreen() {
  const user = useUser()
  const [weather, setWeather] = useState<WeatherData | null>(null)
  const [weatherLoading, setWeatherLoading] = useState(true)
  const [weatherError, setWeatherError] = useState<string | null>(null)
  const [wardrobeCount, setWardrobeCount] = useState<number>(0)
  const [wardrobeCountError, setWardrobeCountError] = useState<string | null>(null)

  // Fetch weather (real Open-Meteo). User must grant location permission —
  // if denied, gracefully fall back to a "no weather" state instead of
  // blocking the screen. Spec section 11.
  const fetchWeather = useCallback(async () => {
    setWeatherLoading(true)
    setWeatherError(null)

    if (!('geolocation' in navigator)) {
      setWeatherError('Qurilmada geolokatsiya mavjud emas')
      setWeatherLoading(false)
      return
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await api<{ weather: WeatherData }>(
            `/api/v1/weather/current?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`,
          )
          setWeather(res.weather)
        } catch (err) {
          const msg = err instanceof ApiError ? err.message : 'Ob-havo yuklanmadi'
          setWeatherError(msg)
        } finally {
          setWeatherLoading(false)
        }
      },
      (err) => {
        // Permission denied or unavailable — spec says: don't block the app
        setWeatherError(
          err.code === err.PERMISSION_DENIED
            ? 'Geolokatsiya ruxsati berilmadi. Ob-havo kerak emas — davom etamiz.'
            : 'Joylashuv aniqlanmadi',
        )
        setWeatherLoading(false)
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 10 * 60 * 1000 },
    )
  }, [])

  // Fetch wardrobe count so we can show "X ta kiyim" hint on home
  const loadWardrobeCount = useCallback(async () => {
    setWardrobeCountError(null)
    try {
      const res = await api<{ items: unknown[] }>('/api/v1/wardrobe/items')
      setWardrobeCount(res.items.length)
    } catch (err) {
      setWardrobeCountError(
        err instanceof ApiError ? err.message : 'Garderob yuklanmadi',
      )
    }
  }, [])

  useEffect(() => {
    loadWardrobeCount()
  }, [loadWardrobeCount])

  useEffect(() => {
    fetchWeather()
  }, [fetchWeather])

  const firstName = user.name?.split(' ')[0] ?? undefined

  return (
    <div className="px-5 pt-12 pb-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="mb-8"
      >
        <p className="text-sm text-muted-foreground mb-1">
          {greeting()}{firstName ? `, ${firstName}` : ''}
        </p>
        <h1 className="display-xl text-foreground">
          Bugun nimaga<br />tayyorlanyapsiz?
        </h1>
      </motion.div>

      {/* Weather card */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
        className="mb-8"
      >
        <WeatherCard
          weather={weather}
          loading={weatherLoading}
          error={weatherError}
          onRetry={fetchWeather}
        />
      </motion.div>

      {/* Quick actions grid — spec section 16 */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
        className="mb-8"
      >
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="display-md">Tezkor tanlov</h2>
        </div>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
          {QUICK_ACTIONS.map((action) => {
            const Icon = action.icon
            return (
              <Link
                key={action.id}
                // Outfits reads ?occasion= and auto-generates.
                href={routes.outfits({ occasion: action.id })}
                className="surface-card flex flex-col items-center justify-center gap-2 py-4 hover:border-primary/30 transition-colors"
              >
                <Icon className="w-5 h-5 text-foreground" />
                <span className="text-xs font-medium">{action.label}</span>
              </Link>
            )
          })}
        </div>
      </motion.div>

      {/* Primary CTA — "AI stilistdan so'rash" */}
      <div className="md:grid md:grid-cols-2 md:gap-4">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
        className="mb-4 md:mb-0"
      >
        <Link
          href={routes.stylist()}
          className="w-full h-full surface-card p-5 flex items-center gap-4 hover:border-primary/30 transition-colors text-left group"
        >
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Sparkle className="w-6 h-6 text-primary" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-foreground">AI stilistdan so‘rash</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              Tabiiy tilda so‘rang — javob gardarobingizdan
            </p>
          </div>
          <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors" />
        </Link>
      </motion.div>

      {/* Secondary CTA — "Garderobdan outfit yaratish" (placeholder) */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
      >
      <Link
        href={routes.wardrobe()}
        className="w-full h-full surface-card p-5 flex items-center gap-4 hover:border-primary/30 transition-colors text-left group"
      >
        <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center shrink-0">
          <Layers className="w-6 h-6 text-foreground" />
        </div>
        <div className="flex-1">
          <p className="font-semibold text-foreground">Garderobdan outfit</p>
          <p className="text-sm text-muted-foreground mt-0.5">
            {wardrobeCountError
              ? 'Garderob ma’lumoti yuklanmadi'
              : wardrobeCount > 0
                ? `${wardrobeCount} ta kiyim bilan ishlang`
                : 'Avval garderobingizni to‘ldiring'}
          </p>
        </div>
        <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors" />
      </Link>
      </motion.div>
      </div>

      {wardrobeCountError && (
        <InlineError
          className="mt-3"
          message={wardrobeCountError}
          onRetry={loadWardrobeCount}
        />
      )}
    </div>
  )
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Tongi momingiz'
  if (h < 12) return 'Xayrli tong'
  if (h < 17) return 'Xayrli kun'
  if (h < 22) return 'Xayrli kech'
  return 'Xayrli tun'
}

function WeatherCard({
  weather,
  loading,
  error,
  onRetry,
}: {
  weather: WeatherData | null
  loading: boolean
  error: string | null
  onRetry: () => void
}) {
  if (loading) {
    return (
      <div className="surface-card p-5 flex items-center gap-3">
        <Loader2 className="w-5 h-5 text-primary animate-spin" />
        <p className="text-sm text-muted-foreground">Ob-havo aniqlanmoqda…</p>
      </div>
    )
  }
  if (error || !weather) {
    return (
      <button
        onClick={onRetry}
        className="w-full surface-card p-5 flex items-center gap-3 text-left"
      >
        <MapPin className="w-5 h-5 text-muted-foreground" />
        <p className="text-sm text-muted-foreground flex-1">
          {error ?? 'Ob-havo yuklanmadi'}
        </p>
        <span className="text-xs text-primary font-medium">Qayta</span>
      </button>
    )
  }

  // Show today's weather naturally. Spec example:
  // "35° · Qisman bulutli · Yomg'ir ehtimoli 70%"
  const summary = `${weather.temperature}° · ${weather.conditionLabel} · Yomg'ir ehtimoli ${weather.precipitationProbability}%`
  return (
    <div className="surface-card p-5">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2 text-muted-foreground">
          <CloudSun className="w-4 h-4" />
          <span className="text-xs font-medium">Bugungi ob-havo</span>
        </div>
        <span className="text-xs text-muted-foreground">
          {weather.source === 'mock' ? 'demo' : 'Open-Meteo'}
        </span>
      </div>
      <p className="text-lg font-semibold text-foreground mb-3">{summary}</p>
      <div className="grid grid-cols-3 gap-3 text-xs">
        <div>
          <p className="text-muted-foreground">His qilinadi</p>
          <p className="font-medium text-foreground mt-0.5">{weather.feelsLike}°</p>
        </div>
        <div>
          <p className="text-muted-foreground">Shamol</p>
          <p className="font-medium text-foreground mt-0.5">{weather.windSpeed} km/s</p>
        </div>
        <div>
          <p className="text-muted-foreground">UV indeks</p>
          <p className="font-medium text-foreground mt-0.5">{weather.uvIndex}</p>
        </div>
      </div>
    </div>
  )
}

function Layers({ className }: { className?: string }) {
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
      <path d="M12 2 L22 7 L12 12 L2 7 Z" />
      <path d="M2 12 L12 17 L22 12" />
      <path d="M2 17 L12 22 L22 17" opacity="0.5" />
    </svg>
  )
}
