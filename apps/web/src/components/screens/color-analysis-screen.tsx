'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft,
  Camera,
  ImagePlus,
  Check,
  Loader2,
  AlertCircle,
  Palette,
  Sparkle,
  RotateCcw,
  Sun,
  Thermometer,
} from 'lucide-react'
import { routes } from '@/lib/routes'
import { useBackNavigation } from '@/hooks/use-back-navigation'
import { api, ApiError } from '@/lib/api-client'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { colorById, labelById, COLORS } from '@/lib/ai/catalog'
import { cn } from '@/lib/utils'

type Phase = 'intro' | 'capture' | 'analyzing' | 'result'

interface ColorProfile {
  id: string
  undertone: 'warm' | 'cool' | 'neutral'
  season: 'spring' | 'summer' | 'autumn' | 'winter'
  contrastLevel: 'low' | 'medium' | 'high'
  recommendedColors: string[]
  neutralColors: string[]
  cautionColors: string[]
  skinTone: 'light' | 'medium' | 'tan' | 'deep'
  hairColor: string | null
  eyeColor: string | null
  confidence: number
  analyzedAt: string
}

interface AnalyzeResponse {
  colorProfile: ColorProfile
  disclaimer: string
}

const ANALYSIS_STEPS = [
  { id: 'detect', label: 'Yuz aniqlanmoqda' },
  { id: 'skin', label: 'Teri rangi' },
  { id: 'undertone', label: 'Osti ohang' },
  { id: 'hair', label: 'Soch rangi' },
  { id: 'palette', label: 'Palitra' },
] as const

const SEASON_INFO = {
  spring: {
    label: 'Bahor',
    description:
      'Issiq, yorqin va yangi ohanglar. Sizning teringiz issiq undertone bilan — och va energik ranglar sizda ajoyib ko\'rinadi.',
    icon: Sun,
  },
  summer: {
    label: 'Yoz',
    description:
      'Sovuq, nozik va shaffof ohanglar. Sizning teringiz sovuq undertone bilan — pushti, och ko\'k va neytral sizga eng mos.',
    icon: Sun,
  },
  autumn: {
    label: 'Kuz',
    description:
      'Issiq, boy va yer ohanglar. Sizning teringiz issiq undertone bilan — zaytun, xantal, bordo va jigarronlar ajoyib.',
    icon: Thermometer,
  },
  winter: {
    label: 'Qish',
    description:
      'Sovuq, aniq va yorqin ohanglar. Sizning teringiz sovuq undertone bilan — qora, navy, qizil va oq sizga ajoyib.',
    icon: Sparkle,
  },
} as const

export function ColorAnalysisScreen() {
  const { toast } = useToast()
  const goBack = useBackNavigation(routes.profile())
  const [phase, setPhase] = useState<Phase>('intro')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [profile, setProfile] = useState<ColorProfile | null>(null)
  const [activeStep, setActiveStep] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const cameraInputRef = useRef<HTMLInputElement | null>(null)

  // On mount, try to load existing profile (so user can see previous result)
  useEffect(() => {
    api<{ colorProfile: ColorProfile | null; status: string }>(
      '/api/v1/color-profile',
    )
      .then((res) => {
        if (res.colorProfile) {
          setProfile(res.colorProfile)
        }
      })
      .catch(() => {
        // Silent — not analyzed yet
      })
  }, [])

  const handleFile = useCallback(async (file: File) => {
    setError(null)
    setPhase('analyzing')
    setActiveStep(0)
    setPreviewUrl(URL.createObjectURL(file))

    const stepInterval = setInterval(() => {
      setActiveStep((s) => Math.min(s + 1, ANALYSIS_STEPS.length - 1))
    }, 400)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await api<AnalyzeResponse>('/api/v1/color-profile/analyze', {
        method: 'POST',
        asForm: formData,
      })

      clearInterval(stepInterval)
      setActiveStep(ANALYSIS_STEPS.length - 1)
      await new Promise((r) => setTimeout(r, 250))

      setProfile(res.colorProfile)
      setPhase('result')
      toast({
        title: 'Tahlil tayyor',
        description: 'Sizning rang palitringiz saqlandi',
      })
    } catch (err) {
      clearInterval(stepInterval)
      const msg = err instanceof ApiError ? err.message : 'Tahlil amalga oshmadi'
      setError(msg)
      setPhase('capture')
      setPreviewUrl(null)
    }
  }, [toast])

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ''
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <div className="px-5 pt-12 pb-3 flex items-center gap-3">
        <button
          onClick={goBack}
          className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-muted transition-colors"
          aria-label="Orqaga"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="display-md flex-1">Rang tahlilisi</h1>
      </div>

      <div className="flex-1 px-5 pb-6">
        <AnimatePresence mode="wait">
          {phase === 'intro' && (
            <IntroPhase
              key="intro"
              existingProfile={profile}
              onStart={() => setPhase('capture')}
              onShowResult={() => setPhase('result')}
            />
          )}
          {phase === 'capture' && (
            <CapturePhase
              key="capture"
              previewUrl={previewUrl}
              error={error}
              fileInputRef={fileInputRef}
              cameraInputRef={cameraInputRef}
              onFile={handleFileInput}
            />
          )}
          {phase === 'analyzing' && (
            <AnalyzingPhase
              key="analyzing"
              previewUrl={previewUrl}
              activeStep={activeStep}
            />
          )}
          {phase === 'result' && profile && (
            <ResultPhase
              key="result"
              profile={profile}
              onRetry={() => {
                setProfile(null)
                setPhase('capture')
              }}
            />
          )}
        </AnimatePresence>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileInput}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="user"
        className="hidden"
        onChange={handleFileInput}
      />
    </div>
  )
}

