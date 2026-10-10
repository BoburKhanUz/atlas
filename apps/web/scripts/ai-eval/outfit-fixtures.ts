/**
 * OFFLINE outfit evaluation on supplied contexts (outfit-fixture-v1).
 *
 * Scores STORED or deterministic fixture outputs against explicit, artificial
 * evaluation fixtures (wardrobe with catalog ids, weather, occasion,
 * preferences, the expected grounding / consistency assertions, the language
 * policy and the safety / abstention rubric). It never builds a provider, calls
 * an AI endpoint or reads production data: it is a scorer, not a runner.
 *
 *   bun scripts/ai-eval/outfit-fixtures.ts --fixtures=<fixtures.json> --outputs=<outputs.json> --out=<new dir outside the repo>
 *
 * Metrics are kept apart (a case passes only when every metric that applies passes):
 * - grounding: every recommended item is in the supplied wardrobe, no item twice,
 *   and the explanation names no garment outside the recommended items (neither
 *   one the user does not own nor an owned item that was not recommended),
 *   and names no recommended item with a colour it does not have;
 * - structure: footwear, a top and bottom or a dress, at most one outer layer, no dress with bottoms;
 * - weather: cold / heat / wet rules (outfit-rules.ts); not applicable without weather;
 * - occasion: a formal occasion has no shorts, t-shirts or sneakers; not applicable otherwise;
 * - preference: no disliked colour in the recommendation when one is avoidable;
 * - relevance: an abstention exactly when the fixture expects one;
 * - language: the Uzbek proxy and the catalog-wording policy, each separately;
 * - safety: no private data or internal references in the explanation, no weather claims without weather.
 *
 * FIXTURE-BASED: results show that the scorer and the stored outputs agree with
 * the written expectations. They are NOT evidence of real-world quality.
 */
import { promises as fs } from 'fs'
import path from 'path'
import { z } from 'zod'
import { CATEGORIES, COLORS, MATERIALS, OCCASIONS, SUBCATEGORIES } from '../../src/lib/ai/catalog'
import { arg, assertOutsideRepo, CATALOG_TERMS, inventedGarments, leaksPrivate, uzbekCheck, uzbekTokens, type UzbekCheck } from './eval-common'
import { WEATHER_CLAIM } from './outfit-scoring'
import { outfitRuleViolations } from './outfit-rules'
import { reviewCase, summarizeReview, type CaseReview, type ReviewSummary } from './review'

export const OUTFIT_FIXTURE_VERSION = 'outfit-fixture-v1'
export const LANGUAGE_POLICY = 'uzbek-output-policy-v1'

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const ids = (entries: ReadonlyArray<{ id: string }>) => entries.map((e) => e.id) as [string, ...string[]]
const WEATHER_CONDITIONS = ['clear', 'partly_cloudy', 'cloudy', 'rain', 'thunderstorm', 'snow', 'fog'] as const
const labelsOf = (id: string) => CATALOG_TERMS.find((t) => t.id === id)?.labels ?? []

const FixtureItem = z
  .strictObject({
    /** Opaque reference used by the output (W1, W2…); never a database id. */
    ref: z.string().regex(/^W\d{1,3}$/),
    category: z.enum(ids(CATEGORIES)),
    subcategory: z.string(),
    colors: z.array(z.enum(ids(COLORS))).min(1).max(5),
    material: z.enum(ids(MATERIALS)).nullable().optional(),
    /** Optional user-facing label; must be a canonical label (web catalog or Flutter client) of the subcategory. */
    label: z.string().optional(),
  })
  .refine((i) => SUBCATEGORIES[i.category]?.some((s) => s.id === i.subcategory), 'subcategory must be a catalog subcategory of the category')
  .refine((i) => i.label === undefined || labelsOf(i.subcategory).includes(i.label), 'label must be a canonical label of the subcategory')

export const OutfitFixture = z.strictObject({
  id: z.string().regex(SAFE_ID),
  tags: z.array(z.string().regex(SAFE_ID)).max(10),
  wardrobe: z.array(FixtureItem).max(60).refine((w) => new Set(w.map((i) => i.ref)).size === w.length, 'duplicate wardrobe refs'),
  weather: z.strictObject({ feelsLikeC: z.number().min(-60).max(60), condition: z.enum(WEATHER_CONDITIONS) }).nullable(),
  occasion: z.enum(ids(OCCASIONS)).nullable(),
  preferences: z.strictObject({ dislikedColors: z.array(z.enum(ids(COLORS))).max(10) }).optional(),
  expect: z.strictObject({
    /** The supplied wardrobe cannot make a valid outfit: a safe abstention is the right answer. */
    abstain: z.boolean(),
    /** The occasion requires formal pieces (asserted by the fixture author, not inferred). */
    formal: z.boolean(),
  }),
  languagePolicy: z.literal(LANGUAGE_POLICY),
  safety: z.strictObject({
    /** An abstention is also acceptable when a valid outfit exists (e.g. an ambiguous request). */
    abstentionAllowed: z.boolean(),
  }),
})
export type OutfitFixture = z.infer<typeof OutfitFixture>

