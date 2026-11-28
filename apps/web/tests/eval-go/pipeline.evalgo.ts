/**
 * The Go pipeline's process wrapper (go-pipeline.ts): what happens when
 * `lookly eval` is gone. The offline records themselves are held by
 * offline-golden.evalgo.ts.
 */
import { describe, expect, it } from 'vitest'
import { GoPipeline } from '../../scripts/ai-eval/go-pipeline'

if (!process.env.LOOKLY_BINARY) throw new Error('LOOKLY_BINARY is not set: build apps/api (go build -tags nodynamic -o <path> ./cmd/lookly) and point it there')

describe('the Go pipeline process', () => {
  it('a lookly eval that is gone refuses every case with its reason, and closes', async () => {
    // Go refuses its flags and exits at once: a case sent before and after that.
    const refused = new GoPipeline({ args: ['--provider=nobody'] })
    await expect(refused.run('stylist', {})).rejects.toThrow(/exited \(2\)[^]*--provider must be/)
    await expect(refused.run('stylist', {})).rejects.toThrow(/exited \(2\)/)
    await refused.close()
    // No such binary.
    const missing = new GoPipeline({ args: [], binary: '/nonexistent/lookly' })
    await expect(missing.run('stylist', {})).rejects.toThrow(/could not be started/)
    await missing.close()
  })
})
