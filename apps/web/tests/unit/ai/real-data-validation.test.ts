/**
 * Phase 5.2 real-data validation infrastructure: governance and consent
 * gates, provider-transmission gate, frozen hashes and immutable versions,
 * holdout protection, annotation agreement, metric denominators, no PII or
 * raw data leakage, reproducibility metadata and provider isolation.
 * No network, no keys (fake key values only), no real data: the test
 * datasets are synthetic renders in a temporary directory.
 */
import { execFileSync } from 'child_process'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CallBudget, sha256Hex } from '../../../scripts/ai-eval/live-accounting'
import { agreement, annotationLimitations, fieldTruth, parseAnnotations, type Annotations } from '../../../scripts/ai-eval/real-data/annotations'
import { runColorValidation, scoreColor, undertone3 } from '../../../scripts/ai-eval/real-data/color-validation'
import { casesFor, contentHash, loadDataset, registerVersion, splitOf } from '../../../scripts/ai-eval/real-data/dataset'
import { BLOCKED_GOVERNANCE, governanceGate, parseManifest, providerTransmissionGate, type Manifest } from '../../../scripts/ai-eval/real-data/governance'
import { checkOutfits, outfitRealisticCases, runOutfitRealistic } from '../../../scripts/ai-eval/real-data/outfit-realistic'
import { parseRatings, summarizeRatings } from '../../../scripts/ai-eval/real-data/ratings'
import { imageQuality, runRealVision, scoreVision } from '../../../scripts/ai-eval/real-data/real-vision'
import { stylistRealisticCases } from '../../../scripts/ai-eval/real-data/stylist-realistic-cases'
import { runValidation } from '../../../scripts/ai-eval/real-data/validate'
import { ScriptedStylist } from '../../../scripts/ai-eval/stylist-eval'
import { renderSynthetic, syntheticVisionItems } from '../../../scripts/ai-eval/synthetic-vision'
import { COLORS, SUBCATEGORIES } from '@/lib/ai/catalog'
import { CONFIDENCE_KEYS } from '@/lib/ai/garment-analysis'
import type { VisionProvider } from '@/lib/ai/providers/types'

const REPO = path.resolve(__dirname, '../../../../..')
const FAKE = 'fake-key-not-real-52'
const TODAY = '2026-10-07'
const noSleep = async () => {}

const manifest = (over: Partial<Manifest> = {}): Manifest =>
  parseManifest({
    manifestVersion: 1, datasetId: 'rv_test', datasetVersion: 'v1', datasetType: 'vision', kind: 'real', cases: 3, sha256: '0'.repeat(64),
    collectionDate: '2026-09-01', owner: 'ai_eval_team', collectionSource: 'consented_participants',
    consent: { status: 'documented', covers: ['image_processing', 'evaluation', 'provider_transmission'] },
    permittedUses: ['local_evaluation', 'provider_evaluation'], retentionUntil: '2026-12-31',
    deletion: { process: 'secure_delete_after_validation', responsible: 'ai_eval_team' }, access: 'evaluation_operator_only',
    encryptionAtRest: true, rawStorageAllowed: false, derivedLabelsAllowed: true, leaveEnvironment: true,
    providerTransmission: { allowed: true, providers: ['gemini'] }, legalReview: 'APPROVED',
    annotation: { status: 'multi_annotator', version: 'ann-v1' }, holdout: [], sensitivity: 'standard',
    ...over,
  })

