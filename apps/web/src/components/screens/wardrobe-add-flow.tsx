'use client'

import { useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft,
  Camera,
  ImagePlus,
  Check,
  Loader2,
  AlertCircle,
  Sparkle,
} from 'lucide-react'
import { routes } from '@/lib/routes'
import { useBackNavigation } from '@/hooks/use-back-navigation'
import { api, ApiError } from '@/lib/api-client'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type Phase = 'capture' | 'analyzing' | 'review'

interface Detection {
  category: string
  subcategory: string | null
  colors: string[]
  pattern: string | null
  material: string | null
  sleeveLength: string | null
  fit: string | null
  style: string | null
  season: string[]
  gender: string | null
  formality: string | null
  confidence: Record<string, number>
  mock: true
}

interface SavedItem {
  id: string
}

const ANALYSIS_STEPS = [
  { id: 'category', label: 'Kiyim turi' },
  { id: 'color', label: 'Rang' },
  { id: 'pattern', label: 'Naqsh' },
  { id: 'style', label: 'Uslub' },
  { id: 'season', label: 'Mavsum' },
] as const

export function WardrobeAddFlow() {
  const { toast } = useToast()
  // Back → previous in-app page, or /wardrobe when opened via deep link.
  const goBack = useBackNavigation(routes.wardrobe())
  const [phase, setPhase] = useState<Phase>('capture')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [detection, setDetection] = useState<Detection | null>(null)
  const [savedItemId, setSavedItemId] = useState<string | null>(null)
  const [activeStep, setActiveStep] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback(
    async (file: File) => {
      setError(null)
      setPhase('analyzing')
      setActiveStep(0)

      // Preview the image locally
      const url = URL.createObjectURL(file)
      setPreviewUrl(url)

      // Step through "Analyzing…" checklist — driven by actual elapsed time
      // of the upload + analysis request, not a fake delay. Spec section 19:
      // "Do not fake long processing animations."
      const stepInterval = setInterval(() => {
        setActiveStep((s) => Math.min(s + 1, ANALYSIS_STEPS.length - 1))
      }, 350)

      try {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('filename', file.name)

        const res = await api<{
          item: SavedItem
          detection: Detection
        }>('/api/v1/wardrobe/items', {
          method: 'POST',
          asForm: formData,
        })

        clearInterval(stepInterval)
        setActiveStep(ANALYSIS_STEPS.length - 1)

        // Brief delay so the user can see the final checkmark
        await new Promise((r) => setTimeout(r, 250))

        setDetection(res.detection)
        setSavedItemId(res.item.id)
        setPhase('review')
      } catch (err) {
        clearInterval(stepInterval)
        const msg =
          err instanceof ApiError ? err.message : 'Tahlil amalga oshmadi'
        setError(msg)
        setPhase('capture')
        setPreviewUrl(null)
      }
    },
    [],
  )

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    // Reset value so same file can be selected again
    e.target.value = ''
  }

  function cancel() {
    goBack()
  }

  function done() {
    // Back to the wardrobe — it reloads on mount so the new item appears
    goBack()
    toast({
      title: 'Saqlandi',
      description: 'Kiyim garderobingizga qo‘shildi',
    })
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <div className="px-5 pt-12 pb-3 flex items-center gap-3">
        <button
          onClick={cancel}
          className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-muted transition-colors"
          aria-label="Orqaga"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="display-md flex-1">Kiyim qo‘shish</h1>
      </div>

      <div className="flex-1 px-5 pb-6">
        <AnimatePresence mode="wait">
          {phase === 'capture' && (
            <CapturePhase
              key="capture"
              previewUrl={previewUrl}
              error={error}
              fileInputRef={fileInputRef}
              cameraInputRef={cameraInputRef}
            />
          )}
          {phase === 'analyzing' && (
            <AnalyzingPhase
              key="analyzing"
              previewUrl={previewUrl}
              activeStep={activeStep}
            />
          )}
          {phase === 'review' && detection && savedItemId && (
            <ReviewPhase
              key="review"
              detection={detection}
              itemId={savedItemId}
              previewUrl={previewUrl}
              onDone={done}
            />
          )}
        </AnimatePresence>
      </div>

      {/* Hidden file inputs — both regular picker + camera capture */}
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
        capture="environment"
        className="hidden"
        onChange={handleFileInput}
      />
    </div>
  )
}

