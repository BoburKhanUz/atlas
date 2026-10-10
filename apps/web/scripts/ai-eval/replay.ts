/**
 * OFFLINE re-scoring of a finished bake-off run with the current evaluator
 * (evaluator rubric v3.1: v2.1 + the Uzbek output policy). No provider is built and nothing is sent: the stored
 * synthetic outputs in raw-outputs.json are scored again, and the result is
 * written NEXT TO nothing it read — a new directory outside the repository.
 *
 *   bun scripts/ai-eval/replay.ts --run=<bake-off result dir> --out=<new dir outside the repo> [--label=<name>]
 *
 * The baseline is what the run itself recorded (its pass/fail per case and its
 * per-run summaries); the revised result is the current scorers applied to the
 * same outputs. Latency, tokens and cost are not re-scored (they are facts of
 * the run, unchanged).
 */
import crypto from 'crypto'
import { promises as fs } from 'fs'
import path from 'path'
import { arg, assertOutsideRepo, UZBEK_MIN_SHARE } from './eval-common'
import { OUTFIT_CASES_VERSION } from './bakeoff'
import { applyVisionRubric, EVAL_RUBRIC_VERSION } from './eval-rubric'
import { failureReasons, reviewReasons } from './review'
import { caseSetIdentity } from './live-accounting'
import { outfitCases } from './outfit-cases'
import { outfitCaseContext } from './outfit-eval'
import { scoreOutfit, summarizeOutfit, type OutfitOutcome, type OutfitRecord } from './outfit-scoring'
import { stylistCases } from './stylist-cases'
import { scoreStylistCase, stylistCaseSetIdentity } from './stylist-eval'
import { summarizeStylist, type StylistOutcome, type StylistRecord } from './stylist-scoring'
import { ittOf, scoreItem, validateExpected, type DatasetItem, type ItemOutcome } from './vision-scoring'

type Feature = 'vision' | 'stylist' | 'outfit'

interface RawCase {
  run: number
  provider: string
  model: string
  feature: Feature
  case: string
  expected?: DatasetItem['expected']
  output: unknown
  checks: Record<string, unknown>
}

interface RecordedIdentity {
  version?: string | null
  sha256?: string | null
}

interface RawOutputs {
  providerDecision: string
  datasets?: { vision?: RecordedIdentity | null; stylist?: RecordedIdentity | null; outfit?: RecordedIdentity | null }
  cases: RawCase[]
}

export class ReplayIdentityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReplayIdentityError'
  }
}

/**
 * The dataset identity a feature's outputs were produced on, from both run
 * files (they must agree), compared with `current` when given. Missing or
 * different identity stops the replay: outputs are never re-scored against
 * cases they were not produced on.
 */
function verifiedIdentity(feature: Feature, raw: RawOutputs, report: { datasets?: Record<string, RecordedIdentity | null> }, current?: { version: string; sha256: string }) {
  const a = raw.datasets?.[feature], b = report.datasets?.[feature]
  if (!a?.sha256 || !a.version) throw new ReplayIdentityError(`${feature}: raw-outputs.json records no dataset identity (version and sha256); the run cannot be re-scored`)
  if (!b?.sha256 || b.sha256 !== a.sha256 || b.version !== a.version) throw new ReplayIdentityError(`${feature}: raw-outputs.json and bakeoff.json disagree on the dataset identity`)
  if (current && (a.sha256 !== current.sha256 || a.version !== current.version)) {
    throw new ReplayIdentityError(`${feature}: the run used ${a.version} (${a.sha256.slice(0, 12)}…) but the current case set is ${current.version} (${current.sha256.slice(0, 12)}…); re-scoring would apply other expectations`)
  }
  return { version: a.version, sha256: a.sha256 }
}

interface RecordedRun {
  run: number
  live: Array<{ provider: string; failures: Array<{ feature: Feature; case: string; failed: string[] }>; features: Array<Record<string, unknown> & { feature: Feature; status: string }> }>
}

export interface CaseChange {
  feature: Feature
  run: number
  case: string
  baselinePass: boolean
  revisedPass: boolean
  /** Check name → [recorded, revised] for every check whose value differs (new checks show recorded = undefined). */
  changedChecks: Record<string, [unknown, unknown]>
  /** Why the revised verdict fails (FAILURE_CATEGORIES); empty when it passes. */
  revisedFailures: string[]
}

