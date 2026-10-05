import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth, unauthorized } from '@/lib/api-helpers'
import { withApi, parseJson } from '@/server/http'
import { log } from '@/server/log'
import { occasionFromEvent } from '@/server/schemas/catalog'
import { StylistChatRequest } from '@/server/schemas/requests'
import { runStylistTurn, type StylistContext } from '@/lib/ai/stylist'
import type { LLMMessage } from '@/lib/ai/llm-provider'
import { generateOutfits, buildExplanationContext, isCompleteWeather } from '@/lib/ai/recommendation'
import { retrieveKnowledge, formatKnowledgeContext } from '@/lib/ai/fashion-knowledge'
import {
  extractMemoriesFromMessage,
  saveMemories,
  loadMemoriesForContext,
  formatMemoryContext,
} from '@/lib/ai/user-memory'

export const runtime = 'nodejs'
export const maxDuration = 60

// Detect outfit-request intent — if user asks "what should I wear?" type
// questions, we run the recommendation engine and inject the result into the
// LLM context. Spec rule 9: "Recommendation Engine must exist separately
// from LLM" — engine picks, LLM explains.
const OUTFIT_REQUEST_PATTERNS = [
  /nima\s*kiy/i,
  /nima\s*tavsiya/i,
  /outfit/i,
  /kiyishim\s*kerak/i,
  /kiysam\s*bo['']ladi/i,
  /what\s*should\s*i\s*wear/i,
  /ob-havo.*kiy/i,
  /tadbir.*kiy/i,
]

