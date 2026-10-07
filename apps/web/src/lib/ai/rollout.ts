/**
 * AI rollout (Phase 5.0): decides whether a user may get a real AI feature.
 * Eligibility only — it never calls a provider, the database or the quota,
 * and never touches prompts. The services keep their own paths:
 *
 *   eligible     → the existing provider path (quota, validation, monitoring)
 *   not eligible → the feature's non-AI path (stylist: AI_UNAVAILABLE;
 *                  vision: the deterministic analysis, marked mock; outfit:
 *                  the deterministic engine and explanation)
 *
 * Decision order (see docs/ai/rollout.md):
 *   1. AI configured and production fail-closed — enforced before any request:
 *      parseAiConfig refuses to start otherwise (nothing here can relax it)
 *   2. feature switch off                         → not eligible (feature_disabled)
 *   3. user on the allowlist                      → eligible (allowlisted)
 *   4. stable bucket < AI_ROLLOUT_PERCENT         → eligible (rollout_selected)
 *   5. otherwise                                  → not eligible (rollout_not_selected)
 *
 * The allowlist only skips the percentage (step 4); every later control
 * (quota, validation, monitoring, privacy) still applies.
 *
 * Privacy: the user id is only hashed here. It is never returned, logged or
 * emitted; the decision's reason is a fixed code.
 */
import crypto from 'crypto'
import { getAiConfig, type AiRolloutConfig, type AiRolloutFeature } from './config'

/** Bump to reshuffle every bucket (a new rollout population). */
export const ROLLOUT_BUCKET_NAMESPACE = 'atlas-ai-rollout:v1:'
const ALLOWLIST_NAMESPACE = 'atlas-ai-allowlist:v1:'

export type AiEligibilityReason = 'feature_disabled' | 'allowlisted' | 'rollout_selected' | 'rollout_not_selected'

export interface AiEligibility {
  eligible: boolean
  reason: AiEligibilityReason
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s, 'utf8').digest()

/** The user's stable bucket, 0..99: same id → same bucket, independent of time, order or process. */
export function rolloutBucket(userId: string): number {
  return sha256(ROLLOUT_BUCKET_NAMESPACE + userId).readUInt32BE(0) % 100
}

/** The allowlist form of a user id (what AI_ROLLOUT_ALLOWLIST holds): never the raw id. */
export function allowlistDigest(userId: string): string {
  return sha256(ALLOWLIST_NAMESPACE + userId).toString('hex')
}

export function decideAiEligibility(feature: AiRolloutFeature, userId: string, rollout: AiRolloutConfig = getAiConfig().rollout): AiEligibility {
  if (!rollout.features[feature]) return { eligible: false, reason: 'feature_disabled' }
  if (rollout.allowlist.size > 0 && rollout.allowlist.has(allowlistDigest(userId))) return { eligible: true, reason: 'allowlisted' }
  if (rolloutBucket(userId) < rollout.percent) return { eligible: true, reason: 'rollout_selected' }
  return { eligible: false, reason: 'rollout_not_selected' }
}
