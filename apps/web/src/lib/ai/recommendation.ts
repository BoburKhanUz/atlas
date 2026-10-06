/**
 * Outfit recommendation — compatibility entry point. Since Phase 4.4 the
 * engine is the deterministic outfit engine in ./outfit-engine.ts (hard
 * filters, bounded candidate generation, scoring, stable ordering); the
 * optional AI reranking and explanation live in ./outfit-intelligence.ts.
 */
export {
  generateOutfits,
  generateOutfitResult,
  type ColorProfileInput,
  type GenerateInput,
  type GenerateResult,
  type OutfitCandidate,
  type OutfitFeedbackHint,
  type UserProfileSummary,
  type WardrobeItemSummary,
  type WeatherSnapshot,
} from './outfit-engine'
import type { WeatherSnapshot } from './outfit-engine'

/** Narrow a partial, client-supplied weather object to a full snapshot. */
export function isCompleteWeather(w: Partial<WeatherSnapshot> | null | undefined): w is WeatherSnapshot {
  if (!w) return false
  return (
    typeof w.temperature === 'number' &&
    typeof w.feelsLike === 'number' &&
    typeof w.condition === 'string' &&
    typeof w.precipitationProbability === 'number' &&
    typeof w.humidity === 'number' &&
    typeof w.windSpeed === 'number' &&
    typeof w.uvIndex === 'number'
  )
}
