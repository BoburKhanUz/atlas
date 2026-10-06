/**
 * OutfitIntelligence: the AI part of outfit generation. Ranking stays in the
 * deterministic engine (recommendation.ts); here only the top candidate gets a
 * short natural-language explanation, exactly as before Phase 4.0. A failed
 * explanation is a soft failure: the outfit is returned without one.
 */
import { log } from '@/server/log'
import { generateText } from './client'
import { buildExplanationContext, type OutfitCandidate } from './recommendation'
import type { Occasion } from './color-theory'

/** Kept short: the explanation must not hold up outfit generation. */
export const EXPLANATION_TIMEOUT_MS = 15_000

const SYSTEM_PROMPT =
  'Siz shaxsiy AI stilistsiz. Tabiiy o\'zbek tilida qisqa (maksimal 60 so\'z), do\'stona javob yozing. Emoji ortiqcha emas. Javob faqat matn bo\'lsin.'

export async function explainOutfit(candidate: OutfitCandidate, occasion?: Occasion): Promise<string | null> {
  try {
    const context = buildExplanationContext(candidate, occasion)
    const result = await generateText('outfit_explanation', {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: context },
      ],
      temperature: 0.5,
      maxOutputTokens: 180,
      timeoutMs: EXPLANATION_TIMEOUT_MS,
    })
    return result.text
  } catch (err) {
    log.warn('outfit generate: LLM explanation failed', { err })
    return null
  }
}