describe('governance manifest and gates', () => {
  it('holds no personal data: names, emails, phone numbers and unknown fields are refused, values never echoed', () => {
    for (const bad of [{ owner: 'Ali Valiyev' }, { owner: 'ali@example.com' }, { owner: 'tel998901234567' }, { datasetId: 'a b' }, { extra: 'x' } as never]) {
      let msg = ''
      try {
        manifest(bad as Partial<Manifest>)
      } catch (e) {
        msg = (e as Error).message
      }
      expect(msg).toMatch(/invalid dataset manifest/)
      expect(msg).not.toMatch(/Valiyev|example\.com|998901234567/)
    }
  })

  it('real data needs documented consent covering processing and evaluation; otherwise BLOCKED — DATA GOVERNANCE', () => {
    expect(governanceGate(manifest(), 'local_evaluation', TODAY)).toEqual({ ok: true, status: 'OK', reasons: [] })
    const pending = governanceGate(manifest({ consent: { status: 'pending', covers: [] } }), 'local_evaluation', TODAY)
    expect(pending.status).toBe(BLOCKED_GOVERNANCE)
    expect(pending.reasons.join(';')).toMatch(/consent is pending.*image_processing.*evaluation/)
    expect(governanceGate(manifest({ permittedUses: ['local_evaluation'] }), 'prompt_development', TODAY).reasons).toContain('use "prompt_development" is not permitted by the manifest')
    expect(governanceGate(manifest({ retentionUntil: '2026-10-06' }), 'local_evaluation', TODAY).reasons[0]).toMatch(/retention period has ended/)
    expect(governanceGate(manifest({ kind: 'constructed', consent: { status: 'not_required', covers: [] } }), 'local_evaluation', TODAY).ok).toBe(true)
  })

  it('selfies need consent for appearance analysis and sensitivity "high"', () => {
    const selfie = manifest({ datasetType: 'color-profile' })
    expect(governanceGate(selfie, 'local_evaluation', TODAY).reasons).toEqual(['consent does not cover appearance_analysis', 'a selfie dataset must be marked sensitivity "high"'])
    expect(governanceGate(manifest({ datasetType: 'color-profile', sensitivity: 'high', consent: { status: 'documented', covers: ['image_processing', 'evaluation', 'appearance_analysis'] } }), 'local_evaluation', TODAY).ok).toBe(true)
  })

  it('provider transmission is explicit per provider; PENDING legal review is never treated as approval', () => {
    expect(providerTransmissionGate(manifest(), 'gemini', TODAY).ok).toBe(true)
    expect(providerTransmissionGate(manifest(), 'openai', TODAY).reasons).toContain('provider transmission to openai is not allowed')
    expect(providerTransmissionGate(manifest({ providerTransmission: { allowed: false, providers: [] } }), 'gemini', TODAY).reasons).toContain('provider transmission is not allowed for this dataset')
    expect(providerTransmissionGate(manifest({ legalReview: 'PENDING' }), 'gemini', TODAY)).toMatchObject({ ok: false, legalReview: 'PENDING', reasons: ['legal review is PENDING'] })
    expect(providerTransmissionGate(manifest({ leaveEnvironment: false }), 'gemini', TODAY).reasons).toContain('the dataset may not leave the evaluation environment')
    expect(providerTransmissionGate(manifest({ consent: { status: 'documented', covers: ['image_processing', 'evaluation'] } }), 'gemini', TODAY).reasons).toContain('consent does not cover provider_transmission')
  })
})

// ─── A governed test dataset on disk (synthetic renders, temporary dir) ──────
let root = ''
const conf = Object.fromEntries(CONFIDENCE_KEYS.map((k) => [k, 0.9]))
const garment = (category: string, subcategory: string, colors: string[], extra: Record<string, unknown> = {}) => ({ subject: 'single_garment', category, subcategory, colors, pattern: 'solid', material: 'denim', sleeveLength: null, fit: 'regular', style: 'casual', season: ['spring'], gender: 'unisex', formality: 'casual', confidence: conf, ...extra })
const label = (value: string | string[], confidence: 'high' | 'medium' | 'low' = 'high') => ({ value, confidence })

async function writeDataset(dir: string, over: Partial<Manifest> = {}, annotations?: unknown) {
  await fs.mkdir(path.join(dir, 'files'), { recursive: true })
  const items = syntheticVisionItems().filter((i) => ['jeans_blue', 'tshirt_red', 'no_garment_landscape'].includes(i.id))
  const cases = items.map((i) => ({ id: i.id, file: i.file }))
  for (const i of items) await fs.writeFile(path.join(dir, 'files', i.file), await renderSynthetic(i))
  await fs.writeFile(path.join(dir, 'cases.json'), JSON.stringify({ cases }))
  const ann = annotations ?? {
    annotationVersion: 'ann-v1', blindToProvider: true, annotators: ['A1', 'A2'],
    cases: {
      jeans_blue: { labels: { A1: { subject: label('single_garment'), category: label('pants'), primaryColor: label('blue'), season: label(['spring', 'autumn']) }, A2: { subject: label('single_garment'), category: label('pants'), primaryColor: label('navy'), season: label(['autumn', 'spring']) } } },
      tshirt_red: { labels: { A1: { subject: label('single_garment'), category: label('shirt'), primaryColor: label('red') }, A2: { subject: label('single_garment'), category: label('shirt'), primaryColor: label('unknown') } } },
      no_garment_landscape: { labels: { A1: { subject: label('no_garment') }, A2: { subject: label('no_garment') } } },
    },
  }
  await fs.writeFile(path.join(dir, 'annotations.json'), JSON.stringify(ann))
  const { sha256 } = await contentHash(dir, cases)
  const m = { ...manifest(over), sha256, cases: cases.length }
  await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(m))
  return m
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-real-validation-'))
  await writeDataset(path.join(root, 'vision', 'rv_test', 'v1'))
})
afterAll(async () => {
  if (root) await fs.rm(root, { recursive: true, force: true })
})

