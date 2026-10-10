/**
 * Phase 5.2 real-data validation run. See docs/ai/real-data-validation.md.
 *
 *   bun scripts/ai-eval/real-data/validate.ts --init --root=<dir outside the repo>
 *   bun scripts/ai-eval/real-data/validate.ts --root=<dir> --out=<dir outside the repo> \
 *     [--purpose=evaluation|final_evaluation|prompt_development] [--max-calls=N] [--max-cost-usd=X] \
 *     [--transmit-constructed]   # allow provider calls for the constructed stylist corpus
 *
 * - vision/ and color-profile/ datasets are loaded only through their
 *   manifests (governance gate, frozen hash, immutable version registry);
 *   a dataset that fails any gate is BLOCKED and nothing is sent.
 * - Colour profiles are analysed locally by the deterministic analyser.
 * - The constructed stylist corpus runs against a provider only with
 *   --transmit-constructed, credentials, explicit models and --max-calls;
 *   human ratings (stylist/ratings.json + stylist/blinding-key.json) are
 *   summarised when present, else NOT_EVALUATED.
 * - The realistic outfit contexts run against the deterministic engine.
 * - The report records provider, model, prompt, schema, preprocessing and
 *   evaluation versions, dataset ids/versions/hashes, the app commit, a run
 *   id and the time — never secrets, personal data, images or responses.
 *   It always says NO FINAL PROVIDER SELECTED.
 */
import { execFileSync } from 'child_process'
import crypto from 'crypto'
import { promises as fs } from 'fs'
import path from 'path'
import { COLOR_ANALYSIS_VERSION } from '../../../src/lib/ai/color-analysis'
import { VISION_ANALYSIS_VERSION } from '../../../src/lib/ai/garment-analysis'
import { OUTFIT_ENGINE_VERSION } from '../../../src/lib/ai/outfit-config'
import { OUTFIT_PROMPT_VERSION } from '../../../src/lib/ai/outfit-intelligence'
import type { LLMProvider, VisionProvider } from '../../../src/lib/ai/providers/types'
import { STYLIST_PROMPT_VERSION } from '../../../src/lib/ai/stylist'
import { configuredModel, PROVIDER_DECISION } from '../bakeoff'
import { isBudgetablePrice } from '../cost-bounds'
import { arg, assertOutsideRepo, llmProviderFromEnv, type EvalProviderName } from '../eval-common'
import { accountSection, assertCapForLive, CallBudget, CallLedger, caseResult, caseSetIdentity, configuredPrice, costAccounting, countedLLM, parseMaxCalls, parseMaxCost, planCalls, type CaseResult, type CostAccounting, type SectionAccounting } from '../live-accounting'
import { ISOLATION_CHECK_KIND, precheckRubricSet, realisticStylistRubricSet, type RubricSet } from '../case-rubric'
import { reviewCase, summarizeReview, type ReviewSummary } from '../review'
import { runStylistCase } from '../stylist-eval'
import { summarizeStylist, type StylistRecord, type StylistSummary } from '../stylist-scoring'
import { runColorValidation, type ColorReport } from './color-validation'
import { loadDataset, registerVersion, type Purpose } from './dataset'
import { outfitRealisticCases, runOutfitRealistic, type OutfitValidationReport } from './outfit-realistic'
import { BlindingKey, parseRatings, summarizeRatings, type RatingSummary } from './ratings'
import { PREPROCESSING_VERSION, runRealVision, type RealVisionReport } from './real-vision'
import { STYLIST_REALISTIC_VERSION, stylistRealisticCases } from './stylist-realistic-cases'

export const EVALUATION_VERSION = 'real-validation-v1'
const REPO_ROOT = path.resolve(__dirname, '../../../../..')
type Env = Record<string, string | undefined>