export const FixtureOutput = z.discriminatedUnion('kind', [
  z.strictObject({ case: z.string().regex(SAFE_ID), kind: z.literal('recommendation'), items: z.array(z.string().regex(/^W\d{1,3}$/)).min(1).max(8), explanation: z.string().max(2000) }),
  z.strictObject({ case: z.string().regex(SAFE_ID), kind: z.literal('abstain'), explanation: z.string().max(2000) }),
  /** The stored output broke the output contract. */
  z.strictObject({ case: z.string().regex(SAFE_ID), kind: z.literal('invalid') }),
  z.strictObject({ case: z.string().regex(SAFE_ID), kind: z.literal('error'), error: z.string().regex(SAFE_ID) }),
])
export type FixtureOutput = z.infer<typeof FixtureOutput>

export const FIXTURE_METRICS = ['grounding', 'structure', 'weather', 'occasion', 'preference', 'relevance', 'uzbek_proxy', 'language_policy', 'safety'] as const
export type FixtureMetric = (typeof FIXTURE_METRICS)[number]

export interface FixtureResult {
  case: string
  outcome: 'recommendation' | 'abstain' | 'invalid' | 'error' | 'missing'
  /** Per metric: true / false, or null when it does not apply. */
  metrics: Record<FixtureMetric, boolean | null>
  /** Failed rule tags and grounding findings (stable strings). */
  findings: string[]
  uzbek: UzbekCheck | null
  pass: boolean
  review: CaseReview
}

/** Colour words of the catalog's colour labels (web + Flutter) → the colour ids they name; modifiers ("och", "to‘q") are not colours. */
const COLOR_MODIFIERS = new Set(['och', "to'q", 'rang', 'rangli'])
const COLOR_WORDS = new Map<string, Set<string>>()
for (const c of COLORS) for (const label of labelsOf(c.id)) for (const w of uzbekTokens(label)) {
  if (COLOR_MODIFIERS.has(w)) continue
  if (!COLOR_WORDS.has(w)) COLOR_WORDS.set(w, new Set())
  COLOR_WORDS.get(w)!.add(c.id)
}

/**
 * What the explanation says about owned garments, by their canonical labels
 * (web catalog or Flutter, e.g. "klassik shim", "palto"):
 * - unrecommended: owned items named although they were NOT recommended.
 *   inventedGarments only knows garments the user does not own and leaves out
 *   ambiguous words ("shim"), so an explanation describing another owned item
 *   would otherwise pass;
 * - colourMismatch: a recommended item named with a colour it does not have
 *   ("qora krossovka" for white sneakers), read from the word just before the
 *   label ("zaytun rangli polo": the word before "rangli").
 * Longest labels first, so "oksford ko‘ylak" is never read as the shoe label
 * "oksford"; the last word of a label may carry a suffix ("paltoni",
 * "krossovkalar"). Lexical: a colour stated elsewhere in the sentence is not checked.
 */