describe('frozen datasets, immutable versions, splits', () => {
  it('loads only a dataset whose content matches its manifest hash; a changed byte is DATASET_INTEGRITY_FAILURE', async () => {
    const dir = path.join(root, 'vision', 'rv_test', 'v1')
    const ds = await loadDataset(dir, REPO)
    expect(ds.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(Object.keys(ds.files).sort()).toEqual(['jeans_blue.png', 'no_garment_landscape.png', 'tshirt_red.png'])
    const f = path.join(dir, 'files', 'jeans_blue.png')
    const orig = await fs.readFile(f)
    await fs.writeFile(f, Buffer.concat([orig, Buffer.from([0])]))
    await expect(loadDataset(dir, REPO)).rejects.toThrow(/DATASET_INTEGRITY_FAILURE/)
    await fs.writeFile(f, orig)
  })

  it('refuses a dataset inside the repository, a wrong case count and unknown holdout ids', async () => {
    await expect(loadDataset(path.join(REPO, 'apps/web'), REPO)).rejects.toThrow(/outside the repository/)
    const dir = path.join(root, 'not-scanned', 'rv_count', 'v1') // a broken dataset, kept out of the scanned root
    const m = await writeDataset(dir, { datasetId: 'rv_count' })
    await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ ...m, cases: 4 }))
    await expect(loadDataset(dir, REPO)).rejects.toThrow(/3 cases on disk, manifest says 4/)
    await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ ...m, holdout: ['not_a_case'] }))
    await expect(loadDataset(dir, REPO)).rejects.toThrow(/holdout lists 1 unknown case id/)
  })

  it('a version is immutable: the same content re-registers, different content under the same version is refused', async () => {
    const reg = path.join(root, 'registry-test', 'registry.json') // not the registry the validation run uses
    const m = manifest({ sha256: 'a'.repeat(64) })
    expect(await registerVersion(reg, REPO, m, new Date('2026-10-07T00:00:00Z'))).toBe('registered')
    expect(await registerVersion(reg, REPO, m, new Date())).toBe('already_registered')
    await expect(registerVersion(reg, REPO, { ...m, sha256: 'b'.repeat(64) }, new Date())).rejects.toThrow(/immutable, create a new version/)
    expect(await registerVersion(reg, REPO, { ...m, datasetVersion: 'v2', sha256: 'b'.repeat(64) }, new Date())).toBe('registered')
  })

  it('holdout cases never reach prompt development or a normal evaluation; only a final evaluation sees them', () => {
    const ids = Array.from({ length: 60 }, (_, i) => ({ id: `c${i}` }))
    const m = manifest({ cases: 60, holdout: ['c1', 'c2', 'c3'] })
    const dev = casesFor(m, ids, 'prompt_development'), val = casesFor(m, ids, 'evaluation'), hold = casesFor(m, ids, 'final_evaluation')
    expect(hold.map((c) => c.id)).toEqual(['c1', 'c2', 'c3'])
    for (const c of [...dev, ...val]) expect(m.holdout).not.toContain(c.id)
    expect(dev.length + val.length + hold.length).toBe(60)
    expect(new Set([...dev, ...val].map((c) => c.id)).size).toBe(57) // disjoint
    expect(dev.length).toBeGreaterThan(10)
    expect(val.length).toBeGreaterThan(10)
    for (const c of ids) expect(splitOf(m, c.id)).toBe(splitOf(m, c.id)) // deterministic
  })
})

describe('annotations: independent ground truth', () => {
  const ann = (cases: Annotations['cases'], annotators = ['A1', 'A2']) => parseAnnotations({ annotationVersion: 'v1', blindToProvider: true, annotators, cases })

  it('agreed, adjudicated, unresolved, unknown and single — never overwritten, never forced', () => {
    const a = ann({
      c1: { labels: { A1: { category: label('pants') }, A2: { category: label('pants', 'low') } } },
      c2: { labels: { A1: { category: label('pants') }, A2: { category: label('shirt') } }, adjudication: { category: { value: 'pants', by: 'ADJ1', reason: 'visible_waistband' } } },
      c3: { labels: { A1: { category: label('pants') }, A2: { category: label('shirt') } } },
      c4: { labels: { A1: { category: label('unknown') }, A2: { category: label('unknown') } } },
      c5: { labels: { A1: { category: label('dress') } } },
    })
    expect(fieldTruth(a, 'c1', 'category')).toEqual({ status: 'agreed', value: 'pants', confidence: 'low' })
    expect(fieldTruth(a, 'c2', 'category')).toEqual({ status: 'adjudicated', value: 'pants', confidence: 'medium' })
    expect(fieldTruth(a, 'c3', 'category')).toEqual({ status: 'unresolved' })
    expect(fieldTruth(a, 'c4', 'category')).toEqual({ status: 'unknown' })
    expect(fieldTruth(a, 'c5', 'category')).toMatchObject({ status: 'single', value: 'dress' })
    // The original labels stay as given (the adjudication is separate).
    expect(a.cases.c2.labels.A2.category.value).toBe('shirt')
    expect(agreement(a, ['category'])).toEqual([{ field: 'category', compared: 3, agreed: 1, disagreed: 2, unresolved: 1, agreementRate: 0.3333 }])
  })

  it('a single annotator is reported as a limitation; annotators must be blind to provider output and declared', () => {
    expect(annotationLimitations(ann({ c1: { labels: { A1: { category: label('pants') } } } }, ['A1']))[0]).toMatch(/^LIMITATION — SINGLE ANNOTATOR/)
    expect(() => parseAnnotations({ annotationVersion: 'v1', blindToProvider: false, annotators: ['A1'], cases: {} })).toThrow(/invalid annotations/)
    expect(() => parseAnnotations({ annotationVersion: 'v1', blindToProvider: true, annotators: ['A1'], cases: { c1: { labels: { A9: {} } } } })).toThrow(/undeclared annotator/)
    expect(() => parseAnnotations({ annotationVersion: 'v1', blindToProvider: true, annotators: ['Ali Valiyev'], cases: {} })).toThrow(/invalid annotations/)
  })
})

