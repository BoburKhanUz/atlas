'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, Loader2, Sparkle, X } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { api, ApiError } from '@/lib/api-client'
import { useToast } from '@/hooks/use-toast'
import { OCCASIONS } from '@/lib/ai/catalog'
import { cn } from '@/lib/utils'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface ChatResponse {
  conversationId: string
  assistantMessage: string
  contextSummary: {
    wardrobeItemCount: number
    weatherProvided: boolean
    eventProvided: boolean
  }
}

const QUICK_PROMPTS = [
  'Bugun nima kiyaman?',
  "Ertaga ishga nima kiyganim yaxshi?",
  "To'yga boraman.",
  'Bugun juda issiq.',
  'Shu ko‘ylagim bilan nima kiysam bo‘ladi?',
]

export function StylistScreen() {
  const { toast } = useToast()
  const searchParams = useSearchParams()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [hasContextBadge, setHasContextBadge] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Pre-fill event context if arrived from Home quick action
  const eventFromParam = searchParams.get('event')
  useEffect(() => {
    if (eventFromParam) {
      setHasContextBadge(true)
      // Don't auto-send — let user start the conversation naturally
    }
  }, [eventFromParam])

  // Empty-state greeting message — feels like the stylist is waiting for you
  useEffect(() => {
    if (messages.length === 0) {
      setMessages([
        {
          role: 'assistant',
          content:
            "Salom! Men sizning shaxsiy AI stilistingizman. Garderobingizdagi kiyimlardan mos outfit tavsiya qilaman. Nima so'rashingizni bilmoqchiman?",
        },
      ])
    }
  }, [messages.length])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, busy])

  async function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || busy) return

    setBusy(true)
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: trimmed }])

    try {
      // Build a context object — if the user landed here from a quick action,
      // pass that occasion. Future: also pass weather if user has granted it.
      const eventLabel =
        eventFromParam && hasContextBadge
          ? OCCASIONS.find((o) => o.id === eventFromParam)?.label ?? eventFromParam
          : undefined

      const res = await api<ChatResponse>('/api/v1/stylist/chat', {
        method: 'POST',
        body: {
          message: trimmed,
          conversationId,
          event: eventLabel,
          weather: null,
        },
      })
      setConversationId(res.conversationId)
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: res.assistantMessage },
      ])
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'AI javob bera olmadi'
      toast({ title: 'Xato', description: msg, variant: 'destructive' })
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content:
            'Kechirasiz, texnik nosozlik yuz berdi. Iltimos, birozdan keyin qayta urinib ko‘ring.',
        },
      ])
    } finally {
      setBusy(false)
    }
  }

  return (
    // Mobile: leave room for the floating bottom nav (shell adds pb-24).
    <div className="flex flex-col h-[calc(100dvh-6rem)] md:h-[calc(100dvh-2rem)]">
      {/* Header */}
      <div className="px-5 pt-12 pb-3 border-b bg-background">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
            <Sparkle className="w-4 h-4 text-primary" />
          </div>
          <div className="flex-1">
            <h1 className="font-semibold leading-tight">AI Stilist</h1>
            <p className="text-xs text-muted-foreground">
              Garderobingizdan outfit tavsiya qiladi
            </p>
          </div>
        </div>
        {/* Context badge if user came from a quick action */}
        {hasContextBadge && eventFromParam && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Kontekst:</span>
            <span className="inline-flex items-center gap-1.5 text-xs font-medium bg-primary/8 text-primary px-2.5 py-1 rounded-full">
              {OCCASIONS.find((o) => o.id === eventFromParam)?.label ?? eventFromParam}
              <button onClick={() => setHasContextBadge(false)}>
                <X className="w-3 h-3" />
              </button>
            </span>
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {messages.map((msg, i) => (
          <ChatBubble key={i} role={msg.role} content={msg.content} />
        ))}

        {/* Typing indicator while AI thinks */}
        <AnimatePresence>
          {busy && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="flex gap-2"
            >
              <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <Sparkle className="w-3.5 h-3.5 text-primary" />
              </div>
              <div className="bg-muted rounded-2xl rounded-tl-md px-3.5 py-2.5">
                <div className="flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-pulse"
                      style={{ animationDelay: `${i * 150}ms` }}
                    />
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div ref={messagesEndRef} />

        {/* Quick prompts when conversation just started */}
        {messages.length <= 1 && !busy && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="mt-4"
          >
            <p className="text-xs text-muted-foreground mb-2.5">
              Tezkor savollar
            </p>
            <div className="flex flex-col gap-2">
              {QUICK_PROMPTS.map((p) => (
                <button
                  key={p}
                  onClick={() => send(p)}
                  className="surface-card px-3.5 py-2.5 text-sm text-left hover:border-primary/30 transition-colors"
                >
                  {p}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </div>

      {/* Input */}
      <div className="px-5 py-3 border-t bg-background">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            send(input)
          }}
          className="flex items-end gap-2"
        >
          <div className="flex-1 surface-card flex items-end gap-2 px-3 py-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send(input)
                }
              }}
              rows={1}
              placeholder=" Stilistingizdan so'rang…"
              className="flex-1 resize-none bg-transparent outline-none text-sm leading-relaxed max-h-24 placeholder:text-muted-foreground"
              style={{ minHeight: '24px' }}
            />
          </div>
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className={cn(
              'w-10 h-10 rounded-full flex items-center justify-center transition-all shrink-0',
              busy || !input.trim()
                ? 'bg-muted text-muted-foreground'
                : 'bg-primary text-primary-foreground hover:opacity-90',
            )}
            aria-label="Yuborish"
          >
            {busy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </form>
      </div>
    </div>
  )
}

function ChatBubble({
  role,
  content,
}: {
  role: 'user' | 'assistant'
  content: string
}) {
  const isUser = role === 'user'
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={cn('flex gap-2', isUser && 'flex-row-reverse')}
    >
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <Sparkle className="w-3.5 h-3.5 text-primary" />
        </div>
      )}
      <div
        className={cn(
          'max-w-[80%] px-3.5 py-2.5 text-sm leading-relaxed',
          isUser
            ? 'bg-primary text-primary-foreground rounded-2xl rounded-tr-md'
            : 'bg-muted text-foreground rounded-2xl rounded-tl-md',
        )}
      >
        {content}
      </div>
    </motion.div>
  )
}
