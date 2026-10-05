'use client'

import { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Loader2, Shirt, MoreVertical, Trash2, Pencil } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { routes } from '@/lib/routes'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { api, ApiError } from '@/lib/api-client'
import {
  WARDROBE_TABS,
  colorById,
  labelById,
  CATEGORIES,
  STYLES,
} from '@/lib/ai/catalog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

interface WardrobeImage {
  id: string
  url: string
  thumbnailUrl: string | null
  isPrimary: boolean
}
interface WardrobeItem {
  id: string
  category: string
  subcategory: string | null
  colors: string[]
  pattern: string | null
  material: string | null
  style: string | null
  season: string[]
  formality: string | null
  confidences: Record<string, number>
  wasCorrected: boolean
  images: WardrobeImage[]
  primaryImage: WardrobeImage | null
  createdAt: string
}

export function WardrobeScreen() {
  const { toast } = useToast()
  const router = useRouter()
  const [items, setItems] = useState<WardrobeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<string>('all')
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api<{ items: WardrobeItem[] }>(
        `/api/v1/wardrobe/items${activeTab !== 'all' ? `?category=${activeTab}` : ''}`,
      )
      setItems(res.items)
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Garderob yuklanmadi'
      toast({ title: 'Xato', description: msg, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [activeTab, toast])

  useEffect(() => {
    load()
  }, [load])

  async function handleDelete(id: string): Promise<boolean> {
    try {
      await api(`/api/v1/wardrobe/items/${id}`, { method: 'DELETE' })
      setItems((prev) => prev.filter((i) => i.id !== id))
      toast({ title: "O'chirildi", description: "Kiyim garderobdan o'chirildi" })
      return true
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "O'chirib bo'lmadi"
      toast({ title: 'Xato', description: msg, variant: 'destructive' })
      return false
    }
  }

  return (
    <div className="px-5 pt-12 pb-6">
      {/* Header */}
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="display-lg">Garderob</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {items.length > 0 ? `${items.length} ta kiyim` : 'Hozircha bo‘sh'}
          </p>
        </div>
        <Button asChild size="sm" className="h-10 px-4">
          <Link href={routes.wardrobeNew()}>
            <Plus className="w-4 h-4 mr-1.5" />
            Kiyim qo‘shish
          </Link>
        </Button>
      </div>

      {/* Category tabs — horizontal scroll, spec section 18 */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2 mb-5 -mx-5 px-5 md:flex-wrap md:overflow-visible">
        {WARDROBE_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'shrink-0 text-sm font-medium px-3.5 py-2 rounded-full transition-all',
              activeTab === tab.id
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Item grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 text-muted-foreground animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <EmptyWardrobe />
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
          {items.map((item) => (
            <WardrobeCard
              key={item.id}
              item={item}
              href={routes.wardrobeItem(item.id)}
              onOpen={() => {
                setMenuOpenId(null)
                router.push(routes.wardrobeItem(item.id))
              }}
              menuOpen={menuOpenId === item.id}
              onMenuToggle={() =>
                setMenuOpenId(menuOpenId === item.id ? null : item.id)
              }
              onDelete={() => {
                setMenuOpenId(null)
                setPendingDeleteId(item.id)
              }}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={pendingDeleteId !== null}
        onOpenChange={(o) => !o && setPendingDeleteId(null)}
        title="Kiyimni o'chirish"
        description="Bu kiyimni o'chirib tashlaysizmi? Bu amalni qaytarib bo'lmaydi."
        confirmLabel="O'chirish"
        onConfirm={() => (pendingDeleteId ? handleDelete(pendingDeleteId) : true)}
      />
    </div>
  )
}

function WardrobeCard({
  item,
  href,
  onOpen,
  menuOpen,
  onMenuToggle,
  onDelete,
}: {
  item: WardrobeItem
  href: string
  onOpen: () => void
  menuOpen: boolean
  onMenuToggle: () => void
  onDelete: () => void
}) {
  const imageUrl = item.primaryImage?.thumbnailUrl ?? item.primaryImage?.url
  const color = item.colors[0] ? colorById(item.colors[0]) : null
  const categoryLabel = labelById(CATEGORIES, item.category)

  return (
    <div className="surface-card overflow-hidden relative">
      <Link
        href={href}
        className="block w-full aspect-[3/4] bg-muted relative overflow-hidden"
      >
        {imageUrl ? (
           
          <img
            src={imageUrl}
            alt={categoryLabel ?? 'kiyim'}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Shirt className="w-8 h-8 text-muted-foreground" />
          </div>
        )}
        {/* "Corrected" badge if user has overridden AI */}
        {item.wasCorrected && (
          <div className="absolute top-2 left-2 bg-black/80 text-white text-[10px] px-1.5 py-0.5 rounded-md backdrop-blur-sm">
            Tahrir qilingan
          </div>
        )}
      </Link>

      <div className="p-3">
        <div className="flex items-start justify-between gap-1">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground truncate">
              {categoryLabel ?? item.category}
            </p>
            <div className="flex items-center gap-1.5 mt-1.5">
              {color && (
                <span
                  className="inline-block w-3 h-3 rounded-full border border-black/10"
                  style={{ backgroundColor: color.hex }}
                  title={color.label}
                />
              )}
              <span className="text-xs text-muted-foreground truncate">
                {labelById(STYLES, item.style) ?? '—'}
              </span>
            </div>
          </div>

          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation()
                onMenuToggle()
              }}
              className="p-1 -m-1 text-muted-foreground hover:text-foreground"
              aria-label="Ko‘proq"
            >
              <MoreVertical className="w-4 h-4" />
            </button>
            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -4, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.96 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-6 z-10 surface-card p-1 min-w-[140px] shadow-lg"
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onMenuToggle()
                      onOpen()
                    }}
                    className="w-full text-left text-sm px-2.5 py-2 rounded-md hover:bg-muted flex items-center gap-2"
                  >
                    <Pencil className="w-3.5 h-3.5" /> Tahrirlash
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onDelete()
                    }}
                    className="w-full text-left text-sm px-2.5 py-2 rounded-md hover:bg-destructive/5 text-destructive flex items-center gap-2"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> O'chirish
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  )
}

function EmptyWardrobe() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="surface-card p-8 text-center mt-4"
    >
      <div className="w-14 h-14 rounded-2xl bg-muted mx-auto mb-4 flex items-center justify-center">
        <Shirt className="w-7 h-7 text-muted-foreground" />
      </div>
      <h3 className="font-semibold text-foreground mb-1.5">Garderobingiz bo‘sh</h3>
      <p className="text-sm text-muted-foreground leading-relaxed mb-5 max-w-xs mx-auto">
        Kiyimingizning rasmini oling — AI uni avtomatik tahlil qiladi va
        garderobingizga qo‘shadi. Bir nechta kiyim qo‘shib, AI stilistdan
        outfit so‘rang.
      </p>
      <Button asChild className="h-11 px-5">
        <Link href={routes.wardrobeNew()}>
          <Plus className="w-4 h-4 mr-1.5" />
          Birinchi kiyimni qo‘shish
        </Link>
      </Button>
    </motion.div>
  )
}