function namedGarments(explanation: string, wardrobe: ReadonlyArray<{ subcategory: string }>, recommended: ReadonlyArray<{ subcategory: string; colors: readonly string[] }>) {
  const tokens = uzbekTokens(explanation)
  const used = tokens.map(() => false)
  const labels = [...new Set(wardrobe.map((i) => i.subcategory))]
    .flatMap((sub) => labelsOf(sub).map((l) => ({ sub, label: l, words: uzbekTokens(l) })))
    .filter((l) => l.words.length > 0)
    .sort((a, b) => b.words.length - a.words.length || b.words.join(' ').length - a.words.join(' ').length)
  const unrecommended: string[] = [], colourMismatch: string[] = []
  for (const l of labels) {
    const last = l.words.length - 1
    for (let i = 0; i + l.words.length <= tokens.length; i++) {
      const hit = l.words.every((w, j) => !used[i + j] && (j === last && w.length >= 4 ? tokens[i + j].startsWith(w) : tokens[i + j] === w))
      if (!hit) continue
      for (let j = 0; j <= last; j++) used[i + j] = true
      // A label shared with a recommended item (two pairs of jeans) names the recommended one.
      const named = recommended.filter((r) => r.subcategory === l.sub || labelsOf(r.subcategory).includes(l.label))
      if (!named.length) {
        if (!unrecommended.includes(l.sub)) unrecommended.push(l.sub)
        continue
      }
      let p = i - 1
      if (p >= 0 && COLOR_MODIFIERS.has(tokens[p]) && tokens[p] !== 'och' && tokens[p] !== "to'q") p--
      const said = p >= 0 ? COLOR_WORDS.get(tokens[p]) : undefined
      if (said && !named.some((r) => r.colors.some((c) => said.has(c)))) {
        const finding = `${l.sub}:${tokens[p]}`
        if (!colourMismatch.includes(finding)) colourMismatch.push(finding)
      }
    }
  }
  return { unrecommended, colourMismatch }
}

/** The Uzbek proxy alone (script, alphabet, evidence, English share), without the catalog-wording policy. */
const proxyPasses = (u: UzbekCheck) => u.latin && u.uzbekAlphabet && u.uzbek && u.englishShare <= 0.05

export function evaluateFixture(f: OutfitFixture, output: FixtureOutput | undefined): FixtureResult {
  const none = Object.fromEntries(FIXTURE_METRICS.map((m) => [m, null])) as Record<FixtureMetric, boolean | null>
  if (!output || output.kind === 'invalid' || output.kind === 'error') {
    const outcome = output ? output.kind : 'missing'
    const detail = output?.kind === 'error' ? output.error : outcome
    // No usable output: every metric is unknown and the case fails (never silently dropped).
    return { case: f.id, outcome, metrics: none, findings: [`no_output:${detail}`], uzbek: null, pass: false, review: reviewCase(f.id, false, {}) }
  }
  const findings: string[] = []
  const metrics = { ...none }
  const byRef = new Map(f.wardrobe.map((i) => [i.ref, i]))
  const explanation = output.explanation
  const uzbek = uzbekCheck(explanation)
  metrics.uzbek_proxy = proxyPasses(uzbek)
  metrics.language_policy = uzbek.catalogWording.pass
  for (const e of uzbek.catalogWording.exposed) findings.push(`language_policy:${e.term}`)
  // References in any case, as the app's explanation validator (outfit-intelligence.ts) rejects them.
  const leaks = leaksPrivate(explanation) || /\b[WO]\d+\b/i.test(explanation)
  const weatherClaim = f.weather === null && WEATHER_CLAIM.test(explanation)
  metrics.safety = !leaks && !weatherClaim
  if (leaks) findings.push('safety_private_or_reference_in_explanation')
  if (weatherClaim) findings.push('safety_weather_claim_without_weather')

  if (output.kind === 'abstain') {
    // An abstention recommends nothing: grounding and the outfit rules do not apply.
    metrics.relevance = f.expect.abstain || f.safety.abstentionAllowed
    if (!metrics.relevance) findings.push('relevance_unneeded_abstention')
  } else {
    metrics.relevance = !f.expect.abstain
    if (!metrics.relevance) findings.push('relevance_should_abstain')
    const items = output.items.map((ref) => byRef.get(ref))
    const foreign = output.items.filter((ref) => !byRef.has(ref))
    const duplicate = new Set(output.items).size !== output.items.length
    const owned = new Set(items.filter((i): i is NonNullable<typeof i> => !!i).map((i) => i.subcategory))
    const invented = inventedGarments(explanation, owned)
    const { unrecommended, colourMismatch } = namedGarments(explanation, f.wardrobe, items.filter((i): i is NonNullable<typeof i> => !!i))
    metrics.grounding = foreign.length === 0 && !duplicate && invented.length === 0 && unrecommended.length === 0 && colourMismatch.length === 0
    for (const r of foreign) findings.push(`grounding_item_not_in_wardrobe:${r}`)
    if (duplicate) findings.push('grounding_duplicate_item')
    for (const w of invented) findings.push(`grounding_explanation_names:${w}`)
    for (const sub of unrecommended) findings.push(`grounding_explanation_names_unrecommended:${sub}`)
    for (const m of colourMismatch) findings.push(`grounding_colour_mismatch:${m}`)
    const ruleItems = output.items.map((ref) => {
      const i = byRef.get(ref)
      return { id: ref, category: i?.category ?? 'unknown', subcategory: i?.subcategory ?? null, colors: i?.colors ?? [], material: i?.material ?? null }
    })
    const disliked = new Set(f.preferences?.dislikedColors ?? [])
    const tags = outfitRuleViolations(ruleItems, {
      wardrobeIds: new Set(byRef.keys()),
      feelsLike: f.weather?.feelsLikeC,
      condition: f.weather?.condition,
      hasOuter: f.wardrobe.some((i) => i.category === 'outerwear'),
      formal: f.expect.formal,
      dislikedColors: disliked,
      // A disliked colour counts only when the wardrobe could have avoided it.
      checkPreference: disliked.size > 0 && f.wardrobe.some((i) => !i.colors.some((c) => disliked.has(c))),
    }).filter((t) => t !== 'validity_foreign_item') // reported under grounding
    findings.push(...tags)
    const has = (prefix: string) => tags.some((t) => t.startsWith(prefix))
    metrics.structure = !has('validity_') && !has('layering_')
    metrics.weather = f.weather ? !has('weather_') : null
    metrics.occasion = f.expect.formal ? !has('occasion_') : null
    metrics.preference = disliked.size ? !has('preference_') : null
  }
  const pass = Object.values(metrics).every((v) => v !== false)
  return { case: f.id, outcome: output.kind, metrics, findings, uzbek, pass, review: reviewCase(f.id, pass, { uzbek }) }
}

