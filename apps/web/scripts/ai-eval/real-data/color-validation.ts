/**
 * Colour-profile validation on consented selfies (Phase 5.2). HIGH
 * SENSITIVITY. The deterministic analyser (color-analysis.ts, unchanged) runs
 * locally: no provider, no network, nothing of the image is kept. Only the
 * case id and the derived labels reach the report.
 *
 * Ground truth separates what can be observed from expert judgement:
 * - observable: photo quality acceptable (yes/no), contrast (low/medium/high);
 * - expert judgement: undertone (warm/neutral/cool) and season. A season is a
 *   styling convention, not a biological fact: it is compared only where the
 *   experts agree (or a recorded adjudication exists); otherwise
 *   NOT_EVALUATED. No demographic or identity label is collected or inferred.
 *
 * Runs only when governanceGate allows local evaluation of this dataset
 * (documented consent covering image processing, appearance analysis and
 * evaluation; sensitivity "high").
 */
import { promises as fs } from 'fs'
import path from 'path'
import { analyzeSelfie, PhotoQualityError, SkinNotVisibleError, type ColorAnalysisResult } from '../../../src/lib/ai/color-analysis'
import { sha256Hex, DatasetIntegrityError } from '../live-accounting'
import { agreement, annotationLimitations, fieldTruth, type AgreementStats } from './annotations'
import { casesFor, type LoadedDataset, type Purpose } from './dataset'
import { governanceGate } from './governance'
import type { Count } from './real-vision'

export const NOT_EVALUATED = 'NOT_EVALUATED'
export const COLOR_FIELDS = ['qualityAcceptable', 'contrast', 'undertone', 'season'] as const

const count = (correct: number, scored: number): Count => ({ correct, scored, rate: scored ? Math.round((correct / scored) * 10_000) / 10_000 : null })

/** The analyser's 5-level undertone on the experts' 3-level scale; unknown abstains. */
export function undertone3(u: ColorAnalysisResult['undertone']): 'warm' | 'neutral' | 'cool' | null {
  if (u === 'warm' || u === 'neutral_warm') return 'warm'
  if (u === 'cool' || u === 'neutral_cool') return 'cool'
  if (u === 'neutral') return 'neutral'
  return null
}

export type SelfieOutcome = { kind: 'profile'; result: Pick<ColorAnalysisResult, 'season' | 'undertone' | 'contrastLevel' | 'confidence'> } | { kind: 'rejected_quality' } | { kind: 'rejected_skin' }

export interface ColorScores {
  /** Analyser refused vs experts' quality judgement. */
  qualityRejection: { correctRejections: number; falseRejections: number; missedRejections: number; correctAcceptances: number; scored: number }
  contrast: Count | typeof NOT_EVALUATED
  undertone: Count | typeof NOT_EVALUATED
  /** Expert consensus only. */
  season: Count | typeof NOT_EVALUATED
  /** Analyser said "unknown" / no season (an abstention, not an error). */
  abstentions: { undertone: number; season: number }
  /** PRELIMINARY: mean confidence of correct vs incorrect season calls. */
  confidence: { label: 'PRELIMINARY CONFIDENCE ANALYSIS'; meanWhenCorrect: number | null; meanWhenWrong: number | null; n: number }
}

