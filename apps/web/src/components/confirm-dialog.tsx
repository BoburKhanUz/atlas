'use client'

import { useEffect, useId, useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Accessible replacement for window.confirm() built on the shadcn AlertDialog.
 * Stays open (with a spinner) while `onConfirm` runs; closes on success.
 * Pass `confirmWord` to require the user to type it before confirming.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Bekor qilish',
  destructive = true,
  confirmWord,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: React.ReactNode
  confirmLabel: string
  cancelLabel?: string
  destructive?: boolean
  confirmWord?: string
  onConfirm: () => Promise<boolean | void> | boolean | void
}) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const inputId = useId()

  useEffect(() => {
    if (!open) setTyped('')
  }, [open])

  const wordOk = !confirmWord || typed.trim().toUpperCase() === confirmWord.toUpperCase()

  async function handleConfirm(e: React.MouseEvent) {
    e.preventDefault() // keep the dialog open until the action resolves
    if (!wordOk || busy) return
    setBusy(true)
    try {
      const result = await onConfirm()
      if (result !== false) onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="text-muted-foreground text-sm leading-relaxed">{description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        {confirmWord && (
          <div className="space-y-2">
            <Label htmlFor={inputId} className="text-sm">
              Tasdiqlash uchun <span className="font-mono font-semibold">{confirmWord}</span> deb yozing
            </Label>
            <Input
              id={inputId}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="h-11"
              disabled={busy}
            />
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={!wordOk || busy}
            className={cn(destructive && buttonVariants({ variant: 'destructive' }))}
          >
            {busy && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
