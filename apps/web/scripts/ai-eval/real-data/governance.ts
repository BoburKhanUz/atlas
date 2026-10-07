/**
 * Real-data validation governance (Phase 5.2): the hard gate in front of any
 * real dataset. A dataset is used only through its manifest; the manifest
 * holds NO personal data (strict schema; free text is limited to short,
 * neutral codes), and every use is checked against it:
 *
 * - governanceGate(manifest, use): consent, permitted purpose, retention and
 *   deletion must be documented for the requested use; otherwise
 *   `BLOCKED — DATA GOVERNANCE` with the reasons.
 * - providerTransmissionGate(manifest, provider): sending data to a provider
 *   is a separate, explicit, per-provider decision. "Test data" is never
 *   assumed safe to upload.
 *
 * Legal review is recorded, never concluded here (PENDING until a human
 * records otherwise). See docs/ai/real-data-validation.md.
 */
import { z } from 'zod'

export const BLOCKED_GOVERNANCE = 'BLOCKED — DATA GOVERNANCE'
export const DATASET_TYPES = ['vision', 'color-profile', 'stylist', 'outfit'] as const
export type DatasetType = (typeof DATASET_TYPES)[number]
export const PROVIDERS = ['gemini', 'openai'] as const

/** What a dataset may be used for. */
export const USES = ['local_evaluation', 'provider_evaluation', 'prompt_development', 'calibration'] as const
export type DatasetUse = (typeof USES)[number]

/** Short neutral code: letters, digits, _ . - (no spaces, no @, no long digit runs: no names, emails or phone numbers). */
const CODE = z
  .string()
  .regex(/^[a-z][a-z0-9_.-]{0,63}$/i, 'must be a short neutral code ([A-Za-z0-9_.-], no spaces)')
  .refine((s) => !/\d{6,}/.test(s), 'must not contain long digit runs')
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO date (YYYY-MM-DD)')
const SHA = z.string().regex(/^[0-9a-f]{64}$/, 'must be a sha256 hex digest')

export const Manifest = z.strictObject({
  manifestVersion: z.literal(1),
  datasetId: CODE,
  /** Immutable: changing any case or label requires a new version. */
  datasetVersion: CODE,
  datasetType: z.enum(DATASET_TYPES),
  /** synthetic | constructed (realistic, written for evaluation) | real (collected). */
  kind: z.enum(['synthetic', 'constructed', 'real']),
  cases: z.number().int().min(1).max(5000),
  /** sha256 of the frozen content (filled from the files; checked on every use). */
  sha256: SHA,
  collectionDate: DATE,
  /** A role or team code, never a person's name. */
  owner: CODE,
  collectionSource: z.enum(['internal_team_photos', 'consented_participants', 'licensed_stock', 'constructed_by_team', 'synthetic_generator']),
  consent: z.strictObject({
    /** documented: written consent on file (outside this repository); not_required: synthetic/constructed content with no person in it. */
    status: z.enum(['documented', 'pending', 'none', 'not_required']),
    /** What the consent covers. */
    covers: z.array(z.enum(['image_processing', 'appearance_analysis', 'evaluation', 'provider_transmission'])).max(4),
  }),
  permittedUses: z.array(z.enum(USES)).min(1).max(USES.length),
  retentionUntil: DATE,
  deletion: z.strictObject({ process: CODE, responsible: CODE }),
  access: z.enum(['restricted_team', 'evaluation_operator_only']),
  encryptionAtRest: z.boolean(),
  rawStorageAllowed: z.boolean(),
  derivedLabelsAllowed: z.boolean(),
  /** May the data leave the local/staging evaluation environment at all? */
  leaveEnvironment: z.boolean(),
  /** Explicit, per provider. Absent provider = not allowed. */
  providerTransmission: z.strictObject({ allowed: z.boolean(), providers: z.array(z.enum(PROVIDERS)).max(2) }),
  legalReview: z.enum(['PENDING', 'APPROVED', 'REJECTED']),
  annotation: z.strictObject({ status: z.enum(['none', 'single_annotator', 'multi_annotator', 'adjudicated']), version: CODE }),
  /** Holdout cases (ids) — never used for prompt development or tuning. */
  holdout: z.array(CODE).max(5000).default([]),
  sensitivity: z.enum(['standard', 'high']),
})
export type Manifest = z.infer<typeof Manifest>

export interface GateResult {
  ok: boolean
  status: 'OK' | typeof BLOCKED_GOVERNANCE
  reasons: string[]
}

const result = (reasons: string[]): GateResult => ({ ok: reasons.length === 0, status: reasons.length ? BLOCKED_GOVERNANCE : 'OK', reasons })

/**
 * May this dataset be used for `use` on `today` (YYYY-MM-DD)? Collected (real)
 * data needs documented consent covering evaluation; appearance data
 * (selfies) needs consent for appearance analysis too.
 */
export function governanceGate(m: Manifest, use: DatasetUse, today: string): GateResult {
  const reasons: string[] = []
  if (!m.permittedUses.includes(use)) reasons.push(`use "${use}" is not permitted by the manifest`)
  if (m.retentionUntil < today) reasons.push('retention period has ended: the dataset must be deleted, not used')
  if (m.kind === 'real') {
    if (m.consent.status !== 'documented') reasons.push(`consent is ${m.consent.status}, not documented`)
    for (const need of ['image_processing', 'evaluation'] as const) if (!m.consent.covers.includes(need)) reasons.push(`consent does not cover ${need}`)
    if (m.datasetType === 'color-profile' && !m.consent.covers.includes('appearance_analysis')) reasons.push('consent does not cover appearance_analysis')
    if (m.legalReview === 'REJECTED') reasons.push('legal review rejected this dataset')
  } else if (m.consent.status !== 'not_required' && m.consent.status !== 'documented') {
    reasons.push(`consent is ${m.consent.status}`)
  }
  if (m.datasetType === 'color-profile' && m.sensitivity !== 'high') reasons.push('a selfie dataset must be marked sensitivity "high"')
  return result(reasons)
}

/**
 * May the data be sent to `provider`? Explicit at the dataset level: the
 * manifest must allow transmission to that provider, the data must be
 * allowed to leave the environment, the use must be permitted, and real data
 * needs consent covering provider transmission and a legal review that is
 * not REJECTED. PENDING legal review is reported, never treated as approval.
 */
export function providerTransmissionGate(m: Manifest, provider: (typeof PROVIDERS)[number], today: string): GateResult & { legalReview: Manifest['legalReview'] } {
  const base = governanceGate(m, 'provider_evaluation', today)
  const reasons = [...base.reasons]
  if (!m.providerTransmission.allowed) reasons.push('provider transmission is not allowed for this dataset')
  else if (!m.providerTransmission.providers.includes(provider)) reasons.push(`provider transmission to ${provider} is not allowed`)
  if (!m.leaveEnvironment) reasons.push('the dataset may not leave the evaluation environment')
  if (m.kind === 'real') {
    if (!m.consent.covers.includes('provider_transmission')) reasons.push('consent does not cover provider_transmission')
    if (m.legalReview !== 'APPROVED') reasons.push(`legal review is ${m.legalReview}`)
  }
  return { ...result([...new Set(reasons)]), legalReview: m.legalReview }
}

/** Parses a manifest; errors name the field, never echo values. */
export function parseManifest(raw: unknown): Manifest {
  const r = Manifest.safeParse(raw)
  if (!r.success) throw new Error(`invalid dataset manifest: ${r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`)
  return r.data
}