export function scoreColor(outcomes: Array<{ case: string; outcome: SelfieOutcome }>, truth: (id: string, field: string) => ReturnType<typeof fieldTruth>): ColorScores {
  const q = { correctRejections: 0, falseRejections: 0, missedRejections: 0, correctAcceptances: 0, scored: 0 }
  const c = { contrast: [0, 0], undertone: [0, 0], season: [0, 0] }
  const abst = { undertone: 0, season: 0 }
  const confOk: number[] = [], confBad: number[] = []
  for (const { case: id, outcome } of outcomes) {
    const qt = truth(id, 'qualityAcceptable')
    const rejected = outcome.kind !== 'profile'
    if ('value' in qt) {
      q.scored++
      const acceptable = qt.value === 'yes'
      if (rejected && !acceptable) q.correctRejections++
      else if (rejected && acceptable) q.falseRejections++
      else if (!rejected && !acceptable) q.missedRejections++
      else q.correctAcceptances++
    }
    if (outcome.kind !== 'profile') continue
    const r = outcome.result
    const ct = truth(id, 'contrast')
    if ('value' in ct && r.contrastLevel) { c.contrast[1]++; if (ct.value === r.contrastLevel) c.contrast[0]++ }
    const ut = truth(id, 'undertone'), mine = undertone3(r.undertone)
    if ('value' in ut) {
      if (mine === null) abst.undertone++
      else { c.undertone[1]++; if (ut.value === mine) c.undertone[0]++ }
    }
    const st = truth(id, 'season')
    // Season only where experts agree (or adjudicated): a single opinion is not consensus.
    if ('value' in st && st.status !== 'single') {
      if (r.season === null) abst.season++
      else {
        c.season[1]++
        const ok = st.value === r.season
        if (ok) c.season[0]++
        ;(ok ? confOk : confBad).push(r.confidence)
      }
    }
  }
  const orNE = (v: number[]) => (v[1] ? count(v[0], v[1]) : NOT_EVALUATED)
  const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 1000) / 1000 : null)
  return {
    qualityRejection: q,
    contrast: orNE(c.contrast),
    undertone: orNE(c.undertone),
    season: orNE(c.season),
    abstentions: abst,
    confidence: { label: 'PRELIMINARY CONFIDENCE ANALYSIS', meanWhenCorrect: mean(confOk), meanWhenWrong: mean(confBad), n: confOk.length + confBad.length },
  }
}

export interface ColorReport {
  dataset: { id: string; version: string; kind: string; sha256: string; cases: number; split: Purpose; casesInSplit: number }
  governance: ReturnType<typeof governanceGate>
  status: 'EVALUATED' | 'BLOCKED' | typeof NOT_EVALUATED
  reason: string | null
  annotation: { status: string; annotators: number; agreement: AgreementStats[]; limitations: string[] } | null
  scores: ColorScores | null
  analyzerVersion: string | null
}

/** Analyses each consented selfie locally and scores it; the image bytes are dropped right after analysis. */
export async function runColorValidation(ds: LoadedDataset, opts: { purpose: Purpose; today: string; analyze?: (buffer: Buffer) => Promise<ColorAnalysisResult> }): Promise<ColorReport> {
  const m = ds.manifest
  const governance = governanceGate(m, 'local_evaluation', opts.today)
  const selected = casesFor(m, ds.cases, opts.purpose).filter((c) => c.file)
  const base = {
    dataset: { id: m.datasetId, version: m.datasetVersion, kind: m.kind, sha256: ds.sha256, cases: ds.cases.length, split: opts.purpose, casesInSplit: selected.length },
    governance,
    annotation: ds.annotations ? { status: m.annotation.status, annotators: ds.annotations.annotators.length, agreement: agreement(ds.annotations, [...COLOR_FIELDS]), limitations: annotationLimitations(ds.annotations) } : null,
  }
  if (m.datasetType !== 'color-profile') throw new Error('runColorValidation needs a color-profile dataset')
  if (!governance.ok) return { ...base, status: 'BLOCKED', reason: governance.reasons.join('; '), scores: null, analyzerVersion: null }
  if (!ds.annotations || m.annotation.status === 'none') return { ...base, status: NOT_EVALUATED, reason: 'no expert labels', scores: null, analyzerVersion: null }
  const analyze = opts.analyze ?? ((buffer: Buffer) => analyzeSelfie({ buffer }))
  const outcomes: Array<{ case: string; outcome: SelfieOutcome }> = []
  let version: string | null = null
  for (const c of selected) {
    const bytes = await fs.readFile(path.join(ds.dir, 'files', c.file!))
    if (ds.files[c.file!] !== sha256Hex(bytes)) throw new DatasetIntegrityError()
    try {
      const r = await analyze(bytes)
      version = r.version
      outcomes.push({ case: c.id, outcome: { kind: 'profile', result: { season: r.season, undertone: r.undertone, contrastLevel: r.contrastLevel, confidence: r.confidence } } })
    } catch (err) {
      if (err instanceof PhotoQualityError) outcomes.push({ case: c.id, outcome: { kind: 'rejected_quality' } })
      else if (err instanceof SkinNotVisibleError) outcomes.push({ case: c.id, outcome: { kind: 'rejected_skin' } })
      else throw err
    }
  }
  const annotations = ds.annotations
  return { ...base, status: 'EVALUATED', reason: null, scores: scoreColor(outcomes, (id, f) => fieldTruth(annotations, id, f)), analyzerVersion: version }
}
