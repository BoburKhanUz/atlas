/**
 * Builds the configured providers once, through the provider registry
 * (./registry.ts). The application layer obtains providers only through these
 * functions (or, better, through ../client.ts), never by importing an adapter.
 */
import { getAiConfig, type AiConfig, type AiTextFeature, type TextRouteConfig } from '../config'
import { resolveProvider } from './registry'
import type { LLMProvider, VisionProvider } from './types'

export type { LLMMessage, LLMProvider, LLMRequest, LLMResult, VisionOptions, VisionProvider, VisionRequest, VisionResult } from './types'

/** Configured text providers, one per feature route (built on first use). */
const textProviders = new Map<AiTextFeature, LLMProvider>()
/** Test injections: one provider for every text feature, or one per feature (which wins). */
let llmOverride: LLMProvider | null = null
const featureOverrides = new Map<AiTextFeature, LLMProvider>()
let vision: VisionProvider | null = null

export function createLLMProvider(config: AiConfig['llm'] | TextRouteConfig): LLMProvider {
  return resolveProvider('text', config)
}

/** The text provider of `feature`'s route. A route never borrows another route's provider. */
export function getTextProvider(feature: AiTextFeature): LLMProvider {
  const injected = featureOverrides.get(feature) ?? llmOverride
  if (injected) return injected
  let p = textProviders.get(feature)
  if (!p) {
    p = createLLMProvider(getAiConfig().text[feature])
    textProviders.set(feature, p)
  }
  return p
}

/** The stylist route's provider (the legacy single text provider when no route is overridden). */
export function getLLMProvider(): LLMProvider {
  return getTextProvider('stylist_chat')
}

export function createVisionProvider(config: AiConfig['vision']): VisionProvider {
  return resolveProvider('vision', config)
}

export function getVisionProvider(): VisionProvider {
  vision ??= createVisionProvider(getAiConfig().vision)
  return vision
}

/** Tests only: inject a provider for every text feature (null restores the configured ones). */
export function setLLMProviderForTesting(p: LLMProvider | null): void {
  llmOverride = p
  featureOverrides.clear()
  textProviders.clear()
}

/** Tests only: inject a provider for one text feature (null removes that injection). */
export function setTextProviderForTesting(feature: AiTextFeature, p: LLMProvider | null): void {
  if (p) featureOverrides.set(feature, p)
  else featureOverrides.delete(feature)
}

/** Tests only: inject a vision provider (null restores the configured one). */
export function setVisionProviderForTesting(p: VisionProvider | null): void {
  vision = p
}