export interface StylistLive {
  provider: EvalProviderName
  status: 'TESTED' | 'TEST_ONLY' | 'NOT_TESTED' | 'BLOCKED'
  reason: string | null
  model: string | null
  summary: StylistSummary | null
  accounting: SectionAccounting | null
  /** Failed automatic checks, by case id (injection cases flagged). */
  failures: Array<{ case: string; failed: string[]; injection: boolean }>
  /**
   * Automatic verdicts next to human-review status (review.ts): flagged cases
   * are PENDING_HUMAN_REVIEW, never a final pass; unscorable cases (missing
   * rubric metadata) are counted apart. Null when the provider did not run.
   */
  review: ReviewSummary | null
}

export interface ValidationReport {
  evaluationVersion: string
  providerDecision: typeof PROVIDER_DECISION
  reproducibility: {
    runId: string
    timestamp: string
    appCommit: string | null
    appTreeClean: boolean | null
    purpose: Purpose
    versions: { visionPrompt: string; stylistPrompt: string; outfitPrompt: string; outfitEngine: string; colorAnalysis: string; preprocessing: string }
  }
  budget: { maxCalls: number | null; maxCostUsd: number | null; attemptsUsed: number; exhausted: string | null; stopDetail: string | null; costAccounting: CostAccounting }
  vision: RealVisionReport[]
  colorProfile: ColorReport[]
  stylist: {
    corpus: { id: string; version: string; sha256: string; cases: number; uzbekLatin: number; uzbekCyrillic: number; kind: 'constructed'; rubricSet: string; isolationCheck: string }
    live: StylistLive[]
    humanRatings: RatingSummary
  }
  outfit: OutfitValidationReport & { corpus: { sha256: string } }
  /** BLOCKED / NOT_EVALUATED areas, each with the reason. */
  blockers: string[]
}

export interface ValidateOptions {
  root: string | null
  purpose: Purpose
  maxCalls: number | null
  maxCostUsd: number | null
  transmitConstructed: boolean
  now: Date
  runId?: string
  appCommit?: { sha: string | null; clean: boolean | null }
  providers?: { llm?: (provider: EvalProviderName, model: string, env: Env) => LLMProvider; vision?: (provider: EvalProviderName, model: string, env: Env) => VisionProvider }
  /** The stylist corpus's rubric set (default: the built-in constructed-v1 set); tests inject another. */
  stylistRubricSet?: RubricSet
  sleep?: (ms: number) => Promise<void>
}

