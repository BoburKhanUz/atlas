/**
 * Stylist system prompt + chat helper (spec section 13, 20).
 *
 * The stylist must:
 *   - Speak natural Uzbek.
 *   - Be intelligent, friendly, concise, non-judgmental.
 *   - Use the user's ACTUAL wardrobe (provided as context) — never invent
 *     items the user doesn't own.
 *   - Be honest when no good combination exists.
 *   - Reference real weather + event context.
 */

import { generateText } from './client'
import type { LLMMessage } from './providers/types'

interface WardrobeSummary {
  category: string
  subcategory: string | null
  colors: string[]
  style: string | null
  material: string | null
  season: string[]
  /** Stable reference id the LLM can quote back (short, opaque). */
  ref: string
}

export interface StylistContext {
  /** Compact wardrobe summary — what the user actually owns. */
  wardrobe: WardrobeSummary[]
  /** Optional weather snapshot (spec section 11) — JSON object. */
  weather?: {
    temperature?: number
    feelsLike?: number
    condition?: string
    precipitationProbability?: number
    humidity?: number
    windSpeed?: number
    uvIndex?: number
  }
  /** Optional event / occasion the user mentioned. */
  event?: string
  /** User profile hints (all optional). */
  profile?: {
    gender?: string | null
    preferredStyles?: string[]
    dislikedStyles?: string[]
    favoriteColors?: string[]
    dislikedColors?: string[]
    language?: string
  }
}

export interface StylistTurnResult {
  assistantMessage: string
  provider: string
  /** What context was actually sent to the LLM — for debugging + UI display. */
  contextSummary: {
    wardrobeItemCount: number
    weatherProvided: boolean
    eventProvided: boolean
  }
}

function buildSystemPrompt(ctx: StylistContext): string {
  const lines: string[] = [
    'Siz shaxsiy AI stilistsiz. Tabiiy o‘zbek tilida javob bering.',
    'Faqat foydalanuvchining HAQIQIY GARDEROBIDAGI kiyimlardan outfit tavsiya qiling — boshqa kiyimni o‘ylab topmang.',
    'Qisqa javob bering (2-4 jumla, emoji ortiqcha emas).',
    'Tavsiya qilganingizda [Ax] refdan foydalaning.',
    'Agar garderob mos kiyim topilmasa, rost ayting va eng yaqin variantni ko‘rsating.',
    '',
    '=== FOYDALANUVCHI GARDEROBI ===',
  ]

  if (ctx.wardrobe.length === 0) {
    lines.push('Garderob bo\'sh. Kiyim tavsiya qilmang — foydalanuvchidan avval garderobga kiyim qo\'shishni so\'rang.')
  } else {
    const byCat: Record<string, WardrobeSummary[]> = {}
    for (const item of ctx.wardrobe) {
      ;(byCat[item.category] ??= []).push(item)
    }
    for (const [cat, items] of Object.entries(byCat)) {
      lines.push(`${cat}:`)
      for (const item of items) {
        const colors = item.colors.slice(0, 2).join('/')
        const style = item.style ?? '?'
        const season = item.season.join(',')
        lines.push(`  [${item.ref}] ${item.subcategory ?? item.category} | rang: ${colors} | uslub: ${style} | mavsum: ${season}`)
      }
    }
  }

  if (ctx.weather) {
    const w = ctx.weather
    const parts: string[] = []
    if (w.temperature != null) parts.push(`${w.temperature}°C`)
    if (w.feelsLike != null) parts.push(`hisdagi: ${w.feelsLike}°C`)
    if (w.condition) parts.push(w.condition)
    if (w.precipitationProbability != null) parts.push(`yomg'ir: ${w.precipitationProbability}%`)
    lines.push('', `=== BUGUNGI OB-HAVO: ${parts.join(', ')} ===`)
  }

  if (ctx.event) {
    lines.push('', `=== TADBIR: ${ctx.event} ===`)
  }

  if (ctx.profile) {
    const p = ctx.profile
    const hints: string[] = []
    if (p.gender) hints.push(`jins: ${p.gender}`)
    if (p.preferredStyles?.length) hints.push(`afzallik: ${p.preferredStyles.join(',')}`)
    if (p.favoriteColors?.length) hints.push(`sevimli rang: ${p.favoriteColors.join(',')}`)
    if (p.dislikedColors?.length) hints.push(`yoqtirmaydigan: ${p.dislikedColors.join(',')}`)
    if (hints.length > 0) lines.push('', `=== PROFIL: ${hints.join(', ')} ===`)
  }

  lines.push('', 'Javobingiz faqat yuqoridagi garderobdan tanlangan kiyimlardan iborat bo\'lsin.')

  return lines.join('\n')
}

/**
 * Run one stylist turn. Returns the assistant message + metadata.
 *
 * Context blocks (all optional, appended to the system prompt in order):
 *   - context.wardrobe  — actual wardrobe items, ref-tagged
 *   - context.weather   — current weather snapshot
 *   - context.event     — occasion the user mentioned
 *   - context.profile   — user profile hints (preferred styles/colors/etc.)
 *   - engineHint        — top candidate from the recommendation engine
 *   - memoryContext     — Phase 6: extracted user preferences/corrections
 *   - knowledgeContext  — Phase 6: RAG-retrieved fashion knowledge rules
 *
 * The LLM does NOT pick the outfit — when an engineHint is provided, the
 * engine has already picked; the LLM just explains it. Spec rule 9.
 */
export async function runStylistTurn(
  userMessage: string,
  conversationHistory: LLMMessage[],
  context: StylistContext,
  engineHint?: string | null,
  memoryContext?: string,
  knowledgeContext?: string,
): Promise<StylistTurnResult> {
  const parts: string[] = [buildSystemPrompt(context)]

  if (memoryContext) parts.push('', memoryContext)
  if (knowledgeContext) parts.push('', knowledgeContext)

  // If we have an engine hint, append it as a "pre-selected" outfit context
  // block. The LLM is instructed to refer to this rather than pick its own.
  if (engineHint) {
    parts.push(
      '',
      '=== TAVSIYA DVIGATELI NATIJASI (eng yaxshi outfit) ===',
      engineHint,
      '',
      'Foydalanuvchi savoliga javoban YUQORIDAGI outfitni tavsiya qiling va uning sabablarini qisqa tushuntiring. O\'zingiz boshqa outfit o\'ylab topmang.',
    )
  }

  const finalSystem = parts.join('\n')

  const messages: LLMMessage[] = [
    { role: 'system', content: finalSystem },
    ...conversationHistory,
    { role: 'user', content: userMessage },
  ]

  const response = await generateText('stylist_chat', { messages, temperature: 0.7, maxOutputTokens: 600 })

  return {
    assistantMessage: response.text,
    provider: response.metadata.provider,
    contextSummary: {
      wardrobeItemCount: context.wardrobe.length,
      weatherProvided: !!context.weather,
      eventProvided: !!context.event,
    },
  }
}