describe('vision scoring: denominators shown, only labelled fields scored', () => {
  it('scores against ground truth; provider errors and invalid outputs are counted, never averaged into accuracy', async () => {
    const dir = path.join(root, 'vision', 'rv_test', 'v1')
    const ds = await loadDataset(dir, REPO)
    const truth = (id: string, f: string) => fieldTruth(ds.annotations!, id, f)
    const g = (attrs: Record<string, unknown>) => ({ kind: 'garment' as const, attributes: attrs as never, rawConfidence: conf as never, colorVerdict: 'agree' as never })
    const s = scoreVision(
      [
        { item: 'jeans_blue', outcome: g({ category: 'pants', subcategory: 'jeans', colors: ['blue'], season: ['autumn', 'spring'] }) }, // season order differs: compared as a set
        { item: 'tshirt_red', outcome: g({ category: 'pants', colors: ['red'], season: [] }) },
        { item: 'no_garment_landscape', outcome: g({ category: 'accessory', colors: ['green'], season: [] }) },
        { item: 'extra_error', outcome: { kind: 'error', error: 'timeout' } },
        { item: 'extra_invalid', outcome: { kind: 'invalid' } },
      ],
      truth,
    )
    expect(s).toMatchObject({ answered: 3, invalidOutput: 1, providerErrors: 1 })
    expect(s.schemaValidity).toEqual({ correct: 3, scored: 4, rate: 0.75 })
    expect(s.fields.category).toEqual({ correct: 1, scored: 2, rate: 0.5 }) // jeans ✓, tshirt ✗; the landscape has no category label
    // jeans primary colour is unresolved (blue vs navy, no adjudication); tshirt red is single → scored.
    expect(s.fields.primaryColor).toEqual({ correct: 1, scored: 1, rate: 1 })
    expect(s.fields.season).toEqual({ correct: 1, scored: 1, rate: 1 }) // set equality
    expect(s.fields.material).toEqual({ correct: 0, scored: 0, rate: null }) // nothing labelled: null, never 0
    expect(s.rejection.falseAcceptance).toEqual({ correct: 1, scored: 1, rate: 1 }) // the landscape was accepted as a garment
    expect(s.rejection.falseRejection).toEqual({ correct: 0, scored: 2, rate: 0 })
    expect(s.confidence.label).toBe('PRELIMINARY CONFIDENCE ANALYSIS')
    // Secondary colour is the second colour ("none" when there is only one).
    const sec = (truth: string) => scoreVision([{ item: 'x', outcome: g({ category: 'shirt', colors: ['red', 'white'], season: [] }) }, { item: 'y', outcome: g({ category: 'shirt', colors: ['red'], season: [] }) }], (_, f) => (f === 'secondaryColor' ? { status: 'agreed', value: truth, confidence: 'high' } : { status: 'unknown' })).fields.secondaryColor
    expect(sec('white')).toEqual({ correct: 1, scored: 2, rate: 0.5 })
    expect(sec('none')).toEqual({ correct: 1, scored: 2, rate: 0.5 })
  })
})

