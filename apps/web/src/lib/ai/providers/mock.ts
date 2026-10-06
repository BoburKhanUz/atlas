/**
 * Deterministic mock provider for development and tests. It never calls a
 * network and is refused in production (see ../config.ts). Its text is
 * labelled as a demo so nobody mistakes it for a real AI answer.
 */
import type { LLMProvider, LLMRequest, LLMResult, VisionProvider, VisionRequest, VisionResult } from './types'
import { assertVisionRequest } from './vision-input'

export const MOCK_LLM_TEXT = 'Demo rejim: AI stilist hali ulanmagan. Bu javob haqiqiy AI tomonidan yozilmagan.'

export interface MockOptions {
  /** Replaces the default reply (tests). */
  respond?: (req: LLMRequest) => string | Promise<string>
  /** Replaces the default vision output (tests). */
  see?: (req: VisionRequest) => unknown | Promise<unknown>
}

export class MockProvider implements LLMProvider, VisionProvider {
  readonly name = 'mock'
  readonly model = 'mock'

  constructor(private readonly opts: MockOptions = {}) {}

  async generate(req: LLMRequest): Promise<LLMResult> {
    const text = this.opts.respond ? await this.opts.respond(req) : req.jsonSchema ? '{}' : MOCK_LLM_TEXT
    return { text, metadata: { provider: this.name, model: this.model, usage: {} } }
  }

  async analyzeImage(req: VisionRequest): Promise<VisionResult> {
    assertVisionRequest(this.name, req)
    const output = this.opts.see ? await this.opts.see(req) : {}
    return { output, metadata: { provider: this.name, model: this.model, usage: {} } }
  }
}
