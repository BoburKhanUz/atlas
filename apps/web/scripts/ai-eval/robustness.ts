/**
 * Offline adversarial suite (Phase 4.5): scripted providers that misbehave on
 * purpose — invalid references, malformed output, provider failure, invented
 * candidates — run through the same harness path as a live provider. Each
 * scenario states the outcome the app must produce. Deterministic; no network.
 */
import { AiProviderError } from '../../src/lib/ai/providers/errors'
import type { LLMProvider, LLMRequest } from '../../src/lib/ai/providers/types'
import { outfitCases } from './outfit-cases'
import { runOutfitCase } from './outfit-eval'
import { stylistCases } from './stylist-cases'
import { runStylistCase } from './stylist-eval'

type Step = (req: LLMRequest) => string

class Adversarial implements LLMProvider {
  readonly name = 'scripted-adversarial'
  readonly model = 'offline'
  calls = 0
  constructor(private readonly steps: Step[]) {}
  async generate(req: LLMRequest) {
    const step = this.steps[Math.min(this.calls, this.steps.length - 1)]
    this.calls++
    return { text: step(req), metadata: { provider: this.name, model: this.model, usage: {} } }
  }
}

const refsOf = (req: LLMRequest, field: 'referencedItems' | 'ranking') =>
  ((req.jsonSchema!.schema as { properties: Record<string, { items: { enum?: string[] } }> }).properties[field].items.enum ?? [])
const fail: Step = () => {
  throw new AiProviderError('unavailable', 'scripted-adversarial')
}
const stylistAnswer = (refs: (req: LLMRequest) => string[]): Step => (req) => {
  const r = refs(req)
  return JSON.stringify({ answer: `Bugun ${r.map((x) => `[${x}]`).join(' va ')} kiying, bu sizga mos.`, referencedItems: r, needsMoreInfo: false })
}
const ranking = (pick: (refs: string[]) => string[], explanation = 'Bu obraz qulay va sizga mos.'): Step => (req) => {
  const r = pick(refsOf(req, 'ranking'))
  return JSON.stringify({ selectedCandidate: r[0], ranking: r, explanation, needsMoreInfo: false })
}

export interface RobustnessResult {
  feature: 'stylist' | 'outfit'
  scenario: string
  expected: string
  actual: string
  calls: number
  pass: boolean
}

export async function runRobustness(): Promise<RobustnessResult[]> {
  const sCase = stylistCases()[0]
  const oCase = outfitCases()[0]
  const out: RobustnessResult[] = []
  const stylist = async (scenario: string, expected: string, steps: Step[]) => {
    const p = new Adversarial(steps)
    const r = await runStylistCase(p, sCase)
    const actual = r.outcome.kind === 'answer' ? `answer${r.outcome.firstError ? `_after_${r.outcome.firstError}` : ''}` : r.outcome.kind === 'invalid' ? `refused_${r.outcome.firstError}` : `error_${r.outcome.error}`
    out.push({ feature: 'stylist', scenario, expected, actual, calls: p.calls, pass: actual === expected })
  }
  const outfit = async (scenario: string, expected: string, steps: Step[]) => {
    const p = new Adversarial(steps)
    const r = await runOutfitCase(p, oCase)
    const actual = r.outcome.kind === 'ranked' ? `ranked${r.outcome.firstError ? `_after_${r.outcome.firstError}` : ''}` : r.outcome.kind === 'invalid' ? `fallback_${r.outcome.finalError}` : `fallback_error_${r.outcome.error}`
    out.push({ feature: 'outfit', scenario, expected, actual, calls: p.calls, pass: actual === expected })
  }

  // Stylist: the user gets either a grounded answer or AI_UNAVAILABLE ("refused"/"error"), never invented items.
  await stylist('invalid model references, then corrected', 'answer_after_invalid_reference', [stylistAnswer(() => ['W99']), stylistAnswer((req) => refsOf(req, 'referencedItems').slice(0, 2))])
  await stylist('invalid model references twice', 'refused_invalid_reference', [stylistAnswer(() => ['W99'])])
  await stylist('reference written in the text only', 'refused_invalid_reference', [() => JSON.stringify({ answer: 'Bugun [W77] kiying.', referencedItems: [], needsMoreInfo: false })])
  await stylist('malformed JSON (never retried)', 'refused_schema', [() => 'not json'])
  await stylist('extra field in the output', 'refused_schema', [() => JSON.stringify({ answer: 'x', referencedItems: [], needsMoreInfo: false, items: ['new'] })])
  await stylist('provider failure (retried once)', 'error_unavailable', [fail])

  // Outfit AI: anything but a valid ranking of the engine's candidates ends in the deterministic fallback.
  await outfit('valid ranking', 'ranked', [ranking((r) => [...r].reverse())])
  await outfit('candidate invention, then corrected', 'ranked_after_unknown_selected', [ranking((r) => ['O9', ...r.slice(1)]), ranking((r) => r)])
  await outfit('candidate invention twice', 'fallback_unknown_selected', [ranking((r) => ['O9', ...r.slice(1)])])
  await outfit('incomplete ranking twice', 'fallback_incomplete_ranking', [ranking((r) => r.slice(0, 1))])
  await outfit('reference in the explanation twice', 'fallback_reference_in_explanation', [ranking((r) => r, 'O1 eng yaxshisi.')])
  await outfit('malformed JSON twice', 'fallback_not_json', [() => 'not json'])
  await outfit('provider failure (retried once)', 'fallback_error_unavailable', [fail])
  return out
}