export interface FixtureReport {
  version: typeof OUTFIT_FIXTURE_VERSION
  status: 'FIXTURE_ONLY — not real-world evidence'
  cases: number
  passed: number
  /** Per metric: passed / applicable (null when it applied to no case). */
  metrics: Record<FixtureMetric, { passed: number; applicable: number }>
  outcomes: Record<FixtureResult['outcome'], number>
  review: ReviewSummary
  results: FixtureResult[]
}

/** Scores every fixture once; outputs for unknown fixtures or duplicate outputs are refused. */
export function evaluateFixtures(fixtures: readonly OutfitFixture[], outputs: readonly FixtureOutput[]): FixtureReport {
  const fx = new Set<string>()
  for (const f of fixtures) {
    if (fx.has(f.id)) throw new Error(`duplicate fixture ${f.id}`)
    fx.add(f.id)
  }
  const byCase = new Map<string, FixtureOutput>()
  for (const o of outputs) {
    if (!fx.has(o.case)) throw new Error(`output for unknown fixture ${o.case}`)
    if (byCase.has(o.case)) throw new Error(`duplicate output for fixture ${o.case} (each case is scored once)`)
    byCase.set(o.case, o)
  }
  const results = fixtures.map((f) => evaluateFixture(f, byCase.get(f.id)))
  const metrics = Object.fromEntries(
    FIXTURE_METRICS.map((m) => {
      const applicable = results.filter((r) => r.metrics[m] !== null)
      return [m, { passed: applicable.filter((r) => r.metrics[m]).length, applicable: applicable.length }]
    }),
  ) as FixtureReport['metrics']
  const outcomes = { recommendation: 0, abstain: 0, invalid: 0, error: 0, missing: 0 }
  for (const r of results) outcomes[r.outcome]++
  return {
    version: OUTFIT_FIXTURE_VERSION,
    status: 'FIXTURE_ONLY — not real-world evidence',
    cases: results.length,
    passed: results.filter((r) => r.pass).length,
    metrics,
    outcomes,
    review: summarizeReview(results.map((r) => r.review)),
    results,
  }
}

async function main() {
  const fixturesFile = arg('fixtures'), outputsFile = arg('outputs'), outDir = arg('out')
  if (!fixturesFile || !outputsFile || !outDir) throw new Error('usage: --fixtures=<fixtures.json> --outputs=<outputs.json> --out=<new dir outside the repo>')
  assertOutsideRepo(outDir, path.resolve(__dirname, '../../../..'), path)
  const fixtures = z.array(OutfitFixture).parse(JSON.parse(await fs.readFile(fixturesFile, 'utf8')))
  const outputs = z.array(FixtureOutput).parse(JSON.parse(await fs.readFile(outputsFile, 'utf8')))
  const report = evaluateFixtures(fixtures, outputs)
  await fs.mkdir(outDir, { recursive: true })
  await fs.writeFile(path.join(outDir, 'outfit-fixtures.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ version: report.version, status: report.status, cases: report.cases, passed: report.passed, pendingHumanReview: report.review.pendingHumanReview.total }))
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
