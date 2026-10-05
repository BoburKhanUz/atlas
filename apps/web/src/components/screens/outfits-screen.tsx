'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Loader2,
  RefreshCw,
  Heart,
  ThumbsUp,
  ThumbsDown,
  ChevronDown,
  ChevronUp,
  Sparkle,
  Calendar,
  CloudSun,
  Check,
  Layers,
  AlertCircle,
} from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { InlineError } from '@/components/states/inline-error'
import { api, ApiError } from '@/lib/api-client'
import { useToast } from '@/hooks/use-toast'
import { OCCASIONS, colorById, labelById, CATEGORIES, STYLES } from '@/lib/ai/catalog'
import { cn } from '@/lib/utils'

// ─── Types (mirror backend) ────────────────────────────────────────────────
interface OutfitItemView {
  id: string
  role: string
  category: string
  subcategory: string | null
  colors: string[]
  style: string | null
  material: string | null
  season: string[]
  imageUrl: string | null
}
interface OutfitCandidateView {
  tempId: string
  score: number
  factors: {
    weather: number
    color: number
    occasion: number
    style: number
    season: number
    balance: number
    preference: number
    feedback: number
  }
  reasons: string[]
  contrastLevel: 'low' | 'medium' | 'high'
  items: OutfitItemView[]
  explanation: string | null
  /** Optional persisted outfit id — set when the candidate is saved. */
  savedOutfitId?: string | null
  isSaved?: boolean
}
interface GenerateResponse {
  outfits: OutfitCandidateView[]
  weatherUsed: {
    temperature: number
    feelsLike: number
    condition: string
    precipitationProbability: number
    humidity: number
    windSpeed: number
    uvIndex: number
  } | null
  occasion: string | null
  wardrobeItemCount: number
  message?: string
}
interface SavedOutfit {
  id: string
  name: string | null
  occasion: string | null
  score: number | null
  explanation: string | null
  isSaved: boolean
  createdAt: string
  items: Array<{
    id: string
    role: string | null
    category: string
    subcategory: string | null
    colors: string[]
    style: string | null
    material: string | null
    season: string[]
    image: { url: string; thumbnailUrl: string | null; isPrimary: boolean } | null
  }>
}

type Phase = 'idle' | 'loading' | 'ready'