async function datasetDirs(root: string, type: string): Promise<string[]> {
  const out: string[] = []
  const base = path.join(root, type)
  let ids: string[] = []
  try {
    ids = (await fs.readdir(base, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort()
  } catch {
    return out
  }
  for (const id of ids) {
    for (const v of (await fs.readdir(path.join(base, id), { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
      try {
        await fs.access(path.join(base, id, v, 'manifest.json'))
        out.push(path.join(base, id, v))
      } catch {
        // not a dataset version
      }
    }
  }
  return out
}

function gitCommit(): { sha: string | null; clean: boolean | null } {
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim().length > 0
    return { sha, clean: !dirty }
  } catch {
    return { sha: null, clean: null }
  }
}

/** Every corpus message is Uzbek by construction; the split is by script (the app answers in Latin). */
const CYRILLIC = /[\u0400-\u04FF]/

export async function runValidation(env: Env, opts: ValidateOptions): Promise<ValidationReport> {
  const today = opts.now.toISOString().slice(0, 10)
  const blockers: string[] = []
  const budget = new CallBudget(opts.maxCalls, opts.maxCostUsd)

  // Stylist corpus plan first: the call cap is checked before anything is built.
  const corpus = stylistRealisticCases()
  const corpusId = caseSetIdentity('stylist-realistic', 'apps/web/scripts/ai-eval/real-data/stylist-realistic-cases.ts', STYLIST_REALISTIC_VERSION, corpus)
  // Every corpus case is scored with its declared rubric (premise / isolation) or reported UNSCORABLE; never a silent keyword fallback.
  const rubrics = { set: opts.stylistRubricSet ?? realisticStylistRubricSet(), dataset: { version: STYLIST_REALISTIC_VERSION, sha256: corpusId.sha256 } }
  const textEligible = (['gemini', 'openai'] as const).filter((p) => opts.transmitConstructed && !!env[p === 'gemini' ? 'GEMINI_API_KEY' : 'OPENAI_API_KEY']?.trim() && !!configuredModel(p, env))
  const plan = planCalls(textEligible.map((provider) => ({ provider, feature: 'stylist' as const, cases: corpus.length })), 1, opts.maxCalls, opts.maxCostUsd)
  assertCapForLive(plan)
  // The rubric set must belong to this corpus before any provider is built (RubricIdentityError otherwise).
  if (textEligible.length) precheckRubricSet(rubrics.set, rubrics.dataset, corpus.map((c) => c.id))
  // A dollar budget needs an exact-model price for every provider that will be called (each attempt is checked again).
  if (opts.maxCostUsd !== null) {
    const unpriced = textEligible.filter((p) => !isBudgetablePrice(configuredPrice(p, configuredModel(p, env), 'llm', env)))
    if (unpriced.length) throw new Error(`--max-cost-usd needs a price above zero for the exact model (AI_LLM_PROVIDER + AI_LLM_MODEL + AI_LLM_PRICE_*); missing for ${unpriced.join(', ')}`)
  }

  const vision: RealVisionReport[] = []
  const colorProfile: ColorReport[] = []
  if (!opts.root) blockers.push('BLOCKED — dataset unavailable: no --root with governed real datasets (real clothing photos, consented selfies)')
  else {
    const registry = path.join(opts.root, 'registry.json')
    for (const dir of await datasetDirs(opts.root, 'vision')) {
      const ds = await loadDataset(dir, REPO_ROOT)
      await registerVersion(registry, REPO_ROOT, ds.manifest, opts.now)
      vision.push(await runRealVision(ds, env, { purpose: opts.purpose, today, budget, providers: opts.providers, sleep: opts.sleep }))
    }
    for (const dir of await datasetDirs(opts.root, 'color-profile')) {
      const ds = await loadDataset(dir, REPO_ROOT)
      await registerVersion(registry, REPO_ROOT, ds.manifest, opts.now)
      colorProfile.push(await runColorValidation(ds, { purpose: opts.purpose, today }))
    }
    if (!vision.length) blockers.push('BLOCKED — dataset unavailable: no real clothing dataset under vision/')
    if (!colorProfile.length) blockers.push('BLOCKED — dataset unavailable: no consented selfie dataset under color-profile/')
  }
  for (const v of vision) for (const p of v.providers) if (p.status !== 'TESTED' && p.status !== 'TEST_ONLY') blockers.push(`vision ${v.dataset.id}@${v.dataset.version} ${p.provider}: ${p.status} — ${p.reason}`)
  for (const c of colorProfile) if (c.status !== 'EVALUATED') blockers.push(`color-profile ${c.dataset.id}@${c.dataset.version}: ${c.status} — ${c.reason}`)

  // Stylist: the constructed corpus, live only when explicitly allowed.
  const live: StylistLive[] = []
  for (const provider of ['gemini', 'openai'] as const) {
    const model = configuredModel(provider, env)
    const key = provider === 'gemini' ? 'GEMINI_API_KEY' : 'OPENAI_API_KEY'
    const reason = !opts.transmitConstructed
      ? 'provider transmission of the constructed corpus not allowed (--transmit-constructed)'
      : !env[key]?.trim()
        ? `no ${key} in the environment`
        : !model
          ? 'no configured model'
          : null
    if (reason) {
      live.push({ provider, status: opts.transmitConstructed ? 'NOT_TESTED' : 'BLOCKED', reason, model, summary: null, accounting: null, failures: [], review: null })
      continue
    }
    const price = configuredPrice(provider, model!, 'llm', env)
    const ledger = new CallLedger(budget, price)
    const base = (opts.providers?.llm ?? ((p, m, e) => llmProviderFromEnv(p, m, e)))(provider, model!, env)
    const p = countedLLM(base, ledger)
    const records: StylistRecord[] = [], results: CaseResult[] = []
    for (const c of corpus) {
      const r = await runStylistCase(p, c, rubrics)
      records.push(r)
      results.push(caseResult(r.latencyMs, r.requests, r.outcome, ledger.endCase()))
    }
    live.push({
      provider,
      status: opts.providers?.llm ? 'TEST_ONLY' : 'TESTED',
      reason: null,
      model,
      summary: summarizeStylist(records, 'TESTED'),
      accounting: accountSection('stylist', ledger, results, price),
      failures: records.filter((r) => !r.pass).map((r) => ({ case: r.case, failed: Object.entries(r.checks).filter(([, v]) => v === false).map(([k]) => k), injection: r.tags.includes('injection') })),
      review: summarizeReview(records.map((r) => reviewCase(r.case, r.pass, r.checks as unknown as Record<string, unknown>, r.unscorable))),
    })
  }
  for (const l of live) if (l.status === 'BLOCKED' || l.status === 'NOT_TESTED') blockers.push(`stylist ${l.provider}: ${l.status} — ${l.reason}`)
  for (const l of live) {
    if (l.review?.pendingHumanReview.total) blockers.push(`stylist ${l.provider}: ${l.review.pendingHumanReview.total} case(s) PENDING HUMAN REVIEW — their automatic verdicts are not final`)
    if (l.review?.unscorable) blockers.push(`stylist ${l.provider}: ${l.review.unscorable} case(s) UNSCORABLE — required rubric metadata is missing`)
  }

  let humanRatings = summarizeRatings(null, null)
  if (opts.root) {
    try {
      const ratings = parseRatings(JSON.parse(await fs.readFile(path.join(opts.root, 'stylist', 'ratings.json'), 'utf8')))
      const key = BlindingKey.parse(JSON.parse(await fs.readFile(path.join(opts.root, 'stylist', 'blinding-key.json'), 'utf8')))
      humanRatings = summarizeRatings(ratings, key)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }
  if (humanRatings.status === 'NOT_EVALUATED') blockers.push('stylist human ratings: NOT_EVALUATED — no native Uzbek raters / blind ratings')

  const outfit = runOutfitRealistic()
  const commit = opts.appCommit ?? gitCommit()
  return {
    evaluationVersion: EVALUATION_VERSION,
    providerDecision: PROVIDER_DECISION,
    reproducibility: {
      runId: opts.runId ?? crypto.randomUUID(),
      timestamp: opts.now.toISOString(),
      appCommit: commit.sha,
      appTreeClean: commit.clean,
      purpose: opts.purpose,
      versions: { visionPrompt: VISION_ANALYSIS_VERSION, stylistPrompt: STYLIST_PROMPT_VERSION, outfitPrompt: OUTFIT_PROMPT_VERSION, outfitEngine: OUTFIT_ENGINE_VERSION, colorAnalysis: COLOR_ANALYSIS_VERSION, preprocessing: PREPROCESSING_VERSION },
    },
    budget: { maxCalls: opts.maxCalls, maxCostUsd: opts.maxCostUsd, attemptsUsed: budget.attemptsUsed, exhausted: budget.exhausted, stopDetail: budget.stopDetail, costAccounting: costAccounting(budget.cost) },
    vision,
    colorProfile,
    stylist: {
      corpus: { id: corpusId.name, version: STYLIST_REALISTIC_VERSION, sha256: corpusId.sha256, cases: corpus.length, uzbekLatin: corpus.filter((c) => !CYRILLIC.test(c.message)).length, uzbekCyrillic: corpus.filter((c) => CYRILLIC.test(c.message)).length, kind: 'constructed', rubricSet: rubrics.set.name, isolationCheck: ISOLATION_CHECK_KIND },
      live,
      humanRatings,
    },
    outfit: { ...outfit, corpus: { sha256: caseSetIdentity('outfit-realistic', '', '', outfitRealisticCases()).sha256 } },
    blockers,
  }
}

const frac = (c: { correct: number; scored: number } | string) => (typeof c === 'string' ? c : c.scored ? `${c.correct}/${c.scored}` : 'N/A (0 scored)')

export function validationMarkdown(r: ValidationReport): string {
  return [
    '# ATLAS real-data validation (Phase 5.2)',
    '',
    `**${r.providerDecision}.** Run ${r.reproducibility.runId} · ${r.reproducibility.timestamp} · commit ${r.reproducibility.appCommit ?? '—'}${r.reproducibility.appTreeClean === false ? ' (uncommitted changes)' : ''} · purpose ${r.reproducibility.purpose}`,
    '',
    `Versions: ${Object.entries(r.reproducibility.versions).map(([k, v]) => `${k} ${v}`).join(' · ')}`,
    '',
    '## Vision (real clothing)',
    '',
    ...(r.vision.length ? r.vision.flatMap((v) => [`- ${v.dataset.id}@${v.dataset.version} (${v.dataset.kind}, ${v.dataset.casesInSplit}/${v.dataset.cases} cases in split, sha256 ${v.dataset.sha256}) — governance ${v.governance.status}`, ...v.providers.map((p) => `  - ${p.provider}: ${p.status}${p.reason ? ` — ${p.reason}` : ''}${p.scores ? ` · category ${frac(p.scores.fields.category)} · primary colour ${frac(p.scores.fields.primaryColor)} · false acceptance ${frac(p.scores.rejection.falseAcceptance)} · false rejection ${frac(p.scores.rejection.falseRejection)}` : ''}`)]) : ['- BLOCKED — dataset unavailable']),
    '',
    '## Colour profile (consented selfies)',
    '',
    ...(r.colorProfile.length ? r.colorProfile.map((c) => `- ${c.dataset.id}@${c.dataset.version}: ${c.status}${c.reason ? ` — ${c.reason}` : ''}${c.scores ? ` · season ${frac(c.scores.season)} · undertone ${frac(c.scores.undertone)} · contrast ${frac(c.scores.contrast)}` : ''}`) : ['- BLOCKED — dataset unavailable']),
    '',
    '## Stylist (constructed realistic corpus)',
    '',
    `- corpus ${r.stylist.corpus.version}: ${r.stylist.corpus.cases} Uzbek cases (${r.stylist.corpus.uzbekLatin} Latin, ${r.stylist.corpus.uzbekCyrillic} Cyrillic input), sha256 ${r.stylist.corpus.sha256}`,
    `- rubric set ${r.stylist.corpus.rubricSet} (premise / isolation per case); isolation check: ${r.stylist.corpus.isolationCheck}`,
    ...r.stylist.live.flatMap((l) => [
      `- ${l.provider}: ${l.status}${l.reason ? ` — ${l.reason}` : ''}${l.summary ? ` · grounding ${l.summary.groundingRate ?? 'N/A'} · hallucination ${l.summary.hallucinationRate ?? 'N/A'}` : ''}`,
      ...(l.review
        ? [
            `  - automatic: ${l.review.automaticPass} pass · ${l.review.automaticFail} fail · ${l.review.unscorable} unscorable — final (no review pending): ${l.review.finalPass} pass · ${l.review.finalFail} fail · **${l.review.pendingHumanReview.total} PENDING HUMAN REVIEW** (automatic pass ${l.review.pendingHumanReview.automaticPass}, fail ${l.review.pendingHumanReview.automaticFail})`,
            ...l.review.flagged.map((f) => `    - \`${f.case}\` ${f.finalStatus} (automatic ${f.automaticVerdict}): ${f.unscorableReason ?? f.reviewReasons.join('; ')}`),
          ]
        : []),
    ]),
    `- human ratings: ${r.stylist.humanRatings.status}`,
    '',
    '## Outfit (constructed realistic contexts, deterministic engine)',
    '',
    `- cases passing every check ${frac(r.outfit.casesPassing)} · deterministic ${frac(r.outfit.deterministic)} · colour harmony ${r.outfit.colorHarmony}`,
    ...r.outfit.failures.map((f) => `  - ${f.case}: ${f.failed.join(', ')}`),
    '',
    '## Blockers',
    '',
    ...(r.blockers.length ? r.blockers.map((b) => `- ${b}`) : ['- none']),
    '',
  ].join('\n') + '\n'
}

const TEMPLATE_MANIFEST = {
  manifestVersion: 1,
  datasetId: 'replace_me',
  datasetVersion: 'v1',
  datasetType: 'vision',
  kind: 'real',
  cases: 1,
  sha256: '0'.repeat(64),
  collectionDate: '2026-01-01',
  owner: 'ai_eval_team',
  collectionSource: 'consented_participants',
  consent: { status: 'pending', covers: [] },
  permittedUses: ['local_evaluation'],
  retentionUntil: '2026-12-31',
  deletion: { process: 'secure_delete_after_validation', responsible: 'ai_eval_team' },
  access: 'evaluation_operator_only',
  encryptionAtRest: true,
  rawStorageAllowed: false,
  derivedLabelsAllowed: true,
  leaveEnvironment: false,
  providerTransmission: { allowed: false, providers: [] },
  legalReview: 'PENDING',
  annotation: { status: 'none', version: 'none' },
  holdout: [],
  sensitivity: 'standard',
}

/** Creates the empty dataset structure (no data) with a template manifest whose consent is pending. */
export async function initRoot(root: string): Promise<void> {
  assertOutsideRepo(root, REPO_ROOT, path)
  for (const type of ['vision', 'color-profile', 'stylist', 'outfit']) await fs.mkdir(path.join(root, type), { recursive: true })
  await fs.writeFile(path.join(root, 'TEMPLATE.manifest.json'), JSON.stringify(TEMPLATE_MANIFEST, null, 2) + '\n')
  await fs.writeFile(path.join(root, 'README.txt'), 'ATLAS real-data validation root (outside Git). See docs/ai/real-data-validation.md.\nEach dataset: <type>/<datasetId>/<version>/{manifest.json, cases.json, annotations.json, files/}.\nNever add personal data to manifests. Delete raw files on the retention date.\n')
}

async function main() {
  const root = arg('root') ? path.resolve(arg('root')!) : null
  if (process.argv.includes('--init')) {
    if (!root) throw new Error('--init needs --root=<dir outside the repo>')
    await initRoot(root)
    console.log(JSON.stringify({ initialized: true }))
    return
  }
  const outDir = arg('out')
  if (!outDir) throw new Error('usage: --out=<dir outside the repo> [--root=<dir>] [--purpose=…] [--max-calls=N]')
  assertOutsideRepo(outDir, REPO_ROOT, path)
  const purpose = (arg('purpose') ?? 'evaluation') as Purpose
  if (!['evaluation', 'final_evaluation', 'prompt_development'].includes(purpose)) throw new Error('--purpose must be evaluation, final_evaluation or prompt_development')
  const report = await runValidation(process.env, {
    root,
    purpose,
    maxCalls: parseMaxCalls(arg('max-calls') ?? process.env.AI_EVAL_MAX_CALLS),
    maxCostUsd: parseMaxCost(arg('max-cost-usd') ?? process.env.AI_EVAL_MAX_COST_USD),
    transmitConstructed: process.argv.includes('--transmit-constructed'),
    now: new Date(),
  })
  await fs.mkdir(outDir, { recursive: true })
  await fs.writeFile(path.join(outDir, 'real-validation.json'), JSON.stringify(report, null, 2) + '\n')
  await fs.writeFile(path.join(outDir, 'real-validation.md'), validationMarkdown(report))
  console.log(JSON.stringify({ runId: report.reproducibility.runId, vision: report.vision.length, colorProfile: report.colorProfile.length, blockers: report.blockers.length, providerDecision: report.providerDecision }))
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