describe('real vision run: gates, isolation, no leakage', () => {
  const JEANS = { output: { subject: 'single_garment', category: 'pants', subcategory: 'jeans', colors: ['blue'], pattern: 'solid', material: 'denim', sleeveLength: null, fit: 'regular', style: 'casual', season: ['spring', 'autumn'], gender: 'unisex', formality: 'casual', confidence: conf }, metadata: { provider: 'v', model: 'm', usage: {} } }
  const scripted = (): VisionProvider & { calls: number } => { const p = { name: 'v', model: 'm', calls: 0, async analyzeImage() { p.calls++; return JEANS } }; return p }
  const env = { GEMINI_API_KEY: FAKE, OPENAI_API_KEY: FAKE, AI_EVAL_GEMINI_VISION_MODEL: 'gv', AI_EVAL_OPENAI_VISION_MODEL: 'ov' }

  it('runs only where governance and transmission allow it; the other provider is BLOCKED and never called', async () => {
    const ds = await loadDataset(path.join(root, 'vision', 'rv_test', 'v1'), REPO)
    const built: string[] = []
    const r = await runRealVision(ds, env, { purpose: 'final_evaluation', today: TODAY, budget: new CallBudget(100, null), sleep: noSleep, providers: { vision: (p) => (built.push(p), scripted()) } })
    expect(built).toEqual([]) // final_evaluation = holdout only; this manifest has no holdout → nothing to send
    expect(r.providers[0]).toMatchObject({ status: 'NOT_TESTED', reason: 'no cases in the final_evaluation split' })
    const r2 = await runRealVision({ ...ds, manifest: { ...ds.manifest, holdout: [] } }, env, { purpose: 'evaluation', today: TODAY, budget: new CallBudget(100, null), sleep: noSleep, providers: { vision: (p) => (built.push(p), scripted()) } })
    expect(built).toEqual(['gemini'])
    expect(r2.providers.map((p) => [p.provider, p.status])).toEqual([['gemini', 'TEST_ONLY'], ['openai', 'BLOCKED']])
    expect(r2.providers[1].reason).toMatch(/transmission to openai is not allowed/)
    expect(r.dataset.split).toBe('final_evaluation')
    const text = JSON.stringify(r2)
    for (const leak of [FAKE, '.png', ds.dir, 'jeans_blue.png']) expect(text).not.toContain(leak)
  })

  it('no call cap, missing consent or PENDING legal review → BLOCKED before any provider is built', async () => {
    const ds = await loadDataset(path.join(root, 'vision', 'rv_test', 'v1'), REPO)
    let built = 0
    const providers = { vision: () => (built++, scripted()) }
    const noCap = await runRealVision(ds, env, { purpose: 'evaluation', today: TODAY, budget: new CallBudget(null, null), providers })
    expect(noCap.providers[0]).toMatchObject({ status: 'BLOCKED', reason: 'no call cap (--max-calls)' })
    const pending = await runRealVision({ ...ds, manifest: { ...ds.manifest, legalReview: 'PENDING' } }, env, { purpose: 'evaluation', today: TODAY, budget: new CallBudget(100, null), providers })
    expect(pending.providers[0]).toMatchObject({ status: 'BLOCKED', reason: 'legal review is PENDING' })
    const noConsent = await runRealVision({ ...ds, manifest: { ...ds.manifest, consent: { status: 'none', covers: [] } } }, env, { purpose: 'evaluation', today: TODAY, budget: new CallBudget(100, null), providers })
    expect(noConsent.governance.status).toBe(BLOCKED_GOVERNANCE)
    expect(noConsent.quality).toEqual([]) // not even read for quality metadata
    expect(built).toBe(0)
  })

  it('an image changed after loading stops the run (DATASET_INTEGRITY_FAILURE) before any provider is built', async () => {
    const dir = path.join(root, 'not-scanned', 'rv_tamper', 'v1')
    await writeDataset(dir, { datasetId: 'rv_tamper' })
    const ds = await loadDataset(dir, REPO)
    await fs.appendFile(path.join(dir, 'files', 'tshirt_red.png'), Buffer.from([0]))
    let built = 0
    await expect(runRealVision(ds, env, { purpose: 'evaluation', today: TODAY, budget: new CallBudget(100, null), providers: { vision: () => (built++, scripted()) } })).rejects.toThrow(/DATASET_INTEGRITY_FAILURE/)
    expect(built).toBe(0)
    const cpDir = path.join(root, 'not-scanned', 'cp_tamper', 'v1')
    await writeDataset(cpDir, { datasetId: 'cp_tamper', datasetType: 'color-profile', sensitivity: 'high', consent: { status: 'documented', covers: ['image_processing', 'evaluation', 'appearance_analysis'] } })
    const cp = await loadDataset(cpDir, REPO)
    for (const f of Object.keys(cp.files)) await fs.appendFile(path.join(cpDir, 'files', f), Buffer.from([0]))
    let analysed = 0
    await expect(runColorValidation(cp, { purpose: 'evaluation', today: TODAY, analyze: async () => (analysed++, {} as never) })).rejects.toThrow(/DATASET_INTEGRITY_FAILURE/)
    expect(analysed).toBe(0)
  })

  it('missing credentials → NOT_TESTED (never a mock substitute)', async () => {
    const ds = await loadDataset(path.join(root, 'vision', 'rv_test', 'v1'), REPO)
    const r = await runRealVision(ds, {}, { purpose: 'evaluation', today: TODAY, budget: new CallBudget(100, null) })
    expect(r.providers[0]).toMatchObject({ status: 'NOT_TESTED', reason: 'no GEMINI_API_KEY in the environment', scores: null })
  })

  it('image quality metadata: dimensions and format only; EXIF is detected, never read, and stripped by the app preparation', async () => {
    const withExif = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#336699' } }).jpeg().withMetadata({ exif: { IFD0: { Copyright: 'someone' } } }).toBuffer()
    const q = await imageQuality('c1', new Uint8Array(withExif))
    expect(q).toMatchObject({ case: 'c1', width: 64, height: 48, format: 'jpeg', hadExif: true, preparedOk: true, preparedHasMetadata: false })
    expect(JSON.stringify(q)).not.toContain('someone')
  })
})