export { failureReasons, reviewReasons } from './review'

export interface FeatureReplay {
  feature: Feature
  provider: string
  model: string
  runs: Array<{
    run: number
    cases: number
    baselinePassed: number
    revisedPassed: number
    baseline: Record<string, unknown>
    revised: Record<string, unknown>
    /** Failed cases per failure category (a case can count in several); stylist and outfit only. */
    revisedFailureCategories?: Record<string, number>
  }>
}

export interface ReplayReport {
  kind: 'OFFLINE_REPLAY'
  evaluator: { rubric: string; uzbekMinShare: number }
  providerDecision: string
  source: { dir: string; files: Record<string, string> }
  generatedAt: string
  features: FeatureReplay[]
  changes: CaseChange[]
  /** Cases the offline evaluator cannot settle; they need a human rating. */
  unresolved: Array<{ feature: Feature; case: string; why: string }>
  /** Individual outputs flagged for human review (the verdict is kept; a reviewer confirms or overturns it with a reason). */
  humanReview: Array<{ feature: Feature; run: number; case: string; pass: boolean; why: string[] }>
}

const fieldRate = (values: Array<boolean | undefined>) => {
  const v = values.filter((x): x is boolean => x !== undefined)
  return v.length ? `${v.filter(Boolean).length}/${v.length}` : null
}
const sha256 = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex')
const pick = (o: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]))

const STYLIST_METRICS = ['passed', 'cases', 'groundingRate', 'hallucinationRate', 'uzbekRate', 'relevanceRate', 'injectionResistance', 'finalValidity']
const OUTFIT_METRICS = ['passed', 'cases', 'groundingRate', 'explanationGroundingRate', 'topAgreementRate', 'weatherSuitability', 'uzbekRate', 'fallbackRate']
const VISION_METRICS = ['passed', 'cases', 'subjectAccuracy', 'subjectAcceptance', 'acceptableAbstentions', 'falseAcceptanceRate', 'falseRejectionRate', 'categoryAccuracy', 'primaryColorAccuracy']

const UNRESOLVED: ReplayReport['unresolved'] = [
  { feature: 'stylist', case: '*', why: 'Uzbek fluency, usefulness and tone are not measured offline: the Uzbek check is a proxy (script, Uzbek evidence, English leakage)' },
  { feature: 'stylist', case: 'nonexistent_item, no_suitable_item', why: 'the premise check is lexical (absence statement in every sentence naming the item), not a semantic proof' },
  { feature: 'stylist', case: '*', why: 'keyword relevance (cases without a rubric entry) remains a weak proxy for task relevance' },
  { feature: 'outfit', case: '*', why: 'explanation quality and Uzbek fluency need native raters' },
  { feature: 'vision', case: 'coat_camel, jeans_blue, shoes_white, jacket_black', why: 'synthetic renders: whether a miss is a model error or a rendering artefact needs real photos' },
]

/** The comparable part of a check value (the Uzbek check gained a share field; its verdict is what matters). */
const comparable = (k: string, v: unknown) => (k === 'uzbek' && v && typeof v === 'object' ? { pass: (v as { pass: boolean }).pass, latin: (v as { latin: boolean }).latin } : v)

/**
 * Checks whose verdict changed. A check the run did not record shows only when
 * it fails (a new check that passes or does not apply changes nothing).
 */
function diff(recorded: Record<string, unknown>, revised: Record<string, unknown>): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {}
  for (const k of new Set([...Object.keys(recorded), ...Object.keys(revised)])) {
    if (!(k in recorded) && (revised[k] === null || revised[k] === true)) continue
    const a = comparable(k, recorded[k]), b = comparable(k, revised[k])
    if (JSON.stringify(a) !== JSON.stringify(b)) out[k] = [a, b]
  }
  return out
}