export function OutfitsScreen() {
  const { toast } = useToast()
  // ?occasion= (e.g. from a Home quick action) pre-selects and auto-generates.
  const searchParams = useSearchParams()
  const occasionParam = searchParams.get('occasion')
  const [phase, setPhase] = useState<Phase>('idle')
  const [occasion, setOccasion] = useState<string | null>(occasionParam)
  const [outfits, setOutfits] = useState<OutfitCandidateView[]>([])
  const [weather, setWeather] = useState<GenerateResponse['weatherUsed'] | null>(null)
  const [wardrobeCount, setWardrobeCount] = useState<number>(0)
  const [message, setMessage] = useState<string | null>(null)
  const [activeIdx, setActiveIdx] = useState(0)
  const [savedOutfits, setSavedOutfits] = useState<SavedOutfit[]>([])
  const [savedError, setSavedError] = useState<string | null>(null)
  const [expandedReasons, setExpandedReasons] = useState(false)
  const [feedbackGiven, setFeedbackGiven] = useState<Record<string, 'liked' | 'disliked' | 'saved' | null>>({})
  const seedRef = useRef<number>(Date.now())

  // Load saved outfits on mount
  const loadSaved = useCallback(async () => {
    setSavedError(null)
    try {
      const res = await api<{ outfits: SavedOutfit[] }>(
        '/api/v1/outfits?saved=1',
      )
      setSavedOutfits(res.outfits)
    } catch (err) {
      setSavedError(
        err instanceof ApiError ? err.message : 'Saqlangan outfitlar yuklanmadi',
      )
    }
  }, [])

  // Stable ref to `generate` so the auto-generate effect can call it without
  // re-running when generate's identity changes.
  const generateRef = useRef<((occ?: string | null) => Promise<void>) | null>(null)

  useEffect(() => {
    loadSaved()
  }, [loadSaved])

  // Auto-generate if ?occasion= was passed (from Home quick action)
  useEffect(() => {
    if (occasionParam) {
      setOccasion(occasionParam)
      const t = setTimeout(() => generateRef.current?.(occasionParam), 100)
      return () => clearTimeout(t)
    }
  }, [occasionParam])

  // ── Generate — calls /api/v1/outfits/generate ────────────────────────────
  // Defined after the auto-generate effect (above) so we can safely assign
  // its ref. Function declarations are hoisted, but the lint rule doesn't
  // know that.
  async function generate(occasionArg?: string | null) {
    setPhase('loading')
    setMessage(null)
    setActiveIdx(0)
    setExpandedReasons(false)
    setFeedbackGiven({})

    const occ = occasionArg !== undefined ? occasionArg : occasion
    // Try to get fresh geolocation for accurate weather — but if denied,
    // gracefully degrade (the server will proceed without weather).
    let lat: number | null = null
    let lon: number | null = null
    if ('geolocation' in navigator) {
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: false,
            timeout: 6000,
            maximumAge: 5 * 60 * 1000,
          })
        })
        lat = pos.coords.latitude
        lon = pos.coords.longitude
      } catch {
        // User denied or timed out — proceed without
      }
    }

    // Re-roll seed so refresh actually changes the result
    seedRef.current = Date.now()

    try {
      const res = await api<GenerateResponse>('/api/v1/outfits/generate', {
        method: 'POST',
        body: {
          occasion: occ ?? null,
          lat: lat ?? null,
          lon: lon ?? null,
          seed: seedRef.current,
          topN: 3,
        },
      })
      setOutfits(res.outfits)
      setWeather(res.weatherUsed)
      setWardrobeCount(res.wardrobeItemCount)
      setMessage(res.message ?? null)
      setPhase('ready')
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Outfit yaratib bo‘lmadi'
      toast({ title: 'Xato', description: msg, variant: 'destructive' })
      setPhase('idle')
    }
  }
  // Keep the ref to `generate` in sync — needed for the auto-generate effect.
  generateRef.current = generate

  // ── Persist the candidate as a saved outfit (heart button) ───────────────
  async function saveOutfit(candidate: OutfitCandidateView) {
    try {
      const res = await api<{ outfit: { id: string } }>('/api/v1/outfits', {
        method: 'POST',
        body: {
          occasion: occasion ?? null,
          weather: weather,
          score: candidate.score,
          reasons: candidate.reasons,
          explanation: candidate.explanation,
          isSaved: true,
          items: candidate.items.map((it) => ({
            itemId: it.id,
            role: it.role,
          })),
        },
      })
      // Mark as saved locally
      setOutfits((prev) =>
        prev.map((o, idx) =>
          idx === activeIdx
            ? { ...o, savedOutfitId: res.outfit.id, isSaved: true }
            : o,
        ),
      )
      setFeedbackGiven((prev) => ({ ...prev, [candidate.tempId]: 'saved' }))
      toast({
        title: 'Saqlandi',
        description: 'Outfit "Saqlanganlar" ro‘yxatiga qo‘shildi',
      })
      loadSaved()
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Saqlab bo‘lmadi'
      toast({ title: 'Xato', description: msg, variant: 'destructive' })
    }
  }

  // ── Send like / dislike feedback ─────────────────────────────────────────
  async function sendFeedback(
    candidate: OutfitCandidateView,
    kind: 'liked' | 'disliked',
  ) {
    // If not yet persisted, save first so we have an outfit id to attach
    // feedback to. Spec section 17: feedback must be stored.
    let outfitId = candidate.savedOutfitId
    if (!outfitId) {
      try {
        const res = await api<{ outfit: { id: string } }>('/api/v1/outfits', {
          method: 'POST',
          body: {
            occasion: occasion ?? null,
            weather: weather,
            score: candidate.score,
            reasons: candidate.reasons,
            explanation: candidate.explanation,
            isSaved: false,
            items: candidate.items.map((it) => ({
              itemId: it.id,
              role: it.role,
            })),
          },
        })
        outfitId = res.outfit.id
        setOutfits((prev) =>
          prev.map((o, idx) =>
            idx === activeIdx ? { ...o, savedOutfitId: outfitId } : o,
          ),
        )
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : 'Saqlab bo‘lmadi'
        toast({ title: 'Xato', description: msg, variant: 'destructive' })
        return
      }
    }

    try {
      await api(`/api/v1/outfits/${outfitId}/feedback`, {
        method: 'POST',
        body: { feedback: kind },
      })
      setFeedbackGiven((prev) => ({ ...prev, [candidate.tempId]: kind }))
      toast({
        title: kind === 'liked' ? 'Yaxshi 👍' : 'Tushundim 👎',
        description:
          kind === 'liked'
            ? 'Fikringiz saqlandi — bundan keyin shu kabi outfitlarni tavsiya qilamiz'
            : 'Fikringiz saqlandi — bunday kombinatsiyani kam tavsiya qilamiz',
      })
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Fikr yuborilmadi'
      toast({ title: 'Xato', description: msg, variant: 'destructive' })
    }
  }

  // ── Render states ─────────────────────────────────────────────────────────
  return (
    <div className="px-5 pt-12 pb-6">
      <div className="mb-6">
        <h1 className="display-lg">Outfitlar</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Garderobingizdan avtomatik kombinatsiya
        </p>
      </div>

      {/* Occasion selector — pre-select from Home quick action if provided */}
      {phase !== 'loading' && (
        <div className="mb-5">
          <p className="text-xs font-medium text-muted-foreground mb-2">Tadbir</p>
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1 -mx-5 px-5 md:flex-wrap md:overflow-visible">
            <button
              onClick={() => setOccasion(null)}
              className={cn(
                'shrink-0 text-sm font-medium px-3.5 py-2 rounded-full transition-all',
                !occasion
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:text-foreground',
              )}
            >
              Avtomatik
            </button>
            {OCCASIONS.map((o) => (
              <button
                key={o.id}
                onClick={() => setOccasion(o.id)}
                className={cn(
                  'shrink-0 text-sm font-medium px-3.5 py-2 rounded-full transition-all',
                  occasion === o.id
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:text-foreground',
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Generate button — only when idle or after generating */}
      {phase === 'idle' && (
        <IdleGenerateButton onGenerate={() => generate()} />
      )}

      {/* Loading state — show progress checklist */}
      {phase === 'loading' && <LoadingState />}

      {/* Ready state — show top outfit + alternatives */}
      {phase === 'ready' && (
        <>
          {message && outfits.length === 0 ? (
            <EmptyResult message={message} wardrobeCount={wardrobeCount} />
          ) : (
            <div className="lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:gap-6 lg:items-start">
              <div className="min-w-0">
              <WeatherContext weather={weather} occasion={occasion} />

              {/* Primary outfit card — spec section 17 */}
              {outfits[activeIdx] && (
                <OutfitCard
                  outfit={outfits[activeIdx]}
                  isPrimary
                  expanded={expandedReasons}
                  onToggleExpand={() => setExpandedReasons((v) => !v)}
                  onSave={() => saveOutfit(outfits[activeIdx])}
                  onLike={() => sendFeedback(outfits[activeIdx], 'liked')}
                  onDislike={() => sendFeedback(outfits[activeIdx], 'disliked')}
                  onRefresh={() => generate()}
                  feedbackState={feedbackGiven[outfits[activeIdx].tempId]}
                />
              )}
              </div>

              {/* Alternatives — carousel on mobile, grid on md, side column on lg */}
              {outfits.length > 1 && (
                <div className="mt-6 lg:mt-0 min-w-0">
                  <p className="text-xs font-medium text-muted-foreground mb-2.5">
                    Boshqa variantlar
                  </p>
                  <div className="flex gap-2.5 overflow-x-auto no-scrollbar -mx-5 px-5 pb-2 md:grid md:grid-cols-3 md:overflow-visible md:mx-0 md:px-0 lg:grid-cols-1">
                    {outfits.map((o, idx) => (
                      <button
                        key={o.tempId}
                        onClick={() => {
                          setActiveIdx(idx)
                          setExpandedReasons(false)
                        }}
                        className={cn(
                          'shrink-0 w-[140px] md:w-auto surface-card p-3 text-left transition-all',
                          idx === activeIdx
                            ? 'border-primary/50 ring-1 ring-primary/20'
                            : 'hover:border-primary/30',
                        )}
                      >
                        <div className="flex gap-1 mb-2">
                          {o.items.slice(0, 3).map((it) => (
                            <div
                              key={it.id}
                              className="w-12 h-12 rounded-lg bg-muted overflow-hidden"
                            >
                              {it.imageUrl && (
                                 
                                <img
                                  src={it.imageUrl}
                                  alt=""
                                  className="w-full h-full object-cover"
                                />
                              )}
                            </div>
                          ))}
                        </div>
                        <div className="flex items-baseline justify-between">
                          <span className="text-xs text-muted-foreground">
                            #{idx + 1}
                          </span>
                          <span className="text-base font-semibold text-primary">
                            {o.score}%
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Saved outfits list */}
      {savedError && phase !== 'loading' && (
        <InlineError className="mt-8" message={savedError} onRetry={loadSaved} />
      )}
      {savedOutfits.length > 0 && phase !== 'loading' && (
        <div className="mt-8">
          <div className="flex items-center gap-2 mb-3">
            <Heart className="w-4 h-4 text-primary" />
            <h2 className="font-semibold text-sm">Saqlangan outfitlar</h2>
            <span className="text-xs text-muted-foreground">({savedOutfits.length})</span>
          </div>
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {savedOutfits.map((o) => (
              <SavedOutfitRow key={o.id} outfit={o} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Idle (initial) state ────────────────────────────────────────────────────
function IdleGenerateButton({ onGenerate }: { onGenerate: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      <button
        onClick={onGenerate}
        className="w-full surface-card p-6 flex flex-col items-center text-center hover:border-primary/30 transition-colors"
      >
        <div className="w-14 h-14 rounded-2xl bg-primary/10 mx-auto mb-4 flex items-center justify-center">
          <Sparkle className="w-7 h-7 text-primary" />
        </div>
        <h3 className="font-semibold mb-1.5">Outfit yarating</h3>
        <p className="text-sm text-muted-foreground leading-relaxed mb-4 max-w-xs">
          AI garderobingizni tahlil qiladi, ob-havo va tadbirga mos
          kombinatsiyani avtomatik tuzadi va ball bilan baholaydi.
        </p>
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-primary bg-primary/8 px-4 py-2 rounded-full">
          <Sparkle className="w-3.5 h-3.5" />
          Boshlash
        </span>
      </button>
    </motion.div>
  )
}

// ─── Loading state ──────────────────────────────────────────────────────────
function LoadingState() {
  const [step, setStep] = useState(0)
  const steps = [
    'Garderob tahlil qilinmoqda…',
    'Mos kiyimlar tanlanmoqda…',
    'Rang uyg‘unligi baholanmoqda…',
    'Ball hisoblanmoqda…',
    'Izoh tayyorlanmoqda…',
  ]

  useEffect(() => {
    const interval = setInterval(() => {
      setStep((s) => Math.min(s + 1, steps.length - 1))
    }, 700)
    return () => clearInterval(interval)
  }, [])

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="surface-card p-6"
    >
      <div className="flex items-center gap-2.5 mb-5">
        <Loader2 className="w-4 h-4 text-primary animate-spin" />
        <p className="font-medium text-sm">Tavsiya dvigateli ishlamoqda</p>
      </div>
      <ul className="space-y-2.5">
        {steps.map((s, i) => (
          <li key={i} className="flex items-center gap-3">
            <div
              className={cn(
                'w-5 h-5 rounded-full flex items-center justify-center transition-colors',
                i < step
                  ? 'bg-primary text-primary-foreground'
                  : i === step
                    ? 'border-2 border-primary'
                    : 'border-2 border-muted-foreground/20',
              )}
            >
              {i < step && <Check className="w-3 h-3" />}
            </div>
            <span
              className={cn(
                'text-sm transition-colors',
                i <= step ? 'text-foreground' : 'text-muted-foreground/60',
              )}
            >
              {s}
            </span>
            {i === step && (
              <Loader2 className="w-3.5 h-3.5 text-primary animate-spin ml-auto" />
            )}
          </li>
        ))}
      </ul>
    </motion.div>
  )
}

// ─── Weather context strip ───────────────────────────────────────────────────
function WeatherContext({
  weather,
  occasion,
}: {
  weather: GenerateResponse['weatherUsed']
  occasion: string | null
}) {
  if (!weather && !occasion) return null
  return (
    <div className="surface-card p-3.5 mb-4 flex items-center gap-3">
      <CloudSun className="w-5 h-5 text-primary shrink-0" />
      <div className="flex-1 text-xs text-muted-foreground">
        {weather && (
          <span>
            {weather.temperature}° · hisdagi {weather.feelsLike}° · yomg'ir {weather.precipitationProbability}%
          </span>
        )}
        {weather && occasion && <span className="mx-1.5">·</span>}
        {occasion && (
          <span className="text-foreground font-medium">
            {OCCASIONS.find((o) => o.id === occasion)?.label ?? occasion}
          </span>
        )}
      </div>
    </div>
  )
}

// ─── Primary outfit card — spec section 17 ─────────────────────────────────
function OutfitCard({
  outfit,
  isPrimary,
  expanded,
  onToggleExpand,
  onSave,
  onLike,
  onDislike,
  onRefresh,
  feedbackState,
}: {
  outfit: OutfitCandidateView
  isPrimary?: boolean
  expanded: boolean
  onToggleExpand: () => void
  onSave: () => void
  onLike: () => void
  onDislike: () => void
  onRefresh: () => void
  feedbackState: 'liked' | 'disliked' | 'saved' | null
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="surface-card overflow-hidden"
    >
      {/* Header strip with score */}
      <div className="p-4 flex items-center justify-between border-b">
        <div>
          {isPrimary && (
            <p className="text-xs text-muted-foreground mb-0.5">
              Bugungi eng yaxshi variant
            </p>
          )}
          <div className="flex items-baseline gap-1.5">
            <span className="text-3xl font-bold text-primary">{outfit.score}</span>
            <span className="text-base text-muted-foreground">/ 100</span>
          </div>
        </div>
        <div className="flex gap-1">
          {outfit.reasons.slice(0, 3).map((r) => (
            <ReasonBadge key={r} reasonId={r} />
          ))}
        </div>
      </div>

      {/* Composition: item thumbnails arranged horizontally */}
      <div className="p-4">
        <div className="flex gap-3 mb-4">
          {outfit.items.map((it) => (
            <div key={it.id} className="flex-1">
              <div className="aspect-[3/4] bg-muted rounded-xl overflow-hidden mb-2">
                {it.imageUrl ? (
                   
                  <img
                    src={it.imageUrl}
                    alt={it.category}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Layers className="w-6 h-6 text-muted-foreground" />
                  </div>
                )}
              </div>
              <p className="text-xs font-medium text-foreground truncate">
                {labelById(CATEGORIES, it.category) ?? it.category}
              </p>
              <div className="flex items-center gap-1 mt-0.5">
                {it.colors.slice(0, 2).map((c) => {
                  const color = colorById(c)
                  return (
                    <span
                      key={c}
                      className="inline-block w-2.5 h-2.5 rounded-full border border-black/10"
                      style={{ backgroundColor: color?.hex ?? '#999' }}
                      title={color?.label}
                    />
                  )
                })}
                <span className="text-[10px] text-muted-foreground">
                  {labelById(STYLES, it.style) ?? ''}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* LLM explanation */}
        {outfit.explanation && (
          <div className="bg-muted/50 rounded-xl p-3.5 mb-3">
            <p className="text-sm text-foreground leading-relaxed">
              {outfit.explanation}
            </p>
          </div>
        )}

        {/* Nega? — expandable factor breakdown */}
        <button
          onClick={onToggleExpand}
          className="w-full flex items-center justify-between text-sm font-medium text-foreground py-2"
        >
          <span>Nega shu outfit?</span>
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </button>
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="overflow-hidden"
            >
              <ul className="space-y-1.5 pt-2 pb-1">
                <FactorRow label="Ob-havo mosligi" value={outfit.factors.weather} />
                <FactorRow label="Rang uyg‘unligi" value={outfit.factors.color} />
                <FactorRow label="Tadbirga moslik" value={outfit.factors.occasion} />
                <FactorRow label="Uslub mosligi" value={outfit.factors.style} />
                <FactorRow label="Mavsum mosligi" value={outfit.factors.season} />
                <FactorRow label="Garderob balansi" value={outfit.factors.balance} />
                <FactorRow label="Sizning afzalligingiz" value={outfit.factors.preference} />
              </ul>
              <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
                Kontrast darajasi: {outfit.contrastLevel === 'low' ? 'past' : outfit.contrastLevel === 'medium' ? "o'rta" : 'yuqori'}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Feedback buttons — spec section 17 */}
      <div className="border-t p-3 grid grid-cols-4 gap-1">
        <FeedbackButton
          active={feedbackState === 'saved' || !!outfit.isSaved}
          activeColor="bg-primary/8 text-primary"
          onClick={onSave}
          icon={<Heart className={cn('w-4 h-4', feedbackState === 'saved' || outfit.isSaved ? 'fill-current' : '')} />}
          label="Saqlash"
        />
        <FeedbackButton
          active={feedbackState === 'liked'}
          activeColor="bg-success/10 text-success"
          onClick={onLike}
          icon={<ThumbsUp className="w-4 h-4" />}
          label="Yoqdi"
        />
        <FeedbackButton
          active={feedbackState === 'disliked'}
          activeColor="bg-destructive/10 text-destructive"
          onClick={onDislike}
          icon={<ThumbsDown className="w-4 h-4" />}
          label="Yoqmadi"
        />
        <FeedbackButton
          active={false}
          activeColor=""
          onClick={onRefresh}
          icon={<RefreshCw className="w-4 h-4" />}
          label="Boshqa"
        />
      </div>
    </motion.div>
  )
}

function ReasonBadge({ reasonId }: { reasonId: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    weather: { label: 'ob-havo', cls: 'bg-success/10 text-success' },
    color_harmony: { label: 'rang', cls: 'bg-primary/10 text-primary' },
    occasion: { label: 'tadbir', cls: 'bg-amber-500/10 text-amber-600' },
    style_match: { label: 'uslub', cls: 'bg-purple-500/10 text-purple-600' },
    season: { label: 'mavsum', cls: 'bg-blue-500/10 text-blue-600' },
    preference: { label: 'sizniki', cls: 'bg-pink-500/10 text-pink-600' },
  }
  // Strip any prefixed reason (e.g. "color:..." is a sub-reason — not a badge)
  const base = reasonId.split(':')[0]
  const entry = map[base]
  if (!entry) return null
  return (
    <span
      className={cn(
        'text-[10px] font-medium px-2 py-0.5 rounded-full',
        entry.cls,
      )}
    >
      {entry.label}
    </span>
  )
}

function FactorRow({ label, value }: { label: string; value: number }) {
  const isHigh = value >= 80
  const isMid = value >= 60 && value < 80
  return (
    <li className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2 flex-1 max-w-[140px]">
        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full transition-all',
              isHigh ? 'bg-success' : isMid ? 'bg-primary' : 'bg-muted-foreground/40',
            )}
            style={{ width: `${value}%` }}
          />
        </div>
        <span className="text-xs font-medium tabular-nums w-8 text-right">
          {value}
        </span>
      </div>
    </li>
  )
}

function FeedbackButton({
  active,
  activeColor,
  onClick,
  icon,
  label,
}: {
  active: boolean
  activeColor: string
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex flex-col items-center justify-center gap-1 py-2 rounded-xl transition-all',
        active ? activeColor : 'hover:bg-muted text-muted-foreground',
      )}
    >
      {icon}
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  )
}

// ─── Empty result (wardrobe too sparse) ──────────────────────────────────────
function EmptyResult({
  message,
  wardrobeCount,
}: {
  message: string
  wardrobeCount: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="surface-card p-6 text-center"
    >
      <div className="w-12 h-12 rounded-2xl bg-amber-500/10 mx-auto mb-3 flex items-center justify-center">
        <AlertCircle className="w-6 h-6 text-amber-600" />
      </div>
      <p className="text-sm text-foreground mb-1.5">{message}</p>
      <p className="text-xs text-muted-foreground">
        Hozirda garderobingizda {wardrobeCount} ta kiyim bor.
      </p>
    </motion.div>
  )
}

// ─── Saved outfit row ─────────────────────────────────────────────────────────
function SavedOutfitRow({ outfit }: { outfit: SavedOutfit }) {
  return (
    <div className="surface-card p-3 flex items-center gap-3">
      <div className="flex gap-1">
        {outfit.items.slice(0, 3).map((it) => {
          const img = it.image
          return (
            <div
              key={it.id}
              className="w-10 h-10 rounded-md bg-muted overflow-hidden"
            >
              {img?.thumbnailUrl && (
                <img
                  src={img.thumbnailUrl}
                  alt=""
                  className="w-full h-full object-cover"
                />
              )}
            </div>
          )
        })}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">
          {outfit.name ?? (outfit.occasion ? OCCASIONS.find((o) => o.id === outfit.occasion)?.label ?? outfit.occasion : 'Outfit')}
        </p>
        <p className="text-xs text-muted-foreground">
          {new Date(outfit.createdAt).toLocaleDateString('uz')}
          {outfit.score != null && ` · ${outfit.score}%`}
        </p>
      </div>
      <Heart className="w-4 h-4 text-primary fill-current" />
    </div>
  )
}

// Avoid unused-import warnings — the symbols are referenced for clarity
void Calendar
