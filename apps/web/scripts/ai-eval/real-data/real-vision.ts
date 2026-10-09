/**
 * Real clothing validation (Phase 5.2): the app's vision pipeline
 * (prepareVisionImage → garment schema → interpretGarmentOutput → colour
 * cross-check, the app's single retry) over a governed, annotated dataset,
 * scored against independent human ground truth. Reuses the Phase 5.1
 * accounting: per-section ledger, shared call budget, circuit breaker,
 * per-image integrity check.
 *
 * Every provider gets the same frozen images, preprocessing, prompt and
 * schema version, in the same order; there is no provider-specific tuning.
 * A provider runs only when governance AND provider transmission are
 * allowed for this dataset, credentials and an explicit model exist, and a
 * call cap is set; otherwise its section is BLOCKED or NOT_TESTED with the
 * reason, and nothing is sent.
 *
 * Output: counts with numerators and denominators, per field; rejection
 * behaviour; a PRELIMINARY confidence analysis (not calibration). No image,
 * file name, path or provider response is written.
 */
import { promises as fs } from 'fs'
import path from 'path'
import sharp from 'sharp'
import { prepareVisionImage } from '../../../src/lib/ai/providers/vision-input'
import type { VisionProvider } from '../../../src/lib/ai/providers/types'
import { bakeoffVisionConfig, configuredVisionModel, realVision } from '../bakeoff'
import { isBudgetablePrice, isOpenAIPatchModel } from '../cost-bounds'
import type { EvalProviderName } from '../eval-common'
import { accountSection, CallBudget, CallLedger, caseResult, configuredPrice, DatasetIntegrityError, retryingVision, sha256Hex, type CaseResult, type SectionAccounting } from '../live-accounting'
import { evaluateVisionConfig } from '../vision-eval'
import type { ItemOutcome, ItemRecord } from '../vision-scoring'
import { agreement, annotationLimitations, fieldTruth, type AgreementStats, type FieldTruth } from './annotations'
import { casesFor, type LoadedDataset, type Purpose } from './dataset'
import { governanceGate, providerTransmissionGate } from './governance'

export const REAL_VISION_FIELDS = ['category', 'subcategory', 'primaryColor', 'secondaryColor', 'pattern', 'material', 'sleeveLength', 'fit', 'style', 'season', 'gender', 'formality'] as const
export type RealVisionField = (typeof REAL_VISION_FIELDS)[number]
/** The image preparation every provider gets (vision-input.ts): rotate, fit inside maxSide, flatten, JPEG q85, no metadata. */
export const PREPROCESSING_VERSION = 'vision-prep-v1:rotate+fit-inside+flatten-white+jpeg-q85'

type Env = Record<string, string | undefined>

export interface Count {
  correct: number
  scored: number
  /** correct / scored; null when nothing could be scored (never 0 by default). */
  rate: number | null
}
const count = (correct: number, scored: number): Count => ({ correct, scored, rate: scored ? Math.round((correct / scored) * 10_000) / 10_000 : null })

/** Technical quality of one image: dimensions and format only (no EXIF values, no GPS, no path). */
export interface ImageQuality {
  case: string
  width: number | null
  height: number | null
  format: string | null
  bytes: number
  orientation: number | null
  /** The original carried EXIF / GPS blocks (their content is never read or stored). */
  hadExif: boolean
  /** prepareVisionImage succeeded and its output carries no EXIF, ICC-GPS or XMP block. */
  preparedOk: boolean
  preparedHasMetadata: boolean
}

export async function imageQuality(caseId: string, bytes: Uint8Array): Promise<ImageQuality> {
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>> | null = null
  try {
    meta = await sharp(bytes).metadata()
  } catch {
    meta = null
  }
  let preparedOk = false, preparedHasMetadata = false
  try {
    const prepared = await prepareVisionImage(bytes, 1024)
    const pm = await sharp(prepared.image).metadata()
    preparedOk = true
    preparedHasMetadata = !!(pm.exif || pm.xmp || pm.iptc)
  } catch {
    preparedOk = false
  }
  return {
    case: caseId,
    width: meta?.width ?? null,
    height: meta?.height ?? null,
    format: meta?.format ?? null,
    bytes: bytes.byteLength,
    orientation: meta?.orientation ?? null,
    hadExif: !!meta?.exif,
    preparedOk,
    preparedHasMetadata,
  }
}