/** Re-scores every stored output of one run directory. Pure apart from reading the two input files. */
export async function replayRun(dir: string, now: Date = new Date()): Promise<ReplayReport> {
  const rawBuf = await fs.readFile(path.join(dir, 'raw-outputs.json'))
  const reportBuf = await fs.readFile(path.join(dir, 'bakeoff.json'))
  const raw = JSON.parse(rawBuf.toString('utf8')) as RawOutputs
  const recorded = JSON.parse(reportBuf.toString('utf8')) as { runs?: RecordedRun[]; live: RecordedRun['live']; datasets?: Record<string, RecordedIdentity | null> }
  const recordedRuns: RecordedRun[] = recorded.runs ?? [{ run: 1, live: recorded.live }]
  const stylistById = new Map(stylistCases().map((c) => [c.id, c]))
  const outfitById = new Map(outfitCases().map((c) => [c.id, c]))
  // Every feature present is checked before anything is scored.
  const features0 = new Set(raw.cases.map((c) => c.feature))
  if (features0.has('stylist')) verifiedIdentity('stylist', raw, recorded, stylistCaseSetIdentity())
  if (features0.has('outfit')) verifiedIdentity('outfit', raw, recorded, { version: OUTFIT_CASES_VERSION, sha256: caseSetIdentity('', '', OUTFIT_CASES_VERSION, outfitCases()).sha256 })
  const visionIdentity = features0.has('vision') ? verifiedIdentity('vision', raw, recorded) : null

  const changes: CaseChange[] = []
  const humanReview: ReplayReport['humanReview'] = []
  const byKey = new Map<string, { feature: Feature; provider: string; model: string; runs: Map<number, RawCase[]> }>()
  for (const c of raw.cases) {
    const key = `${c.feature}|${c.provider}|${c.model}`
    if (!byKey.has(key)) byKey.set(key, { feature: c.feature, provider: c.provider, model: c.model, runs: new Map() })
    const g = byKey.get(key)!
    if (!g.runs.has(c.run)) g.runs.set(c.run, [])
    g.runs.get(c.run)!.push(c)
  }

  const features: FeatureReplay[] = []
  for (const g of byKey.values()) {
    const fr: FeatureReplay = { feature: g.feature, provider: g.provider, model: g.model, runs: [] }
    for (const [run, cases] of [...g.runs.entries()].sort((a, b) => a[0] - b[0])) {
      const rec = recordedRuns.find((r) => r.run === run)?.live.find((l) => l.provider === g.provider)
      const failedCases = new Set((rec?.failures ?? []).filter((f) => f.feature === g.feature).map((f) => f.case))
      const baselineSummary = rec?.features.find((f) => f.feature === g.feature) ?? {}
      const baselinePass = (id: string) => !failedCases.has(id)
      let revised: Record<string, unknown>
      let revisedPassed = 0
      const categories: Record<string, number> = {}
      const failed = (feature: 'stylist' | 'outfit', pass: boolean, checks: object, caseId: string, unscorable?: string) => {
        const review = reviewReasons(checks as Record<string, unknown>)
        if (review.length) humanReview.push({ feature, run, case: caseId, pass, why: review })
        // An unscorable case (missing rubric metadata) is not a model failure: its own category, never mixed with the others.
        const why = unscorable ? ['unscorable'] : pass ? [] : failureReasons(feature, checks as Record<string, unknown>)
        for (const w of why) categories[w] = (categories[w] ?? 0) + 1
        return why
      }
      if (g.feature === 'stylist') {
        const records: StylistRecord[] = cases.map((c) => {
          const sc = stylistById.get(c.case)
          if (!sc) throw new Error(`unknown stylist case ${c.case}: the case set changed since the run`)
          const { checks, pass, unscorable } = scoreStylistCase(sc, c.output as StylistOutcome)
          changes.push({ feature: 'stylist', run, case: c.case, baselinePass: baselinePass(c.case), revisedPass: pass, changedChecks: diff(c.checks, checks as unknown as Record<string, unknown>), revisedFailures: failed('stylist', pass, checks, c.case, unscorable) })
          return { case: c.case, tags: sc.tags, provider: c.provider, model: c.model, latencyMs: 0, calls: 0, requests: 0, outcome: c.output as StylistOutcome, checks, pass }
        })
        revisedPassed = records.filter((r) => r.pass).length
        revised = pick(summarizeStylist(records, 'TESTED') as unknown as Record<string, unknown>, STYLIST_METRICS)
      } else if (g.feature === 'outfit') {
        const records: OutfitRecord[] = cases.map((c) => {
          const oc = outfitById.get(c.case)
          if (!oc) throw new Error(`unknown outfit case ${c.case}: the case set changed since the run`)
          const ctx = outfitCaseContext(oc)
          const { checks, pass } = scoreOutfit(ctx, c.output as OutfitOutcome)
          changes.push({ feature: 'outfit', run, case: c.case, baselinePass: baselinePass(c.case), revisedPass: pass, changedChecks: diff(c.checks, checks as unknown as Record<string, unknown>), revisedFailures: failed('outfit', pass, checks, c.case) })
          return { case: c.case, tags: oc.tags, provider: c.provider, model: c.model, candidates: ctx.candidates.length, latencyMs: 0, calls: 0, requests: 0, outcome: c.output as OutfitOutcome, checks, pass }
        })
        revisedPassed = records.filter((r) => r.pass).length
        revised = pick(summarizeOutfit(records, 'TESTED') as unknown as Record<string, unknown>, OUTFIT_METRICS)
      } else {
        const items = applyVisionRubric(visionIdentity!, cases.map((c) => ({ id: c.case, expected: c.expected! })), validateExpected)
        const scored = cases.map((c, i) => {
          const s = scoreItem(items[i].expected, c.output as ItemOutcome)
          const recordedCheck = { subjectCorrect: c.checks.subjectCorrect }
          const revisedCheck = s.subjectOutcome === 'acceptable_abstention' ? { subjectCorrect: s.subjectCorrect, subjectOutcome: s.subjectOutcome } : { subjectCorrect: s.subjectCorrect }
          // Baseline vision "passed" was the strict subject match.
          changes.push({ feature: 'vision', run, case: c.case, baselinePass: c.checks.subjectCorrect === true, revisedPass: s.subjectAcceptable, changedChecks: diff(recordedCheck, revisedCheck), revisedFailures: s.subjectAcceptable ? [] : ['subject'] })
          return { c, s, garment: items[i].expected.subject === 'single_garment', accepted: (c.output as ItemOutcome).kind === 'garment', rejected: (c.output as ItemOutcome).kind === 'rejected' }
        })
        const n = scored.length
        const r4 = (x: number) => Math.round(x * 10_000) / 10_000
        const garments = scored.filter((x) => x.garment), others = scored.filter((x) => !x.garment)
        revisedPassed = scored.filter((x) => x.s.subjectAcceptable).length
        revised = {
          passed: revisedPassed,
          cases: n,
          subjectAccuracy: r4(scored.filter((x) => x.s.subjectCorrect).length / n),
          subjectAcceptance: r4(revisedPassed / n),
          acceptableAbstentions: scored.filter((x) => x.s.subjectOutcome === 'acceptable_abstention').length,
          falseAcceptanceRate: others.length ? r4(others.filter((x) => x.accepted).length / others.length) : null,
          falseRejectionRate: garments.length ? r4(garments.filter((x) => x.rejected).length / garments.length) : null,
          // Field accuracies over accepted garments with that field labelled; fullyCorrect = subject acceptable and every labelled field right.
          categoryAccuracy: fieldRate(scored.map((x) => x.s.fields.category)),
          subcategoryAccuracy: fieldRate(scored.map((x) => x.s.fields.subcategory)),
          primaryColorAccuracy: fieldRate(scored.map((x) => x.s.fields.primaryColor)),
          fullyCorrect: scored.filter((x) => x.s.subjectAcceptable && Object.values(x.s.fields).every(Boolean)).length,
          // Intention-to-treat (vision-itt-v1): every dataset item in the denominator; added next to the metrics above, which are unchanged.
          itt: ittOf(cases.map((c) => ({ item: c.case, outcome: c.output as ItemOutcome })), new Map(items.map((i) => [i.id, i.expected]))),
        }
      }
      const baselinePassed = g.feature === 'vision' ? cases.filter((c) => c.checks.subjectCorrect === true).length : cases.filter((c) => baselinePass(c.case)).length
      fr.runs.push({
        run, cases: cases.length, baselinePassed, revisedPassed,
        baseline: pick(baselineSummary as Record<string, unknown>, g.feature === 'vision' ? VISION_METRICS : g.feature === 'stylist' ? STYLIST_METRICS : OUTFIT_METRICS),
        revised,
        ...(g.feature === 'vision' ? {} : { revisedFailureCategories: categories }),
      })
    }
    features.push(fr)
  }

  return {
    kind: 'OFFLINE_REPLAY',
    evaluator: { rubric: EVAL_RUBRIC_VERSION, uzbekMinShare: UZBEK_MIN_SHARE },
    providerDecision: raw.providerDecision,
    source: { dir, files: { 'raw-outputs.json': sha256(rawBuf), 'bakeoff.json': sha256(reportBuf) } },
    generatedAt: now.toISOString(),
    features,
    changes: changes.filter((c) => c.baselinePass !== c.revisedPass || Object.keys(c.changedChecks).length > 0),
    unresolved: UNRESOLVED,
    humanReview,
  }
}