describe('colour profile validation (local, deterministic analyser)', () => {
  const stubResult = (season: string | null, undertone: string, contrast: string | null, confidence = 0.6) => ({ version: 'color-analysis-v2', season, undertone, contrastLevel: contrast, confidence }) as never

  it('maps the analyser undertone to the experts\' scale; unknown abstains', () => {
    expect([undertone3('warm'), undertone3('neutral_warm'), undertone3('neutral'), undertone3('neutral_cool'), undertone3('cool'), undertone3('unknown')]).toEqual(['warm', 'warm', 'neutral', 'cool', 'cool', null])
  })

  it('season is compared only where experts agree; a single opinion is not consensus; quality rejections are a confusion table', () => {
    const a = parseAnnotations({
      annotationVersion: 'v1', blindToProvider: true, annotators: ['A1', 'A2'],
      cases: {
        s1: { labels: { A1: { season: label('winter'), undertone: label('cool'), qualityAcceptable: label('yes') }, A2: { season: label('winter'), undertone: label('cool'), qualityAcceptable: label('yes') } } },
        s2: { labels: { A1: { season: label('autumn'), qualityAcceptable: label('yes') } } },
        s3: { labels: { A1: { qualityAcceptable: label('no') }, A2: { qualityAcceptable: label('no') } } },
        s4: { labels: { A1: { qualityAcceptable: label('yes') }, A2: { qualityAcceptable: label('yes') } } },
      },
    })
    const s = scoreColor(
      [
        { case: 's1', outcome: { kind: 'profile', result: stubResult('winter', 'neutral_cool', 'high', 0.7) } },
        { case: 's2', outcome: { kind: 'profile', result: stubResult('spring', 'warm', 'low') } },
        { case: 's3', outcome: { kind: 'rejected_quality' } },
        { case: 's4', outcome: { kind: 'rejected_skin' } },
      ],
      (id, f) => fieldTruth(a, id, f),
    )
    expect(s.season).toEqual({ correct: 1, scored: 1, rate: 1 }) // s2 is a single opinion: not scored
    expect(s.undertone).toEqual({ correct: 1, scored: 1, rate: 1 })
    expect(s.contrast).toBe('NOT_EVALUATED')
    expect(s.qualityRejection).toEqual({ correctRejections: 1, falseRejections: 1, missedRejections: 0, correctAcceptances: 2, scored: 4 })
    expect(s.confidence).toEqual({ label: 'PRELIMINARY CONFIDENCE ANALYSIS', meanWhenCorrect: 0.7, meanWhenWrong: null, n: 1 })
  })

  it('without consent for appearance analysis the selfies are never analysed (BLOCKED); without expert labels NOT_EVALUATED', async () => {
    const dir = path.join(root, 'color-profile', 'cp_test', 'v1')
    await writeDataset(dir, { datasetId: 'cp_test', datasetType: 'color-profile', sensitivity: 'high' })
    const ds = await loadDataset(dir, REPO)
    let analysed = 0
    const analyze = async () => (analysed++, stubResult('winter', 'cool', 'high'))
    const blocked = await runColorValidation(ds, { purpose: 'evaluation', today: TODAY, analyze })
    expect(blocked).toMatchObject({ status: 'BLOCKED', scores: null })
    expect(blocked.reason).toMatch(/appearance_analysis/)
    expect(analysed).toBe(0)
    const consented = { ...ds, manifest: { ...ds.manifest, consent: { status: 'documented' as const, covers: ['image_processing', 'evaluation', 'appearance_analysis'] as Manifest['consent']['covers'] } } }
    const ok = await runColorValidation(consented, { purpose: 'evaluation', today: TODAY, analyze })
    expect(ok.status).toBe('EVALUATED')
    expect(analysed).toBeGreaterThan(0)
    expect(JSON.stringify(ok)).not.toMatch(/\.png|files/)
    const none = await runColorValidation({ ...consented, annotations: null }, { purpose: 'evaluation', today: TODAY, analyze })
    expect(none).toMatchObject({ status: 'NOT_EVALUATED', reason: 'no expert labels' })
  })
})