// ─── Scoring against ground truth ───────────────────────────────────────────

const predicted = (o: Extract<ItemOutcome, { kind: 'garment' }>, f: RealVisionField): string | string[] | null => {
  const a = o.attributes
  if (f === 'primaryColor') return a.colors[0] ?? null
  if (f === 'secondaryColor') return a.colors[1] ?? 'none'
  if (f === 'season') return a.season
  return a[f]
}
const same = (p: string | string[] | null, t: string | string[]) => (Array.isArray(t) ? Array.isArray(p) && [...p].sort().join('|') === [...t].sort().join('|') : p === t)
const CONF_KEY: Record<RealVisionField, string> = { category: 'category', subcategory: 'subcategory', primaryColor: 'color', secondaryColor: 'color', pattern: 'pattern', material: 'material', sleeveLength: 'sleeveLength', fit: 'fit', style: 'style', season: 'season', gender: 'gender', formality: 'formality' }
const BINS = [0, 0.5, 0.7, 0.85, 0.95, 1.0001]

export interface VisionScores {
  /** Cases the provider answered (garment or rejection) vs errors and invalid outputs. */
  answered: number
  invalidOutput: number
  providerErrors: number
  schemaValidity: Count
  subject: Count
  fields: Record<RealVisionField, Count>
  rejection: {
    /** Non-garment / multiple / unclear images accepted as a single garment. */
    falseAcceptance: Count
    /** Single garments refused. */
    falseRejection: Count
    multipleGarmentsHandled: Count
    unclearHandled: Count
    noGarmentHandled: Count
  }
  /** Cases a field could not be scored for (no or unresolved ground truth). */
  unscoredFields: Record<RealVisionField, number>
  confidence: { label: 'PRELIMINARY CONFIDENCE ANALYSIS'; bins: Array<{ range: string; correct: number; scored: number }> }
}

/** Scores provider records against the final ground truth; only fields with ground truth are scored. */
export function scoreVision(records: Array<Pick<ItemRecord, 'item' | 'outcome'>>, truth: (caseId: string, field: string) => FieldTruth): VisionScores {
  const fieldC: Record<string, [number, number]> = Object.fromEntries(REAL_VISION_FIELDS.map((f) => [f, [0, 0]]))
  const unscored: Record<string, number> = Object.fromEntries(REAL_VISION_FIELDS.map((f) => [f, 0]))
  let answered = 0, invalid = 0, errors = 0, subjOk = 0, subjN = 0
  const rej = { fa: [0, 0], fr: [0, 0], multi: [0, 0], unclear: [0, 0], none: [0, 0] }
  const bins = BINS.slice(0, -1).map((lo, i) => ({ range: `${lo}-${Math.min(BINS[i + 1], 1)}`, correct: 0, scored: 0 }))
  for (const r of records) {
    if (r.outcome.kind === 'error') { errors++; continue }
    if (r.outcome.kind === 'invalid') { invalid++; continue }
    answered++
    const subj = truth(r.item, 'subject')
    const got = r.outcome.kind === 'garment' ? 'single_garment' : r.outcome.subject
    if ('value' in subj) {
      subjN++
      if (subj.value === got) subjOk++
      if (subj.value === 'single_garment') { rej.fr[1]++; if (got !== 'single_garment') rej.fr[0]++ }
      else {
        rej.fa[1]++
        if (got === 'single_garment') rej.fa[0]++
        const k = subj.value === 'multiple_garments' ? 'multi' : subj.value === 'unclear' ? 'unclear' : 'none'
        rej[k][1]++
        if (got === subj.value) rej[k][0]++
      }
    }
    if (r.outcome.kind !== 'garment') continue
    for (const f of REAL_VISION_FIELDS) {
      const t = truth(r.item, f)
      if (!('value' in t)) { unscored[f]++; continue }
      const ok = same(predicted(r.outcome, f), t.value)
      fieldC[f][1]++
      if (ok) fieldC[f][0]++
      const c = r.outcome.rawConfidence[CONF_KEY[f] as keyof typeof r.outcome.rawConfidence]
      const bin = bins.find((_, i) => c >= BINS[i] && c < BINS[i + 1])
      if (bin) { bin.scored++; if (ok) bin.correct++ }
    }
  }
  const attempted = answered + invalid
  return {
    answered,
    invalidOutput: invalid,
    providerErrors: errors,
    schemaValidity: count(answered, attempted),
    subject: count(subjOk, subjN),
    fields: Object.fromEntries(REAL_VISION_FIELDS.map((f) => [f, count(fieldC[f][0], fieldC[f][1])])) as Record<RealVisionField, Count>,
    rejection: {
      falseAcceptance: count(rej.fa[0], rej.fa[1]),
      falseRejection: count(rej.fr[0], rej.fr[1]),
      multipleGarmentsHandled: count(rej.multi[0], rej.multi[1]),
      unclearHandled: count(rej.unclear[0], rej.unclear[1]),
      noGarmentHandled: count(rej.none[0], rej.none[1]),
    },
    unscoredFields: unscored as Record<RealVisionField, number>,
    confidence: { label: 'PRELIMINARY CONFIDENCE ANALYSIS', bins },
  }
}