const pct = (v: unknown) => (typeof v === 'number' ? (v <= 1 && !Number.isInteger(v) ? `${(v * 100).toFixed(1)}%` : String(v)) : '—')

export function replayMarkdown(r: ReplayReport, label: string): string {
  const flips = r.changes.filter((c) => c.baselinePass !== c.revisedPass)
  return [
    `# Offline re-scoring — ${label}`,
    '',
    `**${r.providerDecision}.** OFFLINE REPLAY of stored synthetic outputs with evaluator \`${r.evaluator.rubric}\`; no provider was called. Synthetic data, 3 repeated runs of the same small case sets: not real-world quality.`,
    '',
    `Source: \`${r.source.dir}\` · raw-outputs.json \`${r.source.files['raw-outputs.json']}\` · bakeoff.json \`${r.source.files['bakeoff.json']}\` · generated ${r.generatedAt}`,
    '',
    '| feature | provider / model | run | passed: baseline → revised | revised metrics |',
    '|---|---|---|---|---|',
    ...r.features.flatMap((f) => f.runs.map((x) => `| ${f.feature} | ${f.provider} / ${f.model} | ${x.run} | ${x.baselinePassed}/${x.cases} → ${x.revisedPassed}/${x.cases} | ${Object.entries(x.revised).filter(([k]) => k !== 'passed' && k !== 'cases').map(([k, v]) => `${k} ${pct(v)}`).join(' · ')} |`)),
    '',
    '## Cases whose pass/fail changed',
    '',
    flips.length ? '| feature | run | case | baseline | revised | changed checks (recorded → revised) |' : 'None.',
    ...(flips.length ? ['|---|---|---|---|---|---|'] : []),
    ...flips.map((c) => `| ${c.feature} | ${c.run} | ${c.case} | ${c.baselinePass ? 'pass' : 'FAIL'} | ${c.revisedPass ? 'pass' : `FAIL (${c.revisedFailures.join(', ')})`} | ${Object.entries(c.changedChecks).map(([k, [a, b]]) => `${k}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`).join('; ')} |`),
    '',
    '## Revised failures by category (stylist and outfit)',
    '',
    ...r.features.filter((f) => f.feature !== 'vision').flatMap((f) => f.runs.map((x) => `- ${f.feature} ${f.provider} run ${x.run}: ${Object.entries(x.revisedFailureCategories ?? {}).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none'}`)),
    '',
    '## Flagged for human review (verdict kept)',
    '',
    ...(r.humanReview.length ? r.humanReview.map((h) => `- ${h.feature} run ${h.run} \`${h.case}\` (${h.pass ? 'pass' : 'FAIL'}): ${h.why.join('; ')}`) : ['None.']),
    '',
    '## Not resolved offline',
    '',
    ...r.unresolved.map((u) => `- ${u.feature} (${u.case}): ${u.why}`),
  ].join('\n') + '\n'
}

async function main() {
  const runDir = arg('run'), outDir = arg('out')
  if (!runDir || !outDir) throw new Error('usage: --run=<bake-off result dir> --out=<new dir outside the repo> [--label=<name>]')
  const repoRoot = path.resolve(__dirname, '../../../..')
  assertOutsideRepo(outDir, repoRoot, path)
  if (path.resolve(outDir) === path.resolve(runDir)) throw new Error('--out must differ from --run (the source run is never written)')
  await fs.mkdir(outDir, { recursive: true })
  for (const f of ['replay.json', 'replay.md']) {
    if (await fs.stat(path.join(outDir, f)).then(() => true, () => false)) throw new Error(`${f} already exists in --out (nothing is overwritten)`)
  }
  const report = await replayRun(path.resolve(runDir))
  await fs.writeFile(path.join(outDir, 'replay.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
  await fs.writeFile(path.join(outDir, 'replay.md'), replayMarkdown(report, arg('label') ?? path.basename(runDir)), { flag: 'wx' })
  console.log(JSON.stringify({ features: report.features.map((f) => ({ feature: f.feature, provider: f.provider, runs: f.runs.map((x) => `${x.baselinePassed}->${x.revisedPassed}/${x.cases}`) })), changed: report.changes.length }))
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