function IntroPhase({
  existingProfile,
  onStart,
  onShowResult,
}: {
  existingProfile: ColorProfile | null
  onStart: () => void
  onShowResult: () => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.3 }}
    >
      {/* Hero */}
      <div className="text-center mb-6">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 mx-auto mb-4 flex items-center justify-center">
          <Palette className="w-8 h-8 text-primary" />
        </div>
        <h2 className="display-lg mb-2">Sizga mos ranglar</h2>
        <p className="text-sm text-muted-foreground leading-relaxed max-w-xs mx-auto">
          Selfie yuklang — AI teri ohangini, osti ohangini va
          soch/ko&apos;z rangini tahlil qilib, sizga eng mos rang
          palitrasini aniqlaydi.
        </p>
      </div>

      {/* Steps preview */}
      <div className="surface-card p-4 mb-4">
        <p className="text-xs font-medium text-muted-foreground mb-3">
          Tahlil bosqichlari
        </p>
        <ul className="space-y-2 text-sm">
          {ANALYSIS_STEPS.map((s, i) => (
            <li key={s.id} className="flex items-center gap-3">
              <div className="w-5 h-5 rounded-full bg-primary/8 text-primary text-[10px] flex items-center justify-center font-semibold">
                {i + 1}
              </div>
              <span className="text-foreground">{s.label}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Privacy + disclaimer */}
      <div className="surface-card p-4 mb-6">
        <div className="flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs text-foreground font-medium mb-1">
              Bu AI tavsiyasi
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Rang tahlilisi AI tomonidan amalga oshiriladi — tibbiy yoki
              ilmiy diagnosis emas. Selfie shaxsiy saqlanadi va modelni
              o&apos;rgatish uchun ishlatilmaydi.
            </p>
          </div>
        </div>
      </div>

      {existingProfile && (
        <button
          onClick={onShowResult}
          className="w-full surface-card p-4 flex items-center gap-3 mb-3 hover:border-primary/30 transition-colors text-left"
        >
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Sparkle className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1">
            <p className="font-medium text-sm">Oldingi natijani ko&apos;rish</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {SEASON_INFO[existingProfile.season].label} palitrasida tahlil
              qilingan
            </p>
          </div>
          <ArrowLeft className="w-4 h-4 text-muted-foreground rotate-180" />
        </button>
      )}

      <Button
        onClick={onStart}
        className="w-full h-11"
        size="lg"
      >
        <Camera className="w-4 h-4 mr-2" />
        Selfie yuklash
      </Button>
    </motion.div>
  )
}

