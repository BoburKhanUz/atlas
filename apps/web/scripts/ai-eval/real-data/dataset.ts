/**
 * Real validation datasets on disk (Phase 5.2), always OUTSIDE the repository:
 *
 *   <root>/<type>/<datasetId>/<version>/
 *     manifest.json      governance (no personal data), see governance.ts
 *     cases.json         { cases: [{ id, file? }] } — case ids are neutral codes
 *     annotations.json   independent human labels, see annotations.ts
 *     files/…            raw images (never in Git)
 *
 * - The content hash covers cases.json, annotations.json and every listed
 *   file, in order; it must equal manifest.sha256 (frozen) before any use.
 * - Splits: manifest.holdout lists the holdout cases; the rest are split
 *   deterministically (by a hash of the id) into development / validation.
 *   The holdout is used only for a final evaluation (explicit flag), never
 *   for prompt development.
 * - Registry: an append-only file (outside the repository) remembers every
 *   (dataset, version) → hash; a version can never be re-registered with
 *   different content.
 */
import crypto from 'crypto'
import { promises as fs } from 'fs'
import path from 'path'
import { z } from 'zod'
import { assertOutsideRepo } from '../eval-common'
import { parseAnnotations, type Annotations } from './annotations'
import { parseManifest, type Manifest } from './governance'

const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}\.(jpe?g|png|webp|heic|heif)$/i
export const Cases = z.strictObject({
  cases: z
    .array(z.strictObject({ id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/), file: z.string().regex(SAFE_FILE).optional() }))
    .min(1)
    .refine((c) => new Set(c.map((x) => x.id)).size === c.length, 'duplicate case ids'),
})
export type Cases = z.infer<typeof Cases>

export interface LoadedDataset {
  dir: string
  manifest: Manifest
  cases: Cases['cases']
  annotations: Annotations | null
  /** sha256 of the content as found on disk. */
  sha256: string
  /** Per file sha256, for re-checking each file right before use. */
  files: Record<string, string>
}

const sha = (b: string | Uint8Array) => crypto.createHash('sha256').update(b).digest('hex')

export async function contentHash(dir: string, cases: Cases['cases']): Promise<{ sha256: string; files: Record<string, string> }> {
  const h = crypto.createHash('sha256')
  h.update(await fs.readFile(path.join(dir, 'cases.json')))
  try {
    h.update(await fs.readFile(path.join(dir, 'annotations.json')))
  } catch {
    h.update('no-annotations')
  }
  const files: Record<string, string> = {}
  for (const c of cases) {
    if (!c.file) continue
    const bytes = await fs.readFile(path.join(dir, 'files', c.file))
    files[c.file] = sha(bytes)
    h.update(`\n${c.id}\n`)
    h.update(bytes)
  }
  return { sha256: h.digest('hex'), files }
}

/**
 * Loads a dataset and verifies it: outside the repository, valid manifest,
 * case count and content hash equal to the manifest (else it refuses).
 */
export async function loadDataset(dir: string, repoRoot: string): Promise<LoadedDataset> {
  assertOutsideRepo(dir, repoRoot, path)
  const manifest = parseManifest(JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8')))
  const parsed = Cases.safeParse(JSON.parse(await fs.readFile(path.join(dir, 'cases.json'), 'utf8')))
  if (!parsed.success) throw new Error(`invalid cases.json: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
  const cases = parsed.data.cases
  let annotations: Annotations | null = null
  try {
    annotations = parseAnnotations(JSON.parse(await fs.readFile(path.join(dir, 'annotations.json'), 'utf8')))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  if (cases.length !== manifest.cases) throw new Error(`dataset ${manifest.datasetId}@${manifest.datasetVersion}: ${cases.length} cases on disk, manifest says ${manifest.cases}`)
  const unknownHoldout = manifest.holdout.filter((id) => !cases.some((c) => c.id === id))
  if (unknownHoldout.length) throw new Error(`dataset ${manifest.datasetId}@${manifest.datasetVersion}: holdout lists ${unknownHoldout.length} unknown case id(s)`)
  const { sha256, files } = await contentHash(dir, cases)
  if (sha256 !== manifest.sha256) throw new Error(`DATASET_INTEGRITY_FAILURE: ${manifest.datasetId}@${manifest.datasetVersion} content does not match its manifest sha256 (changed data needs a new version)`)
  return { dir, manifest, cases, annotations, sha256, files }
}

// ─── Splits ─────────────────────────────────────────────────────────────────

export type Split = 'development' | 'validation' | 'holdout'

/** Deterministic split of one case: the manifest's holdout list, else ~50/50 development/validation by id hash. */
export function splitOf(m: Manifest, caseId: string): Split {
  if (m.holdout.includes(caseId)) return 'holdout'
  return crypto.createHash('sha256').update(`${m.datasetId}:split:${caseId}`).digest().readUInt8(0) < 128 ? 'development' : 'validation'
}

export type Purpose = 'prompt_development' | 'evaluation' | 'final_evaluation'

/**
 * The cases a purpose may use. Prompt development sees development cases
 * only; an evaluation sees validation cases; only an explicit final
 * evaluation sees the holdout (and nothing else). The holdout is never
 * returned for development or tuning.
 */
export function casesFor<T extends { id: string }>(m: Manifest, cases: readonly T[], purpose: Purpose): T[] {
  const want: Split = purpose === 'prompt_development' ? 'development' : purpose === 'evaluation' ? 'validation' : 'holdout'
  return cases.filter((c) => splitOf(m, c.id) === want)
}

// ─── Immutable version registry ─────────────────────────────────────────────

const Registry = z.strictObject({
  datasets: z.record(z.string(), z.record(z.string(), z.strictObject({ sha256: z.string().regex(/^[0-9a-f]{64}$/), cases: z.number().int(), registeredAt: z.string() }))),
})

/**
 * Records (datasetId, version) → sha256 in an append-only registry outside
 * the repository. Re-registering the same content is a no-op; the same
 * version with different content is refused (create a new version instead).
 */
export async function registerVersion(registryFile: string, repoRoot: string, m: Manifest, now: Date): Promise<'registered' | 'already_registered'> {
  assertOutsideRepo(path.dirname(registryFile), repoRoot, path)
  let reg: z.infer<typeof Registry> = { datasets: {} }
  try {
    reg = Registry.parse(JSON.parse(await fs.readFile(registryFile, 'utf8')))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  const existing = reg.datasets[m.datasetId]?.[m.datasetVersion]
  if (existing) {
    if (existing.sha256 !== m.sha256 || existing.cases !== m.cases) {
      throw new Error(`dataset ${m.datasetId}@${m.datasetVersion} is already registered with different content: versions are immutable, create a new version`)
    }
    return 'already_registered'
  }
  reg.datasets[m.datasetId] = { ...(reg.datasets[m.datasetId] ?? {}), [m.datasetVersion]: { sha256: m.sha256, cases: m.cases, registeredAt: now.toISOString() } }
  await fs.mkdir(path.dirname(registryFile), { recursive: true })
  await fs.writeFile(registryFile, JSON.stringify(reg, null, 2) + '\n')
  return 'registered'
}