// ─── Running a provider ─────────────────────────────────────────────────────

export interface VisionProviderResult {
  provider: EvalProviderName
  status: 'TESTED' | 'TEST_ONLY' | 'NOT_TESTED' | 'BLOCKED'
  reason: string | null
  model: string | null
  scores: VisionScores | null
  accounting: SectionAccounting | null
}

export interface RealVisionOptions {
  purpose: Purpose
  today: string
  budget: CallBudget
  /** Tests inject scripted providers (reported TEST_ONLY). */
  providers?: { vision?: (provider: EvalProviderName, model: string, env: Env) => VisionProvider }
  sleep?: (ms: number) => Promise<void>
}

export interface RealVisionReport {
  dataset: { id: string; version: string; kind: string; sha256: string; cases: number; split: Purpose; casesInSplit: number }
  governance: ReturnType<typeof governanceGate>
  annotation: { status: string; annotators: number; agreement: AgreementStats[]; limitations: string[] } | null
  quality: ImageQuality[]
  providers: VisionProviderResult[]
}

/** A dollar budget can estimate this provider's vision attempts: an exact-model price and the documented OpenAI image settings. */
function costBudgetable(provider: EvalProviderName, model: string, env: Record<string, string | undefined>): boolean {
  const detail = bakeoffVisionConfig(provider, model).openaiDetail
  return isBudgetablePrice(configuredPrice(provider, model, 'vision', env)) && provider === 'openai' && isOpenAIPatchModel(model) && (detail === 'high' || detail === 'auto')
}

