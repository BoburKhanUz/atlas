import { expect, test } from './fixtures'
import { signUpMobile, upload } from './helpers'

/** The stylist chat (the mock in the test environment) and its conversations. */
test.describe('stylist', () => {
  test('a turn is answered and kept; the same key answers again; a conversation is its owner’s', async ({ api }) => {
    const s = await signUpMobile(api, 'chat')
    await upload(api, s, 'shirt')
    const key = `api-e2e-chat-${Date.now()}`
    const first = await api.post('/api/v1/stylist/chat', { bearer: s.accessToken, headers: { 'Idempotency-Key': key }, data: { message: 'Ertaga ishga nima kiyay?' } })
    expect(first.status).toBe(200)
    const conversationId = first.body.conversationId as string
    expect(typeof first.body.assistantMessage).toBe('string')

    const replay = await api.post('/api/v1/stylist/chat', { bearer: s.accessToken, headers: { 'Idempotency-Key': key }, data: { message: 'Ertaga ishga nima kiyay?' } })
    expect(replay.status).toBe(200)
    expect(replay.headers['idempotent-replayed']).toBe('true')
    expect(replay.body.conversationId).toBe(conversationId)

    const next = await api.post('/api/v1/stylist/chat', { bearer: s.accessToken, data: { message: 'Kechqurun-chi?', conversationId } })
    expect(next.status).toBe(200)

    const list = await api.get('/api/v1/stylist/conversations', { bearer: s.accessToken })
    expect((list.body.conversations as Array<{ id: string }>).map((c) => c.id)).toEqual([conversationId])
    const one = await api.get(`/api/v1/stylist/conversations/${conversationId}`, { bearer: s.accessToken })
    expect((one.body.conversation as { messages: unknown[] }).messages).toHaveLength(4)

    const stranger = await signUpMobile(api, 'str')
    expect((await api.get(`/api/v1/stylist/conversations/${conversationId}`, { bearer: stranger.accessToken })).status).toBe(404)
    const intrude = await api.post('/api/v1/stylist/chat', { bearer: stranger.accessToken, data: { message: 'Salom', conversationId } })
    expect([intrude.status, intrude.body.code]).toEqual([404, 'NOT_FOUND'])
  })
})
