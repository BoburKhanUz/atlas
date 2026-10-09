/**
 * Provider registry (multi-provider P0): one descriptor per provider, and the
 * resolver that builds an adapter for a capability. Adding a provider means
 * one adapter and one descriptor here; the application layer keeps talking to
 * LLMProvider / VisionProvider only.
 *
 * A capability is supported when the descriptor has a factory for it. The
 * resolver never substitutes another provider: an unknown provider or an
 * unsupported capability is a configuration error (fail closed).
 */
import { ConfigError } from '@/lib/config'
import type { FetchLike } from './http'
import { GeminiProvider } from './gemini'
import { MockProvider } from './mock'
import { OpenAIProvider } from './openai'
import type { LLMProvider, VisionProvider } from './types'

/** What an adapter is asked to do: text (stylist, outfit) or vision (clothing analysis). */
export type AiCapability = 'text' | 'vision'

export interface ProviderInit {
  /** Empty for a provider without credentials; real adapters refuse an empty key themselves. */
  apiKey: string
  model: string
  /** Tests only: a scripted transport. Production adapters use the global fetch. */
  fetch?: FetchLike
}

export interface ProviderDescriptor {
  /** Lowercase id used in configuration and telemetry. */
  readonly id: string
  /** Environment variable holding the API key; null when the provider needs none. */
  readonly keyEnv: string | null
  readonly text?: (init: ProviderInit) => LLMProvider
  readonly vision?: (init: ProviderInit) => VisionProvider
}

const DESCRIPTORS = [
  { id: 'mock', keyEnv: null, text: () => new MockProvider(), vision: () => new MockProvider() },
  { id: 'gemini', keyEnv: 'GEMINI_API_KEY', text: (i) => new GeminiProvider(i), vision: (i) => new GeminiProvider(i) },
  { id: 'openai', keyEnv: 'OPENAI_API_KEY', text: (i) => new OpenAIProvider(i), vision: (i) => new OpenAIProvider(i) },
] as const satisfies readonly ProviderDescriptor[]

export type ProviderId = (typeof DESCRIPTORS)[number]['id']

/** Registered provider ids, in a fixed order (configuration messages list them in this order). */
export const PROVIDER_IDS: readonly ProviderId[] = DESCRIPTORS.map((d) => d.id)

export type ProviderRegistry = ReadonlyMap<string, ProviderDescriptor>

export const PROVIDER_REGISTRY: ProviderRegistry = new Map(DESCRIPTORS.map((d) => [d.id, d]))

/** The canonical form of a configured provider name: trimmed and lowercase. */
export function normalizeProviderId(raw: string): string {
  return raw.trim().toLowerCase()
}

/** "a, b or c": the registered ids as configuration messages list them. */
export function describeIds(ids: readonly string[]): string {
  return ids.length < 2 ? ids.join('') : `${ids.slice(0, -1).join(', ')} or ${ids[ids.length - 1]}`
}

export function getProviderDescriptor(id: string, registry: ProviderRegistry = PROVIDER_REGISTRY): ProviderDescriptor {
  const descriptor = registry.get(normalizeProviderId(id))
  if (!descriptor) throw new ConfigError(`unknown AI provider (registered: ${describeIds([...registry.keys()])})`)
  return descriptor
}

export function supportsCapability(descriptor: ProviderDescriptor, capability: AiCapability): boolean {
  return typeof descriptor[capability] === 'function'
}

export interface ProviderSelection {
  provider: string
  model: string
  apiKey: string | null
}

/** Builds the adapter `selection` names for `capability`; never falls back to another provider. */
export function resolveProvider(capability: 'text', selection: ProviderSelection, opts?: { registry?: ProviderRegistry; fetch?: FetchLike }): LLMProvider
export function resolveProvider(capability: 'vision', selection: ProviderSelection, opts?: { registry?: ProviderRegistry; fetch?: FetchLike }): VisionProvider
export function resolveProvider(
  capability: AiCapability,
  selection: ProviderSelection,
  opts: { registry?: ProviderRegistry; fetch?: FetchLike } = {},
): LLMProvider | VisionProvider {
  const descriptor = getProviderDescriptor(selection.provider, opts.registry)
  const factory = descriptor[capability]
  if (!factory) throw new ConfigError(`AI provider ${descriptor.id} does not support ${capability}`)
  return factory({ apiKey: selection.apiKey ?? '', model: selection.model, ...(opts.fetch ? { fetch: opts.fetch } : {}) })
}