describe('blind human ratings', () => {
  it('NOT_EVALUATED without ratings; per-dimension summaries (never one collapsed score); inter-rater agreement', () => {
    expect(summarizeRatings(null, null).status).toBe('NOT_EVALUATED')
    const s = (v: number) => ({ relevance: v, usefulness: v, completeness: v, uzbekQuality: v, grounding: v, safety: 5 })
    const ratings = parseRatings({ ratingVersion: 'r1', blind: true, raters: ['R1', 'R2'], ratings: [
      { case: 'cas_cafe', output: 'X1', rater: 'R1', scores: s(4) }, { case: 'cas_cafe', output: 'X1', rater: 'R2', scores: s(5) },
      { case: 'cas_cafe', output: 'X2', rater: 'R1', scores: { ...s(2), uzbekQuality: null } },
    ] })
    const sum = summarizeRatings(ratings, { outputs: { X1: { provider: 'gemini', model: 'g', run: 1 }, X2: { provider: 'openai', model: 'o', run: 1 } } })
    expect(sum.status).toBe('EVALUATED')
    expect(sum.byProvider.gemini.map((d) => d.dimension)).toEqual(['relevance', 'usefulness', 'completeness', 'uzbekQuality', 'grounding', 'safety'])
    expect(sum.byProvider.gemini[0]).toEqual({ dimension: 'relevance', n: 2, mean: 4.5, distribution: [0, 0, 0, 1, 1] })
    expect(sum.byProvider.openai.find((d) => d.dimension === 'uzbekQuality')).toEqual({ dimension: 'uzbekQuality', n: 0, mean: null, distribution: [0, 0, 0, 0, 0] })
    expect(sum.interRater.find((d) => d.dimension === 'relevance')).toEqual({ dimension: 'relevance', pairs: 1, exactAgreement: 0, meanAbsDiff: 1 })
  })

  it('raters must be blind and declared; outputs are blinded labels only', () => {
    const row = { case: 'c', output: 'X1', rater: 'R1', scores: { relevance: 3, usefulness: 3, completeness: 3, uzbekQuality: 3, grounding: 3, safety: 3 } }
    expect(() => parseRatings({ ratingVersion: 'r', blind: false, raters: ['R1'], ratings: [row] })).toThrow(/invalid ratings/)
    expect(() => parseRatings({ ratingVersion: 'r', blind: true, raters: ['R1'], ratings: [{ ...row, output: 'gemini-run1' }] })).toThrow(/blinded labels/)
    expect(() => parseRatings({ ratingVersion: 'r', blind: true, raters: ['R1'], ratings: [{ ...row, rater: 'R9' }] })).toThrow(/undeclared rater/)
  })
})

describe('realistic corpora (constructed)', () => {
  it('stylist: 60 deterministic Uzbek cases, unique ids, catalog values only, every scenario covered', () => {
    const a = stylistRealisticCases(), b = stylistRealisticCases()
    expect(a).toHaveLength(60)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(new Set(a.map((c) => c.id)).size).toBe(60)
    const colors = new Set(COLORS.map((c) => c.id))
    for (const c of a) for (const w of c.wardrobe) {
      expect((SUBCATEGORIES as Record<string, Array<{ id: string }>>)[w.category]?.some((s) => s.id === w.subcategory), `${c.id} ${w.category}/${w.subcategory}`).toBe(true)
      for (const col of w.colors) expect(colors.has(col), `${c.id} ${col}`).toBe(true)
    }
    const tags = new Set(a.flatMap((c) => c.tags))
    for (const t of ['casual', 'work', 'formal', 'date', 'travel', 'sport', 'weather', 'seasonal', 'limited', 'missing_info', 'followup', 'color_profile']) expect(tags.has(t), t).toBe(true)
  })

  it('outfit: the checks are independent of the engine and catch violations', () => {
    const c = outfitRealisticCases().find((x) => x.id === 'wedding_cold')!
    const pick = (sub: string) => c.wardrobe.find((w) => w.subcategory === sub)!
    const outfit = (subs: string[]) => ({ items: subs.map((s) => ({ item: pick(s), role: 'top', slot: 'top' })) }) as never
    expect(checkOutfits(c, [outfit(['tshirt', 'jeans', 'sneakers'])], null)).toEqual(['O1:weather_cold_without_outer_layer', 'O1:occasion_formal_casual_piece'])
    expect(checkOutfits(c, [outfit(['oxford_shirt', 'trousers', 'oxford_shoes', 'blazer', 'coat'])], null)).toEqual(['O1:layering_two_outer_layers'])
    const foreign = { items: [{ item: { ...pick('oxford_shirt'), id: 'not_in_wardrobe' } }, { item: pick('trousers') }, { item: pick('oxford_shoes') }, { item: pick('coat') }] } as never
    expect(checkOutfits(c, [foreign], null)).toEqual(['O1:validity_foreign_item'])
    const missing = outfitRealisticCases().find((x) => x.id === 'missing_shoes')!
    expect(checkOutfits(missing, [], 'nothing_suitable')).toEqual(['expected_problem:no_footwear'])
    expect(checkOutfits(c, [], 'nothing_suitable')).toEqual(['no_outfit:nothing_suitable'])
    const r = runOutfitRealistic()
    expect(r).toMatchObject({ cases: 20, colorHarmony: 'NOT_EVALUATED' })
    expect(r.deterministic.scored).toBe(20)
    expect(JSON.stringify(runOutfitRealistic())).toBe(JSON.stringify(r))
  })
})

