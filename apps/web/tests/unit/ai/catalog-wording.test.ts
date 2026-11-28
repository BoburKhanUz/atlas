/**
 * The evaluator's Uzbek-label terms (scripts/ai-eval/eval-common.ts) are
 * exactly the words the Go server's runtime wording check refuses
 * (apps/api/internal/engine ForbiddenTerms, which Go's own test holds to
 * testdata/golden/outfit-ai.json): the evaluator fails what the server would.
 */
import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { CATALOG_TERMS } from '../../../scripts/ai-eval/eval-common'

const golden = JSON.parse(readFileSync(path.resolve(__dirname, '../../../../api/testdata/golden/outfit-ai.json'), 'utf8')) as { forbiddenTerms: string[] }

describe('catalog wording', () => {
  it("the evaluator's uzbek_label terms are the server's forbidden terms", () => {
    const evaluator = CATALOG_TERMS.filter((t) => t.status === 'uzbek_label').map((t) => t.words.join(' ')).sort()
    expect(golden.forbiddenTerms.length).toBeGreaterThan(5)
    expect(evaluator).toEqual([...golden.forbiddenTerms].sort())
  })
})
