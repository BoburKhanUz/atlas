/**
 * Shared, pure helpers of the Phase 4.5 evaluation harness (stylist and
 * outfit; the vision harness has its own scoring in vision-scoring.ts):
 * statistics, automatic Uzbek-quality checks, garment-mention grounding and
 * the provider built from the environment. Unit-tested in
 * tests/unit/ai/ai-eval-harness.test.ts.
 *
 * The automatic checks are PROXIES (script, Uzbek markers, English leakage).
 * They do not replace the native-speaker rubric in docs/ai/provider-evaluation.md.
 */
import { GeminiProvider } from '../../src/lib/ai/providers/gemini'
import { OpenAIProvider } from '../../src/lib/ai/providers/openai'
import type { LLMProvider } from '../../src/lib/ai/providers/types'

/** Evaluation status written into every machine-readable summary. */
export type EvalStatus = 'TESTED' | 'PARTIALLY_TESTED' | 'NOT_TESTED' | 'OFFLINE_SELF_TEST'

// ─── Statistics ─────────────────────────────────────────────────────────────

/** Nearest-rank percentile; null for an empty list. */
export function percentile(values: number[], p: number): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (v.length === 0) return null
  return v[Math.min(v.length - 1, Math.max(0, Math.ceil((p / 100) * v.length) - 1))]
}

export const rate = (hits: number, n: number): number | null => (n === 0 ? null : Math.round((hits / n) * 1000) / 1000)

/** Kendall's tau-a between two orderings of the same items (1 = identical, −1 = reversed). */
export function kendallTau(a: readonly string[], b: readonly string[]): number | null {
  if (a.length !== b.length || a.length < 2) return null
  const pos = new Map(b.map((x, i) => [x, i]))
  if (a.some((x) => !pos.has(x))) return null
  let concordant = 0, discordant = 0
  for (let i = 0; i < a.length; i++) {
    for (let j = i + 1; j < a.length; j++) {
      if (pos.get(a[i])! < pos.get(a[j])!) concordant++
      else discordant++
    }
  }
  return Math.round(((concordant - discordant) / (concordant + discordant)) * 1000) / 1000
}

// ─── Uzbek (Latin) quality proxies ──────────────────────────────────────────

