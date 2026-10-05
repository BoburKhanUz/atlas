'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft,
  Check,
  Loader2,
  Pencil,
  Trash2,
  AlertCircle,
  History,
} from 'lucide-react'
import Link from 'next/link'
import { routes } from '@/lib/routes'
import { useBackNavigation } from '@/hooks/use-back-navigation'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { api, ApiError } from '@/lib/api-client'
import { useToast } from '@/hooks/use-toast'
import {
  CATEGORIES,
  SUBCATEGORIES,
  COLORS,
  PATTERNS,
  MATERIALS,
  STYLES,
  SLEEVE_LENGTHS,
  FITS,
  SEASONS,
  FORMALITIES,
  GENDERS,
  colorById,
  labelById,
} from '@/lib/ai/catalog'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

interface ItemImageData {
  id: string
  url: string
  thumbnailUrl: string | null
  isPrimary: boolean
}
interface WardrobeItemFull {
  id: string
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
  confidences: Record<string, number>
  wasCorrected: boolean
  correctionLog: Array<{ field: string; from: string; to: string; at: string }>
  images: ItemImageData[]
  createdAt: string
}

export function WardrobeItemDetail({ id }: { id: string }) {
  const { toast } = useToast()
  // Back → previous in-app page, or /wardrobe when opened via deep link.
  const goBack = useBackNavigation(routes.wardrobe())
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)

  const [item, setItem] = useState<WardrobeItemFull | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)

  async function load() {
    if (!id) return
    setLoading(true)
    try {
      const res = await api<{ item: WardrobeItemFull }>(
        `/api/v1/wardrobe/items/${id}`,
      )
      setItem(res.item)
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Yuklanmadi'
      toast({ title: 'Xato', description: msg, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
     
  }, [id])

  async function handlePatch(patch: Partial<WardrobeItemFull>) {
    if (!item) return
    setBusy(true)
    try {
      const res = await api<{
        item: WardrobeItemFull
        corrections: Array<{ field: string; from: string; to: string }>
      }>(`/api/v1/wardrobe/items/${item.id}`, {
        method: 'PATCH',
        body: patch,
      })
      setItem(res.item)
      if (res.corrections.length > 0) {
        toast({
          title: 'Yangilandi',
          description: `${res.corrections.length} ta o‘zgarish saqlandi`,
        })
      }
      setEditing(false)
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Saqlanmadi'
      toast({ title: 'Xato', description: msg, variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(): Promise<boolean> {
    if (!item) return true
    try {
      await api(`/api/v1/wardrobe/items/${item.id}`, { method: 'DELETE' })
      toast({ title: "O'chirildi" })
      goBack()
      return true
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "O'chirib bo'lmadi"
      toast({ title: 'Xato', description: msg, variant: 'destructive' })
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

  if (!item) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
        <AlertCircle className="w-8 h-8 text-muted-foreground mb-3" />
        <p className="text-muted-foreground mb-4">Kiyim topilmadi</p>
        <Button asChild variant="outline">
          <Link href={routes.wardrobe()}>Garderobga qaytish</Link>
        </Button>
      </div>
    )
  }

  const primaryImage = item.images.find((img) => img.isPrimary) ?? item.images[0]
  const imageUrl = primaryImage?.url

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <div className="px-5 pt-12 pb-3 flex items-center gap-3">
        <button
          onClick={goBack}
          className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-muted transition-colors"
          aria-label="Orqaga"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="display-md flex-1 truncate">
          {labelById(CATEGORIES, item.category) ?? item.category}
        </h1>
        <button
          onClick={() => setEditing(true)}
          className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-muted transition-colors"
          aria-label="Tahrirlash"
        >
          <Pencil className="w-4 h-4" />
        </button>
        <button
          onClick={() => setConfirmDeleteOpen(true)}
          className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-destructive/10 text-destructive transition-colors"
          aria-label="O'chirish"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <div className="px-5 pb-6 flex-1">
        {/* Hero image */}
        <div className="surface-card overflow-hidden mb-5">
          <div className="aspect-[3/4] bg-muted">
            {imageUrl ? (
               
              <img
                src={imageUrl}
                alt={item.category}
                className="w-full h-full object-cover"
              />
            ) : null}
          </div>
        </div>

        {/* AI-detected attributes summary */}
        <div className="surface-card p-5 mb-4">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="font-semibold">AI natijalari</h2>
            {item.wasCorrected && (
              <span className="text-[10px] text-primary font-medium bg-primary/8 px-2 py-0.5 rounded-full">
                Tahrir qilingan
              </span>
            )}
          </div>
          <dl className="space-y-3 text-sm">
            <DetailRow label="Kategoriya" value={labelById(CATEGORIES, item.category) ?? item.category} confidence={item.confidences.category} />
            <DetailRow label="Subkategoriya" value={labelById(SUBCATEGORIES[item.category] ?? [], item.subcategory) ?? item.subcategory ?? '—'} confidence={item.confidences.subcategory} />
            <DetailRow label="Ranglar" value={item.colors.map((c) => labelById(COLORS, c) ?? c).join(', ')} confidence={item.confidences.color} />
            <DetailRow label="Naqsh" value={labelById(PATTERNS, item.pattern) ?? '—'} confidence={item.confidences.pattern} />
            <DetailRow label="Material" value={labelById(MATERIALS, item.material) ?? '—'} confidence={item.confidences.material} />
            <DetailRow label="Uslub" value={labelById(STYLES, item.style) ?? '—'} confidence={item.confidences.style} />
            <DetailRow label="Mavsum" value={item.season.map((s) => labelById(SEASONS, s) ?? s).join(', ')} confidence={item.confidences.season} />
            <DetailRow label="Yeng uzunligi" value={labelById(SLEEVE_LENGTHS, item.sleeveLength) ?? '—'} confidence={item.confidences.sleeveLength} />
            <DetailRow label="Kesim" value={labelById(FITS, item.fit) ?? '—'} confidence={item.confidences.fit} />
            <DetailRow label="Formallik" value={labelById(FORMALITIES, item.formality) ?? '—'} confidence={item.confidences.formality} />
            <DetailRow label="Jins" value={labelById(GENDERS, item.gender) ?? '—'} confidence={item.confidences.gender} />
          </dl>
        </div>

        {/* Color swatches */}
        {item.colors.length > 0 && (
          <div className="surface-card p-5 mb-4">
            <h2 className="font-semibold mb-3">Ranglar</h2>
            <div className="flex gap-2 flex-wrap">
              {item.colors.map((c) => {
                const color = colorById(c)
                return (
                  <div
                    key={c}
                    className="flex items-center gap-2 surface-card px-3 py-1.5"
                  >
                    <span
                      className="inline-block w-4 h-4 rounded-full border border-black/10"
                      style={{ backgroundColor: color?.hex ?? '#999' }}
                    />
                    <span className="text-xs font-medium">
                      {color?.label ?? c}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Correction log — visible if user has overridden AI (spec section 6) */}
        {item.correctionLog.length > 0 && (
          <div className="surface-card p-5">
            <div className="flex items-center gap-2 mb-3">
              <History className="w-4 h-4 text-muted-foreground" />
              <h2 className="font-semibold text-sm">Tahrir tarixi</h2>
            </div>
            <ul className="space-y-2 text-xs">
              {item.correctionLog.map((entry, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-muted-foreground shrink-0">
                    {new Date(entry.at).toLocaleDateString('uz')}
                  </span>
                  <span className="text-muted-foreground shrink-0">·</span>
                  <span className="flex-1">
                    <span className="font-medium">{entry.field}:</span>{' '}
                    <span className="line-through text-muted-foreground">{entry.from}</span>{' '}
                    →{' '}
                    <span className="text-primary font-medium">{entry.to}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
              Sizning tahrirlaringiz saqlanadi va kelajakdagi tavsiyalar
              sifatini yaxshilash uchun ishlatiladi — global modelni
              qayta o‘rgatmaydi.
            </p>
          </div>
        )}
      </div>

      {/* Edit modal */}
      <AnimatePresence>
        {editing && (
          <EditModal
            item={item}
            busy={busy}
            onClose={() => setEditing(false)}
            onSave={handlePatch}
          />
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title="Kiyimni o'chirish"
        description="Bu kiyimni o'chirib tashlaysizmi? Bu amalni qaytarib bo'lmaydi."
        confirmLabel="O'chirish"
        onConfirm={handleDelete}
      />
    </div>
  )
}

function DetailRow({
  label,
  value,
  confidence,
}: {
  label: string
  value: string
  confidence: number
}) {
  const tag =
    confidence >= 0.7
      ? { text: 'Yuqori', cls: 'text-success' }
      : confidence >= 0.4
        ? { text: "O'rta", cls: 'text-muted-foreground' }
        : { text: 'Past', cls: 'text-amber-600' }
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <div className="flex items-baseline gap-2">
        <dd className="font-medium text-foreground text-right">{value}</dd>
        <dd className={cn('text-[10px] font-medium', tag.cls)}>{tag.text}</dd>
      </div>
    </div>
  )
}

function EditModal({
  item,
  busy,
  onClose,
  onSave,
}: {
  item: WardrobeItemFull
  busy: boolean
  onClose: () => void
  onSave: (patch: Partial<WardrobeItemFull>) => void
}) {
  // Local form state — initialized from item, sent on save
  const [category, setCategory] = useState(item.category)
  const [subcategory, setSubcategory] = useState(item.subcategory ?? '__none__')
  const [pattern, setPattern] = useState(item.pattern ?? '__none__')
  const [material, setMaterial] = useState(item.material ?? '__none__')
  const [style, setStyle] = useState(item.style ?? '__none__')
  const [fit, setFit] = useState(item.fit ?? '__none__')
  const [formality, setFormality] = useState(item.formality ?? '__none__')
  const [season, setSeason] = useState<string[]>(item.season)
  const [colors, setColors] = useState<string[]>(item.colors)

  function toggleArr(arr: string[], v: string): string[] {
    return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]
  }

  function submit() {
    const patch: Record<string, unknown> = {
      category,
      subcategory: subcategory === '__none__' ? null : subcategory,
      pattern: pattern === '__none__' ? null : pattern,
      material: material === '__none__' ? null : material,
      style: style === '__none__' ? null : style,
      fit: fit === '__none__' ? null : fit,
      formality: formality === '__none__' ? null : formality,
      season,
      colors,
    }
    onSave(patch as Partial<WardrobeItemFull>)
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: '100%', opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: '100%', opacity: 0 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl max-h-[92vh] overflow-y-auto"
      >
        <div className="sticky top-0 bg-white px-5 pt-6 pb-4 border-b">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-lg">Tahrirlash</h2>
            <button onClick={onClose} className="text-muted-foreground text-sm">
              Bekor
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            AI xatosini tuzating — o‘zgarishlar sizning kelajak
            tavsiyalaringizni yaxshilaydi
          </p>
        </div>

        <div className="p-5 space-y-5">
          {/* Category */}
          <EditField label="Kategoriya">
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </EditField>

          {/* Subcategory — depends on category */}
          <EditField label="Subkategoriya">
            <Select value={subcategory} onValueChange={setSubcategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Tanlanmagan —</SelectItem>
                {(SUBCATEGORIES[category] ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </EditField>

          {/* Colors — multi-select chips */}
          <EditField label="Ranglar">
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => {
                const active = colors.includes(c.id)
                // The API accepts at most 5 colours per item.
                const atLimit = !active && colors.length >= 5
                return (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={active}
                    disabled={atLimit}
                    onClick={() => setColors((prev) => toggleArr(prev, c.id))}
                    className={cn(
                      'flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-xs transition-all disabled:opacity-40',
                      active
                        ? 'border-primary bg-primary/5 text-foreground'
                        : 'border-border text-muted-foreground hover:border-foreground/30',
                    )}
                  >
                    <span
                      className="w-3 h-3 rounded-full border border-black/10"
                      style={{ backgroundColor: c.hex }}
                    />
                    {c.label}
                  </button>
                )
              })}
            </div>
          </EditField>

          {/* Pattern */}
          <EditField label="Naqsh">
            <Select value={pattern} onValueChange={setPattern}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Tanlanmagan —</SelectItem>
                {PATTERNS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </EditField>

          {/* Material */}
          <EditField label="Material">
            <Select value={material} onValueChange={setMaterial}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Tanlanmagan —</SelectItem>
                {MATERIALS.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </EditField>

          {/* Style */}
          <EditField label="Uslub">
            <Select value={style} onValueChange={setStyle}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Tanlanmagan —</SelectItem>
                {STYLES.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </EditField>

          {/* Fit */}
          <EditField label="Kesim">
            <Select value={fit} onValueChange={setFit}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Tanlanmagan —</SelectItem>
                {FITS.map((f) => (
                  <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </EditField>

          {/* Formality */}
          <EditField label="Formallik">
            <Select value={formality} onValueChange={setFormality}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Tanlanmagan —</SelectItem>
                {FORMALITIES.map((f) => (
                  <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </EditField>

          {/* Season — multi-select */}
          <EditField label="Mavsum">
            <div className="flex flex-wrap gap-2">
              {SEASONS.map((s) => {
                const active = season.includes(s.id)
                return (
                  <button
                    key={s.id}
                    onClick={() => setSeason((prev) => toggleArr(prev, s.id))}
                    className={cn(
                      'px-3 py-1.5 rounded-full border text-xs transition-all',
                      active
                        ? 'border-primary bg-primary/5 text-foreground'
                        : 'border-border text-muted-foreground hover:border-foreground/30',
                    )}
                  >
                    {s.label}
                  </button>
                )
              })}
            </div>
          </EditField>
        </div>

        <div className="sticky bottom-0 bg-white border-t p-4 flex gap-2.5">
          <Button variant="outline" className="flex-1 h-11" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button className="flex-1 h-11" onClick={submit} disabled={busy}>
            {busy ? (
              <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
            ) : (
              <Check className="w-4 h-4 mr-1.5" />
            )}
            Saqlash
          </Button>
        </div>
      </motion.div>
    </motion.div>
  )
}

function EditField({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  )
}