export async function runRealVision(ds: LoadedDataset, env: Env, opts: RealVisionOptions): Promise<RealVisionReport> {
  const m = ds.manifest
  const use = opts.purpose === 'prompt_development' ? 'prompt_development' : 'local_evaluation'
  const governance = governanceGate(m, use, opts.today)
  const selected = casesFor(m, ds.cases, opts.purpose).filter((c) => c.file)
  const report: RealVisionReport = {
    dataset: { id: m.datasetId, version: m.datasetVersion, kind: m.kind, sha256: ds.sha256, cases: ds.cases.length, split: opts.purpose, casesInSplit: selected.length },
    governance,
    annotation: ds.annotations
      ? { status: m.annotation.status, annotators: ds.annotations.annotators.length, agreement: agreement(ds.annotations, ['subject', ...REAL_VISION_FIELDS]), limitations: annotationLimitations(ds.annotations) }
      : null,
    quality: [],
    providers: [],
  }
  if (!governance.ok) {
    report.providers = (['gemini', 'openai'] as const).map((provider) => ({ provider, status: 'BLOCKED', reason: governance.reasons.join('; '), model: null, scores: null, accounting: null }))
    return report
  }
  // Each image is checked against its frozen hash right before it is read for any purpose.
  const readImage = async (file: string): Promise<Uint8Array> => {
    const bytes = new Uint8Array(await fs.readFile(file))
    if (ds.files[path.basename(file)] !== sha256Hex(bytes)) throw new DatasetIntegrityError()
    return bytes
  }
  for (const c of selected) report.quality.push(await imageQuality(c.id, await readImage(path.join(ds.dir, 'files', c.file!))))

  const truth = (id: string, field: string) => (ds.annotations ? fieldTruth(ds.annotations, id, field) : ({ status: 'unknown' } as const))
  const items = selected.map((c) => {
    const subj = truth(c.id, 'subject')
    // vision-eval needs an expected subject for its own summary (unused here); scoring uses the ground truth above.
    return { id: c.id, file: c.file!, expected: { subject: ('value' in subj && typeof subj.value === 'string' ? subj.value : 'unclear') as 'unclear' } }
  })
  for (const provider of ['gemini', 'openai'] as const) {
    const gate = providerTransmissionGate(m, provider, opts.today)
    const model = configuredVisionModel(provider, env)
    const key = provider === 'gemini' ? 'GEMINI_API_KEY' : 'OPENAI_API_KEY'
    let reason: string | null = null, status: VisionProviderResult['status'] = 'NOT_TESTED'
    if (!gate.ok) { status = 'BLOCKED'; reason = gate.reasons.join('; ') }
    else if (!ds.annotations) { status = 'BLOCKED'; reason = 'no ground truth (annotations.json)' }
    else if (items.length === 0) reason = `no cases in the ${opts.purpose} split`
    else if (!env[key]?.trim()) reason = `no ${key} in the environment`
    else if (!model) reason = 'no configured vision model'
    else if (opts.budget.maxCalls === null) { status = 'BLOCKED'; reason = 'no call cap (--max-calls)' }
    else if (opts.budget.maxCostUsd !== null && !costBudgetable(provider, model!, env)) {
      // Refused before any call, so the shared budget is not stopped by a request type it cannot estimate.
      status = 'BLOCKED'
      reason = '--max-cost-usd: no exact-model price above zero (AI_VISION_PROVIDER + AI_VISION_MODEL + AI_VISION_PRICE_*) or no documented image-token bound for this provider, model or setting'
    }
    if (reason) { report.providers.push({ provider, status, reason, model, scores: null, accounting: null }); continue }

    const price = configuredPrice(provider, model!, 'vision', env)
    const ledger = new CallLedger(opts.budget, price)
    const factory = opts.providers?.vision ?? realVision
    const p = retryingVision(factory(provider, model!, env), ledger, opts.sleep)
    const results: CaseResult[] = []
    try {
      const { records } = await evaluateVisionConfig(p, bakeoffVisionConfig(provider, model!), path.join(ds.dir, 'files'), items, (r) => {
        results.push(caseResult(r.latencyMs, 1, r.outcome, ledger.endCase()))
      }, readImage)
      report.providers.push({ provider, status: opts.providers?.vision ? 'TEST_ONLY' : 'TESTED', reason: null, model, scores: scoreVision(records, truth), accounting: accountSection('vision', ledger, results, price) })
    } catch (err) {
      if (!(err instanceof DatasetIntegrityError)) throw err
      report.providers.push({ provider, status: 'BLOCKED', reason: 'DATASET_INTEGRITY_FAILURE', model, scores: null, accounting: accountSection('vision', ledger, results, price) })
      break
    }
  }
  return report
}
