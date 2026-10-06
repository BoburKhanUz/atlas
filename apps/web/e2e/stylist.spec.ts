import { expect, test } from './fixtures'
import { registerViaApi, uploadAll } from './helpers'

// The e2e server runs the mock AI provider: answers are deterministic, labelled
// as a demo, grounded in the user's wardrobe and never use quota.
test.describe('stylist', () => {
  test('a message gets a grounded demo answer that names real items (no internal references); both turns are stored', async ({ page }) => {
    await registerViaApi(page.request)
    await uploadAll(page)

    await page.goto('/stylist')
    await page.waitForLoadState('networkidle')
    await page.getByPlaceholder('Stilistingizdan so').fill('Bugun nima kiyay?')
    const resp = page.waitForResponse((r) => r.url().includes('/api/v1/stylist/chat') && r.request().method() === 'POST')
    await page.getByRole('button', { name: 'Yuborish' }).click()
    const res = await resp
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.assistantMessage).toMatch(/^Demo rejim: /)
    expect(body.assistantMessage).not.toMatch(/W\d/)
    expect(body.contextSummary.wardrobeItemCount).toBe(3)
    await expect(page.getByText(body.assistantMessage)).toBeVisible()

    const conv = await page.request.get(`/api/v1/stylist/conversations/${body.conversationId}`)
    const { conversation } = await conv.json()
    expect(conversation.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant'])
  })

  test('an unknown conversation id is 404 and creates nothing', async ({ page }) => {
    await registerViaApi(page.request)
    const res = await page.request.post('/api/v1/stylist/chat', { data: { message: 'Salom', conversationId: 'conv_does_not_exist' } })
    expect(res.status()).toBe(404)
    expect((await res.json()).code).toBe('NOT_FOUND')
    const list = await (await page.request.get('/api/v1/stylist/conversations')).json()
    expect(list.conversations).toEqual([])
  })
})
