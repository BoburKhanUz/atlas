import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth, unauthorized } from '@/lib/api-helpers'
import { ApiError, withApi, parseJson } from '@/server/http'
import { log } from '@/server/log'
import { occasionFromEvent } from '@/server/schemas/catalog'
import { StylistChatRequest } from '@/server/schemas/requests'
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  idempotencyKeyOf,
  jsonRequestHash,
  releaseIdempotencyKey,
  type Claim,
} from '@/server/idempotency'
import { generateOutfits, isCompleteWeather, type OutfitCandidate } from '@/lib/ai/recommendation'
import { buildStylistContext, type WardrobeRow } from '@/lib/ai/stylist-context'
import { runStylistTurn, StylistError, type StylistTurnResult } from '@/lib/ai/stylist-service'
import { recordAiRequest } from '@/lib/ai/monitoring'
import { getLLMProvider } from '@/lib/ai/providers'
import { refundQuota } from '@/lib/ai/quota-monitoring'

export const runtime = 'nodejs'
export const maxDuration = 60

const ROUTE = 'POST /api/v1/stylist/chat'
const AI_UNAVAILABLE_RETRY_AFTER = '15'
/** History rows loaded per turn (the context keeps the last 12 meaningful ones). */
const HISTORY_ROWS = 60

const json = <T>(raw: string, fallback: T): T => {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

interface ContextSummary {
  wardrobeItemCount: number
  weatherProvided: boolean
  eventProvided: boolean
}

/** The original response of an earlier request with the same Idempotency-Key. */
async function replay(userId: string, assistantMessageId: string | null) {
  const message = assistantMessageId
    ? await db.aiMessage.findFirst({ where: { id: assistantMessageId, role: 'assistant', conversation: { userId } } })
    : null
  // The conversation was deleted since: nothing to replay.
  if (!message) throw new ApiError('NOT_FOUND')
  const meta = json<Partial<ContextSummary>>(message.metadataJson, {})
  return NextResponse.json(
    {
      conversationId: message.conversationId,
      assistantMessage: message.content,
      contextSummary: {
        wardrobeItemCount: meta.wardrobeItemCount ?? 0,
        weatherProvided: meta.weatherProvided ?? false,
        eventProvided: meta.eventProvided ?? false,
      },
    },
    { headers: { 'Idempotent-Replayed': 'true' } },
  )
}

/**
 * POST /api/v1/stylist/chat — one stylist turn.
 *
 * auth → validate → conversation ownership (unknown or foreign → 404) →
 * Idempotency-Key (optional; replay returns the stored answer) → bounded
 * context → quota (real providers) → provider → validation and grounding →
 * user message + answer stored together in one transaction → 200.
 *
 * Nothing is stored unless the whole turn succeeds: AI_UNAVAILABLE (503),
 * AI_QUOTA_EXCEEDED (429) and every other error leave the conversation as it
 * was, so a 503 or 429 is a definite "not stored" for the client.
 */
export const POST = withApi(async (req) => {
  const authUser = await requireAuth(req)
  if (!authUser) return unauthorized()
  const userId = authUser.sub

  const body = await parseJson(req, StylistChatRequest)
  const { message, conversationId, weather } = body
  const event = body.event ? body.event : null // "" after trimming means none
  const idempotencyKey = idempotencyKeyOf(req)

  // ── 1. Ownership: an unknown or foreign id is 404, never a new conversation.
  const conversation = conversationId
    ? await db.aiConversation.findFirst({ where: { id: conversationId, userId }, select: { id: true } })
    : null
  if (conversationId && !conversation) throw new ApiError('NOT_FOUND', 'Suhbat topilmadi.')

  // ── 2. Idempotency: claim before any AI work.
  let claim: Extract<Claim, { kind: 'claimed' }> | null = null
  if (idempotencyKey) {
    const result = await claimIdempotencyKey(db, {
      userId,
      route: ROUTE,
      key: idempotencyKey,
      requestHash: jsonRequestHash({ message, conversationId: conversationId ?? null, weather: weather ?? null, event }),
    })
    if (result.kind === 'replay') {
      recordAiRequest({ feature: 'stylist_chat', provider: getLLMProvider().name, outcome: 'replay', billable: false })
      return replay(userId, result.resourceId)
    }
    claim = result
  }

  let turn: StylistTurnResult | null = null
  try {
    // ── 3. Load what the context may use.
    const [rows, user, history] = await Promise.all([
      db.wardrobeItem.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
      db.user.findUnique({ where: { id: userId }, select: { profile: { include: { colorProfile: true } }, preferences: true } }),
      conversation
        ? db.aiMessage.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: 'desc' }, take: HISTORY_ROWS })
        : Promise.resolve([]),
    ])
    const items: WardrobeRow[] = rows.map((i) => ({
      id: i.id,
      category: i.category,
      subcategory: i.subcategory,
      colors: json<string[]>(i.colors, []),
      pattern: i.pattern,
      material: i.material,
      sleeveLength: i.sleeveLength,
      fit: i.fit,
      style: i.style,
      season: json<string[]>(i.season, []),
      gender: i.gender,
      formality: i.formality,
      createdAt: i.createdAt,
    }))
    const prefs = user?.preferences
    const preferences = {
      preferredStyles: prefs ? json<string[]>(prefs.preferredStyles, []) : [],
      dislikedStyles: prefs ? json<string[]>(prefs.dislikedStyles, []) : [],
      favoriteColors: prefs ? json<string[]>(prefs.favoriteColors, []) : [],
      dislikedColors: prefs ? json<string[]>(prefs.dislikedColors, []) : [],
      preferredFit: user?.profile?.preferredFit ?? null,
    }
    const cp = user?.profile?.colorProfile
    const colorProfile = cp
      ? {
          season: cp.season,
          undertone: cp.undertone,
          contrastLevel: cp.contrastLevel,
          recommendedColors: json<string[]>(cp.recommendedColors, []),
          neutralColors: json<string[]>(cp.neutralColors, []),
          cautionColors: json<string[]>(cp.cautionColors, []),
        }
      : null
    // Only a complete snapshot counts; the app sends weather only while it is fresh.
    const currentWeather = isCompleteWeather(weather) ? weather : undefined
    const occasion = occasionFromEvent(event)

    // ── 4. Deterministic outfit candidates (the engine picks; the model explains).
    let candidates: OutfitCandidate[] = []
    if (items.length > 0) {
      try {
        candidates = generateOutfits({
          wardrobe: items,
          weather: currentWeather,
          occasion,
          profile: { gender: user?.profile?.gender ?? null, ...preferences },
          topN: 3,
        })
      } catch (err) {
        log.error('stylist: recommendation engine error', { err })
      }
    }

    const context = buildStylistContext({ items, candidates, occasion, weather: currentWeather, preferences, colorProfile })
    const contextSummary: ContextSummary = {
      wardrobeItemCount: context.refs.length,
      weatherProvided: !!currentWeather,
      eventProvided: !!event,
    }

    // ── 5. The AI turn (quota, provider, grounding).
    turn = await runStylistTurn({
      userId,
      message,
      occasionText: event,
      context,
      history: history.reverse().map((m) => ({ role: m.role, content: m.content, metadata: json<unknown>(m.metadataJson, {}) })),
    })
    const answer = turn

    // ── 6. Store the exchange atomically (and complete the key in the same transaction).
    const userAt = new Date()
    const assistantAt = new Date(userAt.getTime() + 1)
    const saved = await db.$transaction(async (tx) => {
      const conv =
        conversation ??
        (await tx.aiConversation.create({
          data: { userId, title: message.slice(0, 60), contextJson: JSON.stringify({ weather: weather ?? null, event }) },
          select: { id: true },
        }))
      await tx.aiMessage.create({
        data: { conversationId: conv.id, role: 'user', content: message, createdAt: userAt, metadataJson: JSON.stringify({ weather: weather ?? null, event }) },
      })
      const assistant = await tx.aiMessage.create({
        data: {
          conversationId: conv.id,
          role: 'assistant',
          content: answer.text,
          createdAt: assistantAt,
          metadataJson: JSON.stringify({
            ...contextSummary,
            provider: answer.provider,
            model: answer.model,
            promptVersion: answer.promptVersion,
            referencedItemIds: answer.referencedItemIds,
            needsMoreInfo: answer.needsMoreInfo,
          }),
        },
      })
      await tx.aiConversation.update({ where: { id: conv.id }, data: { updatedAt: assistantAt } })
      if (claim) await completeIdempotencyKey(tx, claim, assistant.id, 200)
      return { conversationId: conv.id }
    })

    return NextResponse.json({ conversationId: saved.conversationId, assistantMessage: answer.text, contextSummary })
  } catch (err) {
    if (claim) await releaseIdempotencyKey(db, claim).catch(() => {})
    // The provider answered but storing failed: give the call back.
    if (turn?.chargedAt) await refundQuota(userId, 'stylist_chat', turn.provider, turn.chargedAt, 'storage_failed')
    if (err instanceof StylistError) {
      if (err.failure.kind === 'quota_exceeded') {
        throw new ApiError('AI_QUOTA_EXCEEDED', 'Bugungi AI stilist limiti tugadi. Limit Toshkent vaqti bilan yarim tunda yangilanadi.', undefined, {
          'Retry-After': String(err.failure.retryAfterSeconds),
        })
      }
      throw new ApiError('AI_UNAVAILABLE', 'AI stilist hozir javob bera olmadi. Xabaringiz saqlanmadi — birozdan so‘ng qayta yuboring.', undefined, {
        'Retry-After': AI_UNAVAILABLE_RETRY_AFTER,
      })
    }
    throw err
  }
})
