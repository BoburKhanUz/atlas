/**
 * Runtime form of the Uzbek output policy (docs/ai/uzbek-output-policy.md):
 * an English catalog identifier ("loafers", "white", "windbreaker") must not
 * appear in user-visible prose when the catalog has an Uzbek label for it.
 * The evaluator's table (scripts/ai-eval/eval-common.ts, status 'uzbek_label')
 * is the reference; a unit test keeps the two sets identical.
 */
import { CATEGORIES, COLORS, FITS, FORMALITIES, GENDERS, MATERIALS, OCCASIONS, PATTERNS, SEASONS, SLEEVE_LENGTHS, STYLES, SUBCATEGORIES } from './catalog'

const APOSTROPHES = /[‘’ʻʼ`´']/g

/** Lower-case words with apostrophes normalised; punctuation dropped. */
function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(APOSTROPHES, "'")
    .split(/[\s.,!?;:()"«»—–\-+/]+/)
    .map((t) => t.replace(/^'+|'+$/g, ''))
    .filter((t) => /\p{L}/u.test(t))
}

const POLICY_CATALOGS = [CATEGORIES, ...Object.values(SUBCATEGORIES), COLORS, PATTERNS, MATERIALS, STYLES, SLEEVE_LENGTHS, FITS, FORMALITIES]
const ALL_CATALOGS = [...POLICY_CATALOGS, SEASONS, GENDERS, OCCASIONS]
/** Also ordinary Uzbek words ("tan"): never flagged. */
const EXEMPT = new Set(['tan'])
/**
 * Shown as the English word by the Flutter client although the web label is
 * Uzbek ("Blazer", "Denim", "Ko‘k (navy)"): the evaluator lists them for
 * review instead of failing them, and so does this check.
 */
const SHOWN_BY_MOBILE = new Set(['blazer', 'denim', 'navy', 'teal', 'rust'])

const containsSeq = (hay: readonly string[], needle: readonly string[]) => hay.some((_, i) => needle.every((w, j) => hay[i + j] === w))

/** The flagged identifiers as word sequences, longest first ("light blue" before "blue"). */
export const PROSE_FORBIDDEN_TERMS: readonly (readonly string[])[] = [...new Set(POLICY_CATALOGS.flat().map((e) => e.id))]
  .map((id) => ({ id, words: tokens(id.replace(/_/g, ' ')) }))
  .filter(({ id, words }) => {
    const joined = words.join(' ')
    if (EXEMPT.has(joined) || SHOWN_BY_MOBILE.has(joined)) return false
    const labels = ALL_CATALOGS.flat().filter((e) => e.id === id).map((e) => e.label)
    return !labels.some((l) => containsSeq(tokens(l), words))
  })
  .map(({ words }) => words)
  .sort((a, b) => b.length - a.length)

/** English catalog identifiers used as wording in `text` (empty when the text follows the policy). */
export function exposedCatalogTerms(text: string): string[] {
  const t = tokens(text)
  const used = t.map(() => false)
  const found: string[] = []
  for (const words of PROSE_FORBIDDEN_TERMS) {
    for (let i = 0; i + words.length <= t.length; i++) {
      if (!words.every((w, j) => t[i + j] === w && !used[i + j])) continue
      for (let j = 0; j < words.length; j++) used[i + j] = true
      found.push(words.join(' '))
    }
  }
  return found
}

/** Cyrillic letters: the app writes Uzbek in the Latin script only. */
export const hasCyrillic = (text: string) => /[Ѐ-ӿ]/.test(text)