function CapturePhase({
  previewUrl,
  error,
  fileInputRef,
  cameraInputRef,
}: {
  previewUrl: string | null
  error: string | null
  fileInputRef: React.RefObject<HTMLInputElement | null>
  cameraInputRef: React.RefObject<HTMLInputElement | null>
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.3 }}
    >
      <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
        Kiyimingizning rasmini oling yoki tanlang. AI uni avtomatik tahlil
        qiladi — qo‘lma-qo‘l forma to‘ldirish shart emas.
      </p>

      {error && (
        <div className="mb-4 surface-card p-3 border-destructive/30 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Dropzone / preview */}
      <div className="surface-card p-8 mb-4">
        <div className="aspect-[3/4] bg-muted rounded-xl overflow-hidden flex items-center justify-center mb-6">
          {previewUrl ? (
             
            <img src={previewUrl} alt="oldin ko'rish" className="w-full h-full object-cover" />
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

      {/* Demo note — mock vision honesty */}
      <div className="flex items-start gap-2 text-xs text-muted-foreground px-1">
        <Sparkle className="w-3.5 h-3.5 mt-0.5 text-primary shrink-0" />
        <p className="leading-relaxed">
          Bu versiyada rang aniqlash real piksellar asosida ishlaydi.
          Boshqa atributlar (kategoriya, material, uslub) — demo taxminlar,
          ulardan past ishonch bilan ko‘rsatiladi. Real AI ko‘rish moduli
          keyingi faza yoqiladi.
        </p>
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
      {/* Preview */}
      <div className="surface-card p-4 mb-5">
        <div className="aspect-[3/4] bg-muted rounded-xl overflow-hidden max-w-[220px] mx-auto relative">
          {previewUrl && (
             
            <img src={previewUrl} alt="" className="w-full h-full object-cover" />
          )}
          {/* Shimmer overlay */}
          <div className="absolute inset-0 bg-white/40 skeleton-shimmer" />
        </div>
      </div>

      <div className="surface-card p-5">
        <div className="flex items-center gap-2.5 mb-4">
          <Loader2 className="w-4 h-4 text-primary animate-spin" />
          <p className="font-medium">Tahlil qilinmoqda…</p>
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
        Bu jarayon o‘rtacha 2-4 soniya davom etadi
      </p>
    </motion.div>
  )
}

function ReviewPhase({
  detection,
  itemId,
  previewUrl,
  onDone,
}: {
  detection: Detection
  itemId: string
  previewUrl: string | null
  onDone: () => void
}) {
  // Pass `itemId` and detection so the user can override attributes inline.
  // For MVP we just acknowledge — full editing happens on the item detail
  // screen. This keeps the "add" flow extremely fast per spec section 7.
  void itemId
  void previewUrl

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Success state */}
      <div className="surface-card p-5 mb-4 text-center">
        <div className="w-12 h-12 rounded-full bg-success/10 mx-auto mb-3 flex items-center justify-center">
          <Check className="w-6 h-6 text-success" />
        </div>
        <p className="font-semibold text-foreground mb-1">Tahlil tayyor</p>
        <p className="text-sm text-muted-foreground">
          AI buni ko‘rdi — xohlasangiz tahrirlang
        </p>
      </div>

      <DetectionSummary detection={detection} />

      <div className="flex gap-2.5 mt-5">
        <Button variant="outline" className="flex-1 h-11" onClick={onDone}>
          Saqlash
        </Button>
        <Button className="flex-1 h-11" onClick={onDone}>
          Tasdiqlash
        </Button>
      </div>

      <p className="text-xs text-muted-foreground text-center mt-4 leading-relaxed px-2">
        Hech qanday majburiyat yo‘q. Batafsil tahrirlashni keyinroq
        garderob ekranida amalga oshirishingiz mumkin.
      </p>
    </motion.div>
  )
}

function DetectionSummary({ detection }: { detection: Detection }) {
  // Show what AI detected — color is high confidence (real pixel analysis);
  // other fields are demo estimates clearly marked as low-confidence.
  return (
    <div className="surface-card p-4">
      <h3 className="text-sm font-semibold mb-3">AI natijalari</h3>
      <dl className="space-y-2.5 text-sm">
        <DetectionRow label="Rang" value={detection.colors.join(', ')} confidence={detection.confidence.color} />
        <DetectionRow label="Kategoriya" value={detection.category} confidence={detection.confidence.category} />
        <DetectionRow label="Naqsh" value={detection.pattern ?? '—'} confidence={detection.confidence.pattern} />
        <DetectionRow label="Material" value={detection.material ?? '—'} confidence={detection.confidence.material} />
        <DetectionRow label="Uslub" value={detection.style ?? '—'} confidence={detection.confidence.style} />
        <DetectionRow label="Mavsum" value={detection.season.join(', ')} confidence={detection.confidence.season} />
      </dl>
    </div>
  )
}

function DetectionRow({
  label,
  value,
  confidence,
}: {
  label: string
  value: string
  confidence: number
}) {
  // Spec rule: "AI must never pretend certainty when confidence is low."
  // Show confidence explicitly so the user knows what to trust.
  const confidenceLabel =
    confidence >= 0.7 ? 'Yuqori ishonch' : confidence >= 0.4 ? "O'rta ishonch" : 'Past ishonch'
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <div className="text-right">
        <dd className="font-medium text-foreground">{value}</dd>
        <dd className="text-[10px] text-muted-foreground mt-0.5">
          {confidenceLabel} · {Math.round(confidence * 100)}%
        </dd>
      </div>
    </div>
  )
}
