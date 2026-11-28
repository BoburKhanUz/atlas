/**
 * The harness's protocol against `lookly eval` itself (docs/plan/B7.md,
 * B7.4c): its vocabulary is the one Go's vision schema asks for, a dry run
 * asks no provider, and the versions and the colour case come back in the
 * shapes protocol.ts names.
 */
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { CONFIDENCE_KEYS, SUBJECTS } from '../../scripts/ai-eval/catalog'
import { GoPipeline, serveStandIn } from '../../scripts/ai-eval/go-pipeline'
import type { VisionProvider, VisionSetup } from '../../scripts/ai-eval/protocol'
import { renderSynthetic, syntheticVisionItems } from '../../scripts/ai-eval/synthetic-vision'

if (!process.env.LOOKLY_BINARY) throw new Error('LOOKLY_BINARY is not set: build apps/api (go build -tags nodynamic -o <path> ./cmd/lookly) and point it there')

describe("the harness's protocol on Go", () => {
  it('a dry run asks nothing and shows the schema the harness names', async () => {
    let asked = 0
    const vision: VisionProvider = { name: 'never', model: 'offline', analyzeImage: async () => { asked++; throw new Error('a dry run asked the model') } }
    const standIn = await serveStandIn(null, vision)
    const go = new GoPipeline({ args: ['--provider=openai', '--model=offline', `--base-url=${standIn.url}`] })
    try {
      const picture = Buffer.from(await renderSynthetic(syntheticVisionItems()[0])).toString('base64')
      const r = await go.run('vision', { image: picture, maxSide: 512 }, { dryRun: true })
      expect(r.outcome).toBeNull()
      expect(r.calls).toBe(0)
      const setup = r.setup as VisionSetup
      expect(setup.picture?.mimeType).toBe('image/jpeg')
      expect(Math.max(setup.picture!.width, setup.picture!.height)).toBeLessThanOrEqual(512)
      const properties = (setup.schema.schema as { properties: { subject: { enum: string[] }; confidence: { properties: Record<string, unknown> } } }).properties
      expect(properties.subject.enum).toEqual([...SUBJECTS])
      expect(Object.keys(properties.confidence.properties)).toEqual([...CONFIDENCE_KEYS])
    } finally {
      await go.close()
      await standIn.close()
    }
    expect(asked).toBe(0)
  })

  it('the versions and a selfie', async () => {
    const go = new GoPipeline({ args: ['--provider=mock'] })
    try {
      expect(await go.versions()).toEqual({ kind: 'versions', visionAnalysis: 'v2', stylistPrompt: 'v2', rankingPrompt: 'v2', engine: 'outfit-engine-v2', colorAnalysis: 'color-analysis-v2' })
      const dark = await sharp({ create: { width: 320, height: 320, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toBuffer()
      const r = await go.color(dark)
      expect(r.outcome).toEqual({ kind: 'rejected_quality', reason: 'too_dark' })
      expect(r.calls).toBe(0)
    } finally {
      await go.close()
    }
  })
})
