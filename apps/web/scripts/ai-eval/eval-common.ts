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
import { MOBILE_LABELS } from './client-labels'
import { CATEGORIES, COLORS, FITS, FORMALITIES, GENDERS, MATERIALS, OCCASIONS, PATTERNS, SEASONS, SLEEVE_LENGTHS, STYLES, SUBCATEGORIES } from '../../src/lib/ai/catalog'

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

const CYRILLIC = /[\u0400-\u04FF]/
/**
 * Latin letters outside the Uzbek Latin alphabet (Turkish ç ğ ı ş ö ü, Kazakh
 * á ó ú ń, other diacritics). Uzbek Latin writes o‘, g‘, sh, ch with plain
 * letters and an apostrophe, so any of these marks a different language.
 */
const NON_UZBEK_LATIN = /[\u00C0-\u024F\u0131]/
/** Every apostrophe variant used for o‘, g‘ and the tutuq belgisi, normalised to "'". */
const APOSTROPHES = /[‘’ʻʼ`´']/g
/** Frequent stand-alone Uzbek function words. */
const UZBEK_FUNCTION_WORDS = new Set([
  'va', 'bilan', 'uchun', 'bu', 'siz', 'sizga', 'sizda', 'sizning', 'sizni', 'mos', 'bugun', 'yaxshi', 'ham', 'emas', "yo'q",
  'yoki', 'lekin', 'ammo', 'biroq', 'agar', 'juda', 'bir', 'shu', 'ushbu', 'uni', 'unga', 'bunga', 'shunga', 'kerak', 'mumkin',
  "bo'ladi", 'bor', 'men', 'biz', 'qanday', 'nima', 'qaysi', 'faqat', 'eng', 'esa', 'hamda', 'chunki', 'keyin', 'yana', 'kabi',
  'edi', 'emas', 'hozir', 'endi', 'kecha', 'ertaga',
])
/**
 * Uzbek suffixes attached to words (agglutinative morphology), chosen because
 * English words rarely end in them; only words of five letters or more count
 * (six for -gan, which "began", "vegan", "organ" would otherwise match).
 */
const UZBEK_SUFFIX = /(ingiz|ingizni|ingizga|ingizda|ingizdan|ingizdagi|imiz|imizni|lardan|larni|larga|larda|lari|larim|laringiz|dagi|yapti|yapman|yapmiz|yapsiz|moqda|moqchi|roq|lik|likni|likda|adi|aydi|maydi|madi|mayman|olmayman|ishi|ishingiz|ilgan|langan|sangiz|saniz|gacha)$/
/**
 * Words of the app's own Uzbek catalog labels (Polo, Chinos, "Ko‘k (navy)",
 * "Smart-casual", "Formal"…): the app shows them, so they are never English leakage.
 */
const CATALOG_WORDS = new Set(
  [CATEGORIES, ...Object.values(SUBCATEGORIES), COLORS, PATTERNS, MATERIALS, STYLES, SLEEVE_LENGTHS, FITS, SEASONS, FORMALITIES, GENDERS, OCCASIONS]
    .flat()
    .flatMap((e) => uzbekTokens(e.label)),
)
/**
 * English words that mark English leakage: function words plus everyday
 * vocabulary that is not a catalog identifier, minus every word of the app's
 * catalog labels. Catalog identifiers (olive, sneakers…) are governed by the
 * explicit output policy below (catalogWording), not by this share.
 */
const ENGLISH_LEXICON = new Set([
  'the', 'and', 'with', 'you', 'your', 'for', 'is', 'are', 'this', 'that', 'of', 'can', 'will', 'it', 'very', 'really', 'so',
  'wear', 'outfit', 'today', 'weather', 'look', 'looks', 'style', 'great', 'good', 'nice', 'perfect', 'cute', 'comfortable',
  'heels', 'grey', 'smart', 'mild', 'color', 'colour',
])
const isEnglish = (token: string) => ENGLISH_LEXICON.has(token) && !CATALOG_WORDS.has(token)
/** Share of Uzbek-evidence words required (calibrated on the 2026-10 bake-off outputs; see BORDERLINE_MARGIN). */
export const UZBEK_MIN_SHARE = 0.3
/** Within this distance of UZBEK_MIN_SHARE, or with fewer than 5 words, the verdict is reported as borderline. */
export const BORDERLINE_MARGIN = 0.05

/** Lower-case words with apostrophes normalised; punctuation and emoji dropped. */
export function uzbekTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(APOSTROPHES, "'")
    .split(/[\s.,!?;:()"«»—–\-+/]+/)
    .map((t) => t.replace(/^'+|'+$/g, ''))
    .filter((t) => /\p{L}/u.test(t))
}

/**
 * Evidence that a word is Uzbek (Latin script): a function word, the o‘/g‘
 * letters, a q not followed by an English "qu"+vowel, or an Uzbek suffix.
 * Evidence, not proof: one Uzbek-looking word does not make a text Uzbek.
 */
export function isUzbekEvidence(token: string): boolean {
  if (isEnglish(token) || NON_UZBEK_LATIN.test(token)) return false
  return (
    UZBEK_FUNCTION_WORDS.has(token) ||
    /[og]'[a-z]/.test(token) ||
    /q(?!u[aeiou])/.test(token) ||
    (token.length >= 5 && UZBEK_SUFFIX.test(token)) ||
    (token.length >= 6 && token.endsWith('gan'))
  )
}

// ─── Uzbek output policy: catalog wording in user-visible prose ─────────────

/**
 * The catalog lists that describe clothing and colour. Their ids are internal
 * identifiers (database, prompts, structured output); their labels are the
 * canonical user-facing wording. Seasons, genders and occasions are not
 * clothing or colour descriptions and are outside the policy.
 */
const POLICY_CATALOGS = [CATEGORIES, ...Object.values(SUBCATEGORIES), COLORS, PATTERNS, MATERIALS, STYLES, SLEEVE_LENGTHS, FITS, FORMALITIES]
/** Every web catalog list (an id's labels are looked up in all of them, and in the Flutter client's labels). */
const ALL_CATALOGS = [...POLICY_CATALOGS, SEASONS, GENDERS, OCCASIONS]
/** Identifiers that are also ordinary Uzbek words: never penalised. */
const POLICY_EXEMPT: Readonly<Record<string, string>> = {
  tan: 'Uzbek word "tan" (body; "tan olmoq") — the colour id cannot be told apart lexically',
}

/**
 * - uzbek_label: every label is Uzbek wording without the English word, so the English word in prose violates the policy;
 * - loanword: every label contains the word (Polo, Chinos, Formal…), so the app itself shows it;
 * - review: the user-facing labels disagree (web "Bleyzer" vs Flutter "Blazer"; "Kasual" / "Casual" / "Kundalik")
 *   or show the word only in parentheses ("Ko‘k (navy)"): reported for human review, not penalised;
 * - exempt: see POLICY_EXEMPT.
 */
export type CatalogTermStatus = 'uzbek_label' | 'loanword' | 'review' | 'exempt'
export interface CatalogTerm {
  id: string
  words: readonly string[]
  /** Every user-facing label of the id: web catalog plus the Flutter client (never invented here). */
  labels: readonly string[]
  /** Labels from src/lib/ai/catalog.ts (also what the stylist inserts for a [W…] reference). */
  webLabels: readonly string[]
  /** Labels the Flutter client shows (client-labels.ts, verified against the Dart sources). */
  mobileLabels: readonly string[]
  status: CatalogTermStatus
}

const containsSeq = (hay: readonly string[], needle: readonly string[]) =>
  hay.some((_, i) => needle.every((w, j) => hay[i + j] === w))

/** The policy table, derived from the catalog (longest identifiers first, so "light blue" is matched before "blue"). */
export const CATALOG_TERMS: readonly CatalogTerm[] = [...new Set(POLICY_CATALOGS.flat().map((e) => e.id))]
  .map((id): CatalogTerm => {
    const words = uzbekTokens(id.replace(/_/g, ' '))
    const webLabels = [...new Set(ALL_CATALOGS.flat().filter((e) => e.id === id).map((e) => e.label))]
    const mobileLabels = MOBILE_LABELS[id] ?? []
    const labels = [...new Set([...webLabels, ...mobileLabels])]
    const inLabel = labels.map((l) => containsSeq(uzbekTokens(l), words))
    const outsideParens = labels.map((l) => containsSeq(uzbekTokens(l.replace(/\([^)]*\)/g, ' ')), words))
    const status: CatalogTermStatus =
      id in POLICY_EXEMPT ? 'exempt'
      : inLabel.every(Boolean) && outsideParens.every(Boolean) ? 'loanword'
      : inLabel.some(Boolean) ? 'review'
      : 'uzbek_label'
    return { id, words, labels, webLabels, mobileLabels, status }
  })
  .sort((a, b) => b.words.length - a.words.length)

export interface CatalogWordingCheck {
  /** English catalog identifiers used as wording although the catalog has Uzbek labels for them. */
  exposed: Array<{ term: string; labels: readonly string[] }>
  /** Identifiers whose canonical wording is ambiguous (status review): for manual review, never a failure. */
  review: string[]
  pass: boolean
}

/**
 * Uzbek output policy (docs/ai/uzbek-output-policy.md): user-visible clothing
 * and colour wording uses the catalog's Uzbek labels when they exist. Applies
 * to PROSE only (an answer, an explanation); structured fields keep catalog
 * ids and are never passed here. Lexical: inflected English forms
 * ("sneaker") and other spellings ("t-shirt") are not detected.
 */
export function catalogWording(text: string): CatalogWordingCheck {
  const tokens = uzbekTokens(text)
  const used = tokens.map(() => false)
  const exposed: CatalogWordingCheck['exposed'] = []
  const review: string[] = []
  for (const t of CATALOG_TERMS) {
    for (let i = 0; i + t.words.length <= tokens.length; i++) {
      if (!t.words.every((w, j) => tokens[i + j] === w && !used[i + j])) continue
      for (let j = 0; j < t.words.length; j++) used[i + j] = true
      const term = t.words.join(' ')
      if (t.status === 'uzbek_label') exposed.push({ term, labels: t.labels })
      else if (t.status === 'review' && !review.includes(term)) review.push(term)
    }
  }
  return { exposed, review, pass: exposed.length === 0 }
}

export interface UzbekCheck {
  /** No Cyrillic letters (the app writes Uzbek in the Latin script); a single mixed-in letter fails. */
  latin: boolean
  /** No Latin letters outside the Uzbek Latin alphabet (Turkish, Kazakh and other diacritics). */
  uzbekAlphabet: boolean
  /** At least two Uzbek-evidence words and a share of at least UZBEK_MIN_SHARE. */
  uzbek: boolean
  /** Share of Uzbek-evidence words among all words. */
  uzbekShare: number
  /** Share of English words (≤ 0.05 passes). */
  englishShare: number
  /** The verdict sits near the threshold or rests on very few words: treat it as uncertain. */
  borderline: boolean
  /** Uzbek output policy: catalog wording (reported separately so policy failures can be told apart). */
  catalogWording: CatalogWordingCheck
  pass: boolean
}

/**
 * Automatic Uzbek (Latin) PROXY: script, alphabet, Uzbek evidence and English
 * leakage. A HEURISTIC, not a language-quality measure, and not a language
 * identifier: it can be fooled by short texts and by vocabulary it does not
 * list. The native-speaker rubric in docs/ai/provider-evaluation.md stays the reference.
 */
export function uzbekCheck(
  text: string,
  /**
   * The model-authored wording when the shown text also contains labels the
   * app inserted itself (the stylist's [W…] references): the catalog-wording
   * policy judges the model's words only. App labels come from the catalog,
   * so they can never be a violation, but they would flag review terms
   * ("ko‘k (navy)") the model never wrote.
   */
  authored: string = text,
): UzbekCheck {
  const tokens = uzbekTokens(text)
  const uz = tokens.filter(isUzbekEvidence).length
  const english = tokens.filter(isEnglish).length
  const share = (n: number) => (tokens.length === 0 ? 0 : Math.round((n / tokens.length) * 1000) / 1000)
  const uzbekShare = share(uz)
  const englishShare = tokens.length === 0 ? 1 : share(english)
  const latin = !CYRILLIC.test(text)
  const uzbekAlphabet = !NON_UZBEK_LATIN.test(text)
  const uzbek = uz >= 2 && uzbekShare >= UZBEK_MIN_SHARE
  const borderline = tokens.length < 5 || Math.abs(uzbekShare - UZBEK_MIN_SHARE) < BORDERLINE_MARGIN
  const wording = catalogWording(authored)
  return {
    latin, uzbekAlphabet, uzbek, uzbekShare, englishShare, borderline, catalogWording: wording,
    pass: latin && uzbekAlphabet && uzbek && englishShare <= 0.05 && wording.pass,
  }
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

/**
 * Identifiers and private data that must never appear in a model's answer
 * (deterministic patterns; a HEURISTIC, not a guarantee). Internal ids are
 * matched anywhere in a word, so "eval_item_3" is caught as well as "item_3".
 */
export const PRIVATE_PATTERNS = [
  /(item|user|conv|img|msg)_[a-z0-9]+/i,
  /\bc[a-z0-9]{20,}\b/,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
  /[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}/i,
  /You are ATLAS/i,
  /CONTEXT \(JSON/i,
]
/** A phone number: at least 9 digits in one run of digits, spaces, dots, dashes and brackets. */
const PHONE = /\+?\d[\d\s().-]{7,}\d/g
const hasPhone = (text: string) => [...text.matchAll(PHONE)].some((m) => m[0].replace(/\D/g, '').length >= 9)
export const leaksPrivate = (text: string) => PRIVATE_PATTERNS.some((re) => re.test(text)) || hasPhone(text)

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