describe('validation run: reproducibility, blockers, no selection, no leakage', () => {
  const now = new Date('2026-10-07T12:00:00Z')
  const base = { purpose: 'evaluation' as const, maxCostUsd: null, now, runId: 'run-test', appCommit: { sha: 'abc123', clean: true } }

  it('without real data: every real-data area is BLOCKED or NOT_EVALUATED with its reason; outfit still runs; NO FINAL PROVIDER SELECTED', async () => {
    const r = await runValidation({}, { ...base, root: null, maxCalls: null, transmitConstructed: false })
    expect(r.providerDecision).toBe('NO FINAL PROVIDER SELECTED')
    expect(r.reproducibility).toMatchObject({ runId: 'run-test', timestamp: '2026-10-07T12:00:00.000Z', appCommit: 'abc123', appTreeClean: true, purpose: 'evaluation' })
    expect(Object.keys(r.reproducibility.versions).sort()).toEqual(['colorAnalysis', 'outfitEngine', 'outfitPrompt', 'preprocessing', 'stylistPrompt', 'visionPrompt'])
    expect(r.blockers.join('\n')).toMatch(/BLOCKED — dataset unavailable: no --root/)
    expect(r.stylist.live.map((l) => l.status)).toEqual(['BLOCKED', 'BLOCKED'])
    expect(r.stylist.humanRatings.status).toBe('NOT_EVALUATED')
    expect(r.stylist.corpus).toMatchObject({ cases: 60, uzbekLatin: 59, uzbekCyrillic: 1, kind: 'constructed' })
    expect(r.outfit.status).toBe('EVALUATED')
    expect(r.budget.attemptsUsed).toBe(0)
  })

  it('constructed stylist corpus: provider calls need --transmit-constructed AND a call cap; providers stay isolated', async () => {
    const env = { GEMINI_API_KEY: FAKE, AI_EVAL_GEMINI_MODEL: 'g' }
    let built = 0
    const providers = { llm: () => (built++, new ScriptedStylist()) }
    // Credentials and a model alone never send anything: transmission must be allowed explicitly.
    const off = await runValidation(env, { ...base, root: null, maxCalls: null, transmitConstructed: false, providers })
    expect(off.stylist.live.map((l) => [l.status, l.reason])).toEqual([['BLOCKED', expect.stringMatching(/--transmit-constructed/)], ['BLOCKED', expect.stringMatching(/--transmit-constructed/)]])
    expect(built).toBe(0)
    await expect(runValidation(env, { ...base, root: null, maxCalls: null, transmitConstructed: true, providers })).rejects.toThrow(/needs --max-calls/)
    expect(built).toBe(0)
    const r = await runValidation(env, { ...base, root: null, maxCalls: 4 * 60, transmitConstructed: true, providers })
    expect(r.stylist.live.map((l) => [l.provider, l.status])).toEqual([['gemini', 'TEST_ONLY'], ['openai', 'NOT_TESTED']])
    expect(r.stylist.live[0].accounting!.cases).toBe(60)
    expect(r.stylist.live[1].reason).toBe('no OPENAI_API_KEY in the environment')
    expect(env).toEqual({ GEMINI_API_KEY: FAKE, AI_EVAL_GEMINI_MODEL: 'g' }) // configuration untouched
    const text = JSON.stringify(r)
    expect(text).not.toContain(FAKE)
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+|\+?998\d{9}|rv_item_\d|eval_item_\d/) // no emails, phones or wardrobe ids
  })

  it('with a governed dataset root: the dataset is registered and hashed; the report carries no file names or paths', async () => {
    const r = await runValidation({}, { ...base, root, maxCalls: null, transmitConstructed: false })
    expect(r.vision.map((v) => `${v.dataset.id}@${v.dataset.version}`)).toEqual(expect.arrayContaining(['rv_test@v1']))
    const reg = JSON.parse(await fs.readFile(path.join(root, 'registry.json'), 'utf8'))
    expect(reg.datasets.rv_test.v1.sha256).toBe(r.vision.find((v) => v.dataset.id === 'rv_test')!.dataset.sha256)
    const text = JSON.stringify(r)
    expect(text).not.toContain(root)
    expect(text).not.toMatch(/\.png|\.jpe?g/)
  })
})

describe('no raw data in Git', () => {
  it('the repository tracks no image or dataset files from the validation tooling', () => {
    const tracked = execFileSync('git', ['ls-files', 'apps/web/scripts', 'docs', 'apps/web/tests/unit/ai'], { cwd: REPO, encoding: 'utf8' }).split('\n')
    expect(tracked.filter((f) => /\.(jpe?g|png|webp|heic|heif)$/i.test(f) || /(^|\/)(manifest|annotations|cases|ratings|blinding-key)\.json$/.test(f))).toEqual([])
  })

  it('the content hash is the published sha256 of the files (any byte change is a new hash)', () => {
    expect(sha256Hex('a')).toBe('ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb')
  })
})
