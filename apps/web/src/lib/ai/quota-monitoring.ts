/**
 * Quota calls with monitoring: the same consume/refund semantics as quota.ts,
 * plus one content-free `ai.quota` event per decision (no user id).
 *
 * - chargeQuota: `charged` or `rejected`; a store failure emits `store_error`
 *   and rethrows (callers keep their existing handling).
 * - refundQuota: `refunded` with the reason; a failed refund is logged and
 *   emits `store_error`, and never throws (as before).
 */
import { log } from '@/server/log'
import { recordAiQuota, type AiRequestFeature } from './monitoring'
import { consumeAiQuota, refundAiQuota, type QuotaDecision } from './quota'

export async function chargeQuota(userId: string, feature: AiRequestFeature, provider: string, at: Date): Promise<QuotaDecision> {
  let decision: QuotaDecision
  try {
    decision = await consumeAiQuota(userId, feature, at)
  } catch (err) {
    recordAiQuota({ feature, provider, action: 'store_error', reason: 'consume_failed' })
    throw err
  }
  recordAiQuota({ feature, provider, action: decision.allowed ? 'charged' : 'rejected' })
  return decision
}

export async function refundQuota(userId: string, feature: AiRequestFeature, provider: string, at: Date, reason: string): Promise<void> {
  try {
    await refundAiQuota(userId, feature, at)
    recordAiQuota({ feature, provider, action: 'refunded', reason })
  } catch (err) {
    log.error('ai quota refund failed', { err })
    recordAiQuota({ feature, provider, action: 'store_error', reason: 'refund_failed' })
  }
}