function CapturePhase({
  previewUrl,
  error,
  fileInputRef,
  cameraInputRef,
  onFile,
}: {
  previewUrl: string | null
  error: string | null
  fileInputRef: React.RefObject<HTMLInputElement | null>
  cameraInputRef: React.RefObject<HTMLInputElement | null>
  onFile: (e: React.ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.3 }}
    >
      <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
        Yuzingiz yorug&apos;da, kam qiyshiq holda olingan rasm
        yuklang. AI teri, soch va ko&apos;z piksellarini real vaqtda tahlil
        qiladi.
      </p>

      {error && (
        <div className="mb-4 surface-card p-3 border-destructive/30 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Dropzone */}
      <div className="surface-card p-8 mb-4">
        <div className="aspect-[3/4] bg-muted rounded-xl overflow-hidden flex items-center justify-center mb-6">
          {previewUrl ? (
             
            <img src={previewUrl} alt="preview" className="w-full h-full object-cover" />
          ) : (
            <div className="text-center text-muted-foreground">
              <Camera className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Rasm tayyor emas</p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <Button
            variant="outline"
            className="h-12"
            onClick={() => cameraInputRef.current?.click()}
          >
            <Camera className="w-4 h-4 mr-2" />
            Kamera
          </Button>
          <Button
            variant="outline"
            className="h-12"
            onClick={() => fileInputRef.current?.click()}
          >
            <ImagePlus className="w-4 h-4 mr-2" />
            Galereya
          </Button>
        </div>
      </div>

      {/* Tips */}
      <div className="text-xs text-muted-foreground space-y-1.5">
        <p className="font-medium text-foreground">Maslahatlar:</p>
        <p>• Yorug&apos;da, lekin to&apos;g&apos;ridan-to&apos;g&apos;ri quyosh nuri holda</p>
        <p>• Yuzingiz markazda, ko&apos;zlar ochiq</p>
        <p>• Vaqtingizda — 1 soniya atrofida</p>
      </div>
    </motion.div>
  )
}

function AnalyzingPhase({
  previewUrl,
  activeStep,
}: {
  previewUrl: string | null
  activeStep: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.3 }}
    >
      <div className="surface-card p-4 mb-5">
        <div className="aspect-[3/4] bg-muted rounded-xl overflow-hidden max-w-[220px] mx-auto relative">
          {previewUrl && (
             
            <img src={previewUrl} alt="" className="w-full h-full object-cover" />
          )}
          <div className="absolute inset-0 bg-white/40 skeleton-shimmer" />
        </div>
      </div>

      <div className="surface-card p-5">
        <div className="flex items-center gap-2.5 mb-4">
          <Loader2 className="w-4 h-4 text-primary animate-spin" />
          <p className="font-medium">Rang tahlil qilinmoqda…</p>
        </div>
        <ul className="space-y-3">
          {ANALYSIS_STEPS.map((step, i) => {
            const done = i < activeStep
            const current = i === activeStep
            return (
              <li key={step.id} className="flex items-center gap-3">
                <div
                  className={cn(
                    'w-5 h-5 rounded-full flex items-center justify-center text-[10px] transition-colors',
                    done
                      ? 'bg-primary text-primary-foreground'
                      : current
                        ? 'border-2 border-primary'
                        : 'border-2 border-muted-foreground/30',
                  )}
                >
                  {done ? <Check className="w-3 h-3" /> : ''}
                </div>
                <span
                  className={cn(
                    'text-sm transition-colors',
                    done || current ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {step.label}
                </span>
                {current && (
                  <Loader2 className="w-3.5 h-3.5 text-primary animate-spin ml-auto" />
                )}
              </li>
            )
          })}
        </ul>
      </div>
      <p className="text-xs text-muted-foreground text-center mt-4">
        Bu jarayon 2-4 soniya atrofida davom etadi
      </p>
    </motion.div>
  )
}

function ResultPhase({
  profile,
  onRetry,
}: {
  profile: ColorProfile
  onRetry: () => void
}) {
  const SeasonIcon = SEASON_INFO[profile.season].icon
  const seasonInfo = SEASON_INFO[profile.season]

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      {/* Hero summary */}
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
        className="surface-card p-6 mb-4 text-center"
      >
        <div className="w-14 h-14 rounded-2xl bg-primary/10 mx-auto mb-3 flex items-center justify-center">
          <SeasonIcon className="w-7 h-7 text-primary" />
        </div>
        <p className="text-xs text-muted-foreground mb-1">
          Sizning mavsumiy palitringiz
        </p>
        <h2 className="display-lg mb-2">{seasonInfo.label}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed max-w-xs mx-auto mb-3">
          {seasonInfo.description}
        </p>
        {/* Tag row */}
        <div className="flex flex-wrap gap-1.5 justify-center">
          <Tag label={`osti: ${profile.undertone}`} />
          <Tag label={`teri: ${profile.skinTone}`} />
          <Tag label={`kontrast: ${profile.contrastLevel}`} />
        </div>
      </motion.div>

      {/* Hair + Eye colors */}
      {(profile.hairColor || profile.eyeColor) && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="surface-card p-4 mb-4"
        >
          <h3 className="font-semibold text-sm mb-3">Aniqlangan ranglar</h3>
          <div className="grid grid-cols-2 gap-3">
            {profile.hairColor && (
              <DetectedColorTile label="Soch" colorId={profile.hairColor} />
            )}
            {profile.eyeColor && (
              <DetectedColorTile label="Ko'z" colorId={profile.eyeColor} />
            )}
          </div>
        </motion.div>
      )}

      {/* Recommended colors */}
      {profile.recommendedColors.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15 }}
          className="surface-card p-4 mb-4"
        >
          <div className="flex items-center gap-2 mb-3">
            <Check className="w-4 h-4 text-success" />
            <h3 className="font-semibold text-sm">Tavsiya qilinadigan ranglar</h3>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {profile.recommendedColors.map((cId) => (
              <ColorSwatchTile key={cId} colorId={cId} />
            ))}
          </div>
        </motion.div>
      )}

      {/* Neutral colors */}
      {profile.neutralColors.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="surface-card p-4 mb-4"
        >
          <h3 className="font-semibold text-sm mb-3">Neytral ranglar</h3>
          <div className="grid grid-cols-4 gap-2">
            {profile.neutralColors.map((cId) => (
              <ColorSwatchTile key={cId} colorId={cId} />
            ))}
          </div>
        </motion.div>
      )}

      {/* Caution colors */}
      {profile.cautionColors.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.25 }}
          className="surface-card p-4 mb-4"
        >
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle className="w-4 h-4 text-amber-600" />
            <h3 className="font-semibold text-sm">Ehtiyotkor ranglar</h3>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {profile.cautionColors.map((cId) => (
              <ColorSwatchTile key={cId} colorId={cId} muted />
            ))}
          </div>
        </motion.div>
      )}

      {/* Disclaimer */}
      <div className="flex items-start gap-2 text-xs text-muted-foreground px-1 mb-4 leading-relaxed">
        <AlertCircle className="w-3.5 h-3.5 mt-0.5 text-primary shrink-0" />
        <p>
          Bu AI tavsiyasi — tibbiy yoki ilmiy diagnosis emas. Faqat
          styling maqsadida. Selfie va tahlil natijasi shaxsiy saqlanadi.
        </p>
      </div>

      {/* Retry */}
      <Button
        onClick={onRetry}
        variant="outline"
        className="w-full h-11"
      >
        <RotateCcw className="w-4 h-4 mr-2" />
        Qayta tahlil qilish
      </Button>
    </motion.div>
  )
}

function DetectedColorTile({ label, colorId }: { label: string; colorId: string }) {
  const color = colorById(colorId)
  if (!color) return null
  return (
    <div className="bg-muted/50 rounded-xl p-3">
      <p className="text-xs text-muted-foreground mb-2">{label}</p>
      <div className="flex items-center gap-2">
        <span
          className="w-7 h-7 rounded-full border border-black/10"
          style={{ backgroundColor: color.hex }}
        />
        <span className="text-sm font-medium">{color.label}</span>
      </div>
    </div>
  )
}

function ColorSwatchTile({ colorId, muted }: { colorId: string; muted?: boolean }) {
  const color = colorById(colorId)
  if (!color) return null
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={cn(
          'w-full aspect-square rounded-xl border border-black/10',
          muted && 'opacity-60',
        )}
        style={{ backgroundColor: color.hex }}
      />
      <span className="text-[10px] text-muted-foreground truncate w-full text-center">
        {color.label}
      </span>
    </div>
  )
}

function Tag({ label }: { label: string }) {
  return (
    <span className="text-[10px] font-medium bg-muted text-foreground px-2 py-1 rounded-full">
      {label}
    </span>
  )
}

// Avoid unused-import warning
void labelById
void COLORS