const CYRILLIC = /[Ѐ-ӿ]/
/** Frequent Uzbek function words and suffixes; their presence marks Uzbek text. */
const UZBEK_MARKERS = /\b(va|bilan|uchun|bu|siz|sizga|sizning|kiying|kiyish|mos|bugun|yaxshi|ham|emas|yo‘q|yoki|ga|da|ni|ning|dagi|lar|ingiz|imiz)\b|[og][‘'ʻ’]/giu
const ENGLISH_WORDS = /\b(the|and|with|you|your|for|is|are|this|that|wear|outfit|today|weather)\b/giu
const words = (s: string) => s.split(/\s+/).filter((w) => /\p{L}/u.test(w))

export interface UzbekCheck {
  /** No Cyrillic letters (the app writes Uzbek in the Latin script). */
  latin: boolean
  /** At least one Uzbek marker per 8 words (and at least one). */
  uzbek: boolean
  /** Share of common English words (≤ 0.05 passes). */
  englishShare: number
  pass: boolean
}

export function uzbekCheck(text: string): UzbekCheck {
  const w = words(text)
  const markers = (text.match(UZBEK_MARKERS) ?? []).length
  const english = (text.match(ENGLISH_WORDS) ?? []).length
  const englishShare = w.length === 0 ? 1 : Math.round((english / w.length) * 1000) / 1000
  const latin = !CYRILLIC.test(text)
  const uzbek = markers >= 1 && markers >= w.length / 8
  return { latin, uzbek, englishShare, pass: latin && uzbek && englishShare <= 0.05 }
}

// ─── Garment mentions (grounding of free text) ──────────────────────────────

/**
 * Which owned subcategories a garment word may stand for: one subcategory, any
 * of several (a generic word), all of several (a word for a combination), or
 * null for items the app's catalog does not have at all.
 */
export type GarmentOwner = string | null | { any: readonly string[] } | { all: readonly string[] }

/**
 * Distinctive Uzbek garment words → what the user must own for the word to be
 * grounded. Ambiguous words ("ko‘ylak", "shim") are left out on purpose: they
 * would make the check noisy. Generic words map to every catalog item they
 * name in everyday Uzbek, so a natural name for an owned item is not counted
 * as invented (smoke-test analysis, 2026-10-07).
 */
export const GARMENT_WORDS: ReadonlyArray<[RegExp, GarmentOwner]> = [
  // A windbreaker (vetrovka) is a kind of kurtka.
  [/\bkurtka/iu, { any: ['jacket', 'windbreaker'] }],
  [/\bbleyzer/iu, 'blazer'],
  [/\bpalto/iu, 'coat'],
  [/\bvetrovka/iu, 'windbreaker'],
  [/\bfutbolka/iu, 'tshirt'],
  [/\bpolo\b/iu, 'polo'],
  [/\bbluzka/iu, 'blouse'],
  [/\bjins/iu, 'jeans'],
  [/\bchinos/iu, 'chinos'],
  [/\bshorti?/iu, 'shorts'],
  [/\bkrossovka/iu, 'sneakers'],
  [/\bmokasin/iu, 'loafers'],
  [/\bbotinka/iu, 'boots'],
  [/\bsandal/iu, 'sandals'],
  [/\bryukzak/iu, 'backpack'],
  [/\bsharf/iu, 'scarf'],
  [/\bshlyapa/iu, 'hat'],
  // A suit is a blazer worn with trousers: grounded only when both are owned.
  [/\bkostyum/iu, { all: ['blazer', 'trousers'] }],
  [/\bgalstuk/iu, null],
  [/\bkepka/iu, null],
  // The catalog's knit (label "Nitki") is what Uzbek speakers call a sviter.
  [/\bsviter/iu, 'knit'],
]

function owns(owner: GarmentOwner, available: ReadonlySet<string>): boolean {
  if (owner === null) return false
  if (typeof owner === 'string') return available.has(owner)
  return 'any' in owner ? owner.any.some((s) => available.has(s)) : owner.all.every((s) => available.has(s))
}

/**
 * Garments named in `text` that are not among `available` subcategories
 * (nor explicitly allowed for this case, e.g. the item the user asked for).
 */
export function inventedGarments(text: string, available: ReadonlySet<string>, allowed: readonly string[] = []): string[] {
  const out: string[] = []
  for (const [re, owner] of GARMENT_WORDS) {
    const m = text.match(re)
    if (!m) continue
    const word = m[0].toLowerCase()
    if (allowed.some((a) => word.startsWith(a.toLowerCase()))) continue
    if (!owns(owner, available)) out.push(word)
  }
  return out
}

/** Identifiers that must never appear in a model's answer. */
export const PRIVATE_PATTERNS = [/\b(item|user|conv|img|msg)_[a-z0-9_]+/i, /\bc[a-z0-9]{20,}\b/, /You are ATLAS/i, /CONTEXT \(JSON/i]
export const leaksPrivate = (text: string) => PRIVATE_PATTERNS.some((re) => re.test(text))

// ─── Providers (keys and models from the environment only) ─────────────────

export type EvalProviderName = 'gemini' | 'openai'
const KEY_VAR: Record<EvalProviderName, string> = { gemini: 'GEMINI_API_KEY', openai: 'OPENAI_API_KEY' }

/**
 * The LLM provider to evaluate: `--provider` (else AI_LLM_PROVIDER) and
 * `--model` (else AI_LLM_MODEL). No built-in model: an evaluation always runs
 * the configured one. Throws before any call when something is missing.
 */
export function llmProviderFromEnv(argProvider: string | undefined, argModel: string | undefined, env: Record<string, string | undefined> = process.env): LLMProvider {
  const name = (argProvider ?? env.AI_LLM_PROVIDER ?? '').trim().toLowerCase()
  if (name !== 'gemini' && name !== 'openai') throw new Error('provider must be gemini or openai (--provider or AI_LLM_PROVIDER)')
  const model = (argModel ?? env.AI_LLM_MODEL ?? '').trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(model)) throw new Error('model must be set (--model or AI_LLM_MODEL)')
  const apiKey = env[KEY_VAR[name]]?.trim()
  if (!apiKey) throw new Error(`${KEY_VAR[name]} is not set`)
  return name === 'gemini' ? new GeminiProvider({ apiKey, model }) : new OpenAIProvider({ apiKey, model })
}

export function arg(name: string, argv: readonly string[] = process.argv): string | undefined {
  const prefix = `--${name}=`
  return argv.find((a) => a.startsWith(prefix))?.slice(prefix.length)
}

/** Results never go into the repository. */
export function assertOutsideRepo(outDir: string, repoRoot: string, path: typeof import('path')): void {
  if (!path.relative(repoRoot, path.resolve(outDir)).startsWith('..')) throw new Error('--out must be outside the repository (results are not committed)')
}
