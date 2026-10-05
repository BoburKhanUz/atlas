/**
 * User Memory module — spec section 14, 6.
 *
 * Provides:
 *   - extractMemoriesFromMessage: detect stated preferences / corrections in
 *     a user's chat message (e.g. "men qizil rangni yoqtirmayman" →
 *     disliked_color:red). Uses regex patterns + keyword lists.
 *   - saveMemories: persist extracted facts to the AiMemory table.
 *   - loadMemoriesForContext: pull the most relevant memories for the
 *     stylist system prompt (preferred styles + colors + corrections).
 *
 * All memories are user-scoped — they bias future inferences for THAT user
 * only, never retraining a global model. Spec rule 6: "Store corrections as
 * user preferences/metadata and use them to improve future inference for
 * that user."
 */

import { db } from '@/lib/db'

export type MemoryKind = 'preference' | 'correction' | 'feedback' | 'fact'

export interface ExtractedMemory {
  kind: MemoryKind
  key: string // e.g. "disliked_color", "preferred_style", "correction"
  value: string
}

// ─── Pattern-based extraction ───────────────────────────────────────────────
// We use Uzbek + English keyword patterns since the spec mandates Uzbek
// primary, but the LLM may sometimes translate back to Russian/English in
// the user's input.

const COLOR_WORDS = [
  'oq', 'qora', 'bej', 'kulrang', 'ko\'k', 'navy', 'yashil', 'olivin',
  'xaki', 'jigarron', 'tan', 'qizil', 'bordo', 'pushti', 'sariq',
  'to\'q sariq', 'binafsha', 'krem', 'zang', 'xantal', 'och ko\'k',
  'dolchin',
]

const STYLE_WORDS = [
  'casual', 'smart-casual', 'smart_casual', 'formal', 'sport', 'bohemian',
  'minimal', 'streetwear', 'klassik', 'preppi',
]

interface Pattern {
  kind: MemoryKind
  key: string
  regex: RegExp
  values: string[]
}

const PATTERNS: Pattern[] = [
  // "qizil rangni yoqtiraman/yaxshi ko'raman"
  {
    kind: 'preference',
    key: 'favorite_color',
    regex:
      /(yoqtir\w*|yaxshi ko\'r\w*|sev\w*|afzal)\w*(.*?)(rang|ko\'l)/i,
    values: COLOR_WORDS,
  },
  // "qizil rangni yoqtirmayman"
  {
    kind: 'preference',
    key: 'disliked_color',
    regex:
      /(yoqtirm\w*|yomon ko\'r\w*|sevm\w*)\w*(.*?)(rang|ko\'l)/i,
    values: COLOR_WORDS,
  },
  // "minimal uslubni yoqtiraman"
  {
    kind: 'preference',
    key: 'preferred_style',
    regex:
      /(yoqtir\w*|yaxshi ko\'r\w*|sev\w*|afzal)\w*(.*?)(uslub|stil|tarz)/i,
    values: STYLE_WORDS,
  },
  // "minimal uslubni yoqtirmayman"
  {
    kind: 'preference',
    key: 'disliked_style',
    regex:
      /(yoqtirm\w*|yomon ko\'r\w*|sevm\w*)\w*(.*?)(uslub|stil|tarz)/i,
    values: STYLE_WORDS,
  },
]

/**
 * Scan a user message and extract memory-worthy facts. Conservative — only
 * extracts when a value from the known list appears in the message AND a
 * preference/statement verb is also present.
 */
export function extractMemoriesFromMessage(message: string): ExtractedMemory[] {
  const lower = message.toLowerCase()
  const found: ExtractedMemory[] = []
  for (const p of PATTERNS) {
    const match = lower.match(p.regex)
    if (!match) continue
    // The match groups are too loose — we just check the whole sentence
    for (const value of p.values) {
      if (lower.includes(value)) {
        // Avoid duplicates within one message
        if (!found.some((f) => f.key === p.key && f.value === value)) {
          found.push({ kind: p.kind, key: p.key, value })
        }
      }
    }
  }
  return found
}

/**
 * Persist extracted memories for the user. Skips exact duplicates.
 * Spec rule 6: corrections/preferences are stored per user, not retraining
 * a global model.
 */
export async function saveMemories(
  userId: string,
  memories: ExtractedMemory[],
): Promise<void> {
  if (memories.length === 0) return

  // Look up the user's preferences row (for the optional FK)
  const prefs = await db.userPreferences.findUnique({ where: { userId } })

  for (const m of memories) {
    // Check if an identical memory already exists (same kind+key+value+user)
    const existing = await db.aiMemory.findFirst({
      where: { userId, kind: m.kind, key: m.key, value: m.value },
    })
    if (existing) continue
    await db.aiMemory.create({
      data: {
        userId,
        kind: m.kind,
        key: m.key,
        value: m.value,
        preferencesId: prefs?.id ?? null,
      },
    })
  }
}

/**
 * Load memories for the stylist context. Returns the most relevant recent
 * memories — preferred colors/styles + disliked + corrections.
 *
 * Limit is conservative (max 12 entries) to stay within LLM token budget.
 */
export async function loadMemoriesForContext(
  userId: string,
  limit = 12,
): Promise<ExtractedMemory[]> {
  const rows = await db.aiMemory.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })

  // Group by key — for each key, take the most recent value (a user's latest
  // preference overrides earlier ones, but we keep all distinct values
  // because preferences can be multiple e.g. favoriteColor can be ["red","blue"]).
  const byKey = new Map<string, Set<string>>()
  for (const r of rows) {
    const set = byKey.get(r.key) ?? new Set<string>()
    set.add(r.value)
    byKey.set(r.key, set)
  }

  // Build the output — most recent keys first, deduped values
  const out: ExtractedMemory[] = []
  const keyPriority = [
    'preferred_style',
    'disliked_style',
    'favorite_color',
    'disliked_color',
    'preferred_fit',
    'correction',
    'feedback',
    'fact',
  ]
  for (const key of keyPriority) {
    const values = byKey.get(key)
    if (!values) continue
    for (const value of values) {
      if (out.length >= limit) break
      out.push({
        kind:
          key.startsWith('correction') ? 'correction' :
          key.startsWith('feedback') ? 'feedback' :
          key.startsWith('preferred') || key.startsWith('favorite') || key.startsWith('disliked') ? 'preference' :
          'fact',
        key,
        value,
      })
    }
    if (out.length >= limit) break
  }

  return out
}

/**
 * Format memories as a compact system-prompt context block.
 */
export function formatMemoryContext(memories: ExtractedMemory[]): string {
  if (memories.length === 0) return ''
  const grouped: Record<string, string[]> = {}
  for (const m of memories) {
    ;(grouped[m.key] ??= []).push(m.value)
  }
  const lines = ['=== FOYDALANUVCHI XOTIRASI ===']
  const labels: Record<string, string> = {
    preferred_style: 'Yoqtirgan uslubi',
    disliked_style: 'Yoqtirmaydigan uslubi',
    favorite_color: 'Sevimli ranglari',
    disliked_color: 'Yoqtirmaydigan ranglari',
    preferred_fit: 'Afzallikdagi kesim',
    correction: 'Tahrir',
    feedback: 'Fikr',
    fact: 'Fact',
  }
  for (const [key, values] of Object.entries(grouped)) {
    const label = labels[key] ?? key
    lines.push(`${label}: ${values.join(', ')}`)
  }
  return lines.join('\n')
}