export const POST = withApi(async (req) => {
  const authUser = await requireAuth(req)
  if (!authUser) return unauthorized()

  const { message, conversationId, weather, event } = await parseJson(req, StylistChatRequest)
  // The engine only understands occasion ids; free-text events stay in the
  // LLM context but must not reach the scorer.
  const occasion = occasionFromEvent(event)

  // ── 1. Load user's wardrobe as compact summary for the LLM ───────────────
  // Each item gets a short opaque ref like "A1", "A2" so the LLM can quote it
  // back in its reply (spec section 13).
  const items = await db.wardrobeItem.findMany({
    where: { userId: authUser.sub },
    include: { images: true },
    orderBy: { createdAt: 'asc' },
  })

  const wardrobe = items.map((i, idx) => ({
    category: i.category,
    subcategory: i.subcategory,
    colors: JSON.parse(i.colors) as string[],
    style: i.style,
    material: i.material,
    season: JSON.parse(i.season) as string[],
    ref: `A${idx + 1}`,
  }))

  // ── 2. Load user profile + preferences (all optional) ───────────────────
  const user = await db.user.findUnique({
    where: { id: authUser.sub },
    select: {
      profile: true,
      preferences: true,
    },
  })

  const profile: StylistContext['profile'] = user?.profile
    ? {
        gender: user.profile.gender,
        preferredStyles: user.preferences
          ? (JSON.parse(user.preferences.preferredStyles) as string[])
          : [],
        dislikedStyles: user.preferences
          ? (JSON.parse(user.preferences.dislikedStyles) as string[])
          : [],
        favoriteColors: user.preferences
          ? (JSON.parse(user.preferences.favoriteColors) as string[])
          : [],
        dislikedColors: user.preferences
          ? (JSON.parse(user.preferences.dislikedColors) as string[])
          : [],
        language: user.preferences?.language ?? 'uz',
      }
    : undefined

  // ── 3. Load or create conversation ────────────────────────────────────────
  let conversation = conversationId
    ? await db.aiConversation.findFirst({
        where: { id: conversationId, userId: authUser.sub },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      })
    : null

  if (!conversation) {
    conversation = await db.aiConversation.create({
      data: {
        userId: authUser.sub,
        title: message.slice(0, 60),
        contextJson: JSON.stringify({ weather: weather ?? null, event: event ?? null }),
      },
      include: { messages: true },
    })
  }

  // Build conversation history for the LLM (only last 12 messages to stay in
  // token budget). Spec section 13 — must feel like an ongoing conversation.
  const history: LLMMessage[] = (conversation.messages ?? [])
    .slice(-12)
    .map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    })) as LLMMessage[]

  // ── 4. Save the user's message first ──────────────────────────────────────
  await db.aiMessage.create({
    data: {
      conversationId: conversation.id,
      role: 'user',
      content: message,
      metadataJson: JSON.stringify({ weather, event }),
    },
  })

  // ── 4a. Extract user preferences / statements from the message (Phase 6)
  // Spec section 6 + 14: store as user-specific memory, never retrain a
  // global model. Conservative regex-based extraction.
  const extractedMemories = extractMemoriesFromMessage(message)
  if (extractedMemories.length > 0) {
    try {
      await saveMemories(authUser.sub, extractedMemories)
    } catch (err) {
      // Soft-fail — memory save should not block the chat response
      log.warn('stylist: saveMemories failed', { err })
    }
  }

  // ── 4b. Load recent memories for context (Phase 6)
  // The LLM should know what the user has told us before. Limit to 12 entries.
  const memories = await loadMemoriesForContext(authUser.sub, 12)
  const memoryContext = formatMemoryContext(memories)

  // ── 4c. Retrieve relevant fashion knowledge rules (Phase 6 RAG)
  // Keyword-based retrieval from the in-code knowledge base. Spec section 14:
  // "RAG should complement structured data, not replace it."
  const relevantRules = retrieveKnowledge(message, 5)
  const knowledgeContext = formatKnowledgeContext(relevantRules)

  // ── 5. Run the LLM turn with full wardrobe + weather + event context ──────
  // If the user's message looks like an outfit-request question (e.g.,
  // "Bugun nima kiyaman?"), we run the recommendation engine FIRST and
  // inject the top candidate into the LLM context as a system hint.
  // Spec rule 9: engine picks the outfit, LLM explains it in natural language.
  const isOutfitRequest = OUTFIT_REQUEST_PATTERNS.some((p) => p.test(message))
  let engineHint: string | null = null
  if (isOutfitRequest && items.length > 0) {
    try {
      // Feed the engine the full DB rows — the LLM summary above omits id,
      // pattern, fit, formality etc., which the scorer needs.
      const candidates = generateOutfits({
        wardrobe: items.map((i) => ({
          id: i.id,
          category: i.category,
          subcategory: i.subcategory,
          colors: JSON.parse(i.colors) as string[],
          pattern: i.pattern,
          material: i.material,
          sleeveLength: i.sleeveLength,
          fit: i.fit,
          style: i.style,
          season: JSON.parse(i.season) as string[],
          gender: i.gender,
          formality: i.formality,
        })),
        weather: isCompleteWeather(weather) ? weather : undefined,
        occasion,
        profile,
        topN: 1,
      })
      if (candidates.length > 0) {
        engineHint = buildExplanationContext(candidates[0], occasion)
      }
    } catch (err) {
      log.error('stylist: recommendation engine error', { err })
      // Soft-fail: continue without engine hint — LLM falls back to general
    }
  }

  let assistantText: string
  let contextSummary: { wardrobeItemCount: number; weatherProvided: boolean; eventProvided: boolean }
  try {
    const result = await runStylistTurn(
      message,
      history,
      {
        wardrobe,
        weather: weather ?? undefined,
        event: event ?? undefined,
        profile,
      },
      engineHint,
      // Phase 6: memory + RAG knowledge as additional context blocks
      memoryContext,
      knowledgeContext,
    )
    assistantText = result.assistantMessage
    contextSummary = result.contextSummary
  } catch (err) {
    // Soft-fail: if the LLM is unavailable, give the user a clear message
    // rather than a 500. Spec: must feel like intelligent stylist — errors
    // should be honest, not masked.
    log.error('stylist: LLM error', { err })
    assistantText =
      'Kechirasiz, hozir AI stilist javob bera olmaydi. Iltimos, bir necha soniyadan so‘ng qayta urinib ko‘ring.'
    contextSummary = {
      wardrobeItemCount: wardrobe.length,
      weatherProvided: !!weather,
      eventProvided: !!event,
    }
  }

  // ── 6. Persist the assistant message ─────────────────────────────────────
  await db.aiMessage.create({
    data: {
      conversationId: conversation.id,
      role: 'assistant',
      content: assistantText,
      metadataJson: JSON.stringify({
        ...contextSummary,
        provider: 'zai',
      }),
    },
  })

  // Update the conversation's updatedAt so it floats to the top
  await db.aiConversation.update({
    where: { id: conversation.id },
    data: { updatedAt: new Date() },
  })

  return NextResponse.json({
    conversationId: conversation.id,
    assistantMessage: assistantText,
    contextSummary,
  })
})
