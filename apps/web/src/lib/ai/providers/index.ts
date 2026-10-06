/**
 * Provider registry: builds the configured providers once. The application
 * layer obtains providers only through these functions (or, better, through
 * ../client.ts), never by importing an adapter.
 */
import { getAiConfig, type AiConfig } from '../config'
import { GeminiProvider } from './gemini'
import { MockProvider } from './mock'
import { OpenAIProvider } from './openai'
import type { LLMProvider, VisionProvider } from './types'

export type { LLMMessage, LLMProvider, LLMRequest, LLMResult, VisionProvider, VisionRequest, VisionResult } from './types'

let llm: LLMProvider | null = null
let vision: VisionProvider | null = null

export function createLLMProvider(config: AiConfig['llm']): LLMProvider {
  switch (config.provider) {
    case 'gemini':
      return new GeminiProvider({ apiKey: config.apiKey ?? '', model: config.model })
    case 'openai':
      return new OpenAIProvider({ apiKey: config.apiKey ?? '', model: config.model })
    case 'mock':
      return new MockProvider()
  }
}

export function getLLMProvider(): LLMProvider {
  llm ??= createLLMProvider(getAiConfig().llm)
  return llm
}

export function getVisionProvider(): VisionProvider {
  // Only the mock exists until Phase 4.1 (config refuses anything else).
  vision ??= new MockProvider()
  return vision
}

/** Tests only: inject a provider (null restores the configured one). */
export function setLLMProviderForTesting(p: LLMProvider | null): void {
  llm = p
}

/** Tests only: inject a vision provider (null restores the configured one). */
export function setVisionProviderForTesting(p: VisionProvider | null): void {
  vision = p
}
