/**
 * What each case becomes before a model is asked (docs/plan/B7.md, B7.4d):
 * Go's own setup (`lookly eval` with dryRun: the stylist's references and
 * messages, the outfit engine's candidates, the profile's use, the
 * deterministic explanation), frozen in case-setups.json so that scoring,
 * replays and reviews need no Go binary. A setup depends only on the request
 * sent to Go, so the file is keyed by the request's SHA-256; a case whose
 * request is not in it is refused, never scored against a guess. Each
 * distinct message text is stored once (`texts`; a message names its index).
 * tests/eval-go/case-setups.evalgo.ts holds the file to Go. After a change to
 * the cases, the prompts or the engine:
 *
 *   LOOKLY_BINARY=<built lookly> bun scripts/ai-eval/case-setups.ts
 */
import crypto from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { GoPipeline, outfitRequest, stylistRequest } from './go-pipeline'
import { outfitCases, type OutfitCase } from './outfit-cases'
import type { LLMMessage, OutfitSetup, StylistSetup } from './protocol'
import { stylistRealisticCases } from './real-data/stylist-realistic-cases'
import { preferencesCase, stylistCases, type StylistCase } from './stylist-cases'

const FILE = path.resolve(__dirname, 'case-setups.json')
const REGENERATE = 'LOOKLY_BINARY=<built lookly> bun scripts/ai-eval/case-setups.ts'

export interface CaseSetups {
  stylist: Record<string, StylistSetup>
  outfit: Record<string, OutfitSetup>
}

type Stored<T> = Omit<T, 'messages'> & { messages: Array<{ role: LLMMessage['role']; content: number }> }

/** The file: the setups with each message's text replaced by its index in `texts`. */
interface SetupsFile {
  generatedBy: string
  texts: string[]
  stylist: Record<string, Stored<StylistSetup>>
  outfit: Record<string, Stored<OutfitSetup>>
}

/** The file's form of the setups (each distinct text once), and back. */
export function pack(setups: CaseSetups): Omit<SetupsFile, 'generatedBy'> {
  const texts: string[] = []
  const index = new Map<string, number>()
  const packed = <T extends { messages: LLMMessage[] }>(table: Record<string, T>) =>
    Object.fromEntries(Object.entries(table).map(([k, v]) => [k, { ...v, messages: v.messages.map((m) => {
      if (!index.has(m.content)) index.set(m.content, texts.push(m.content) - 1)
      return { role: m.role, content: index.get(m.content)! }
    }) }]))
  return { texts, stylist: packed(setups.stylist), outfit: packed(setups.outfit) } as Omit<SetupsFile, 'generatedBy'>
}

export function unpack(file: Omit<SetupsFile, 'generatedBy'>): CaseSetups {
  const text = (i: number) => {
    if (!Number.isInteger(i) || i < 0 || i >= file.texts.length) throw new Error(`case-setups.json names text ${i}, which it does not have`)
    return file.texts[i]
  }
  const unpacked = <T>(table: Record<string, Stored<T>>) =>
    Object.fromEntries(Object.entries(table).map(([k, v]) => [k, { ...v, messages: v.messages.map((m) => ({ role: m.role, content: text(m.content) })) }])) as unknown as Record<string, T>
  return { stylist: unpacked<StylistSetup>(file.stylist), outfit: unpacked<OutfitSetup>(file.outfit) }
}

/** The key of a request: the SHA-256 of its JSON, as sent to Go. */
export const requestKey = (request: unknown) => crypto.createHash('sha256').update(JSON.stringify(request)).digest('hex')

let loaded: CaseSetups | null = null
/** The frozen setups (case-setups.json). */
export const frozenSetups = (): CaseSetups => (loaded ??= unpack(JSON.parse(readFileSync(FILE, 'utf8')) as SetupsFile))
const setups = frozenSetups

function lookup<T>(table: Record<string, T>, feature: string, id: string, request: unknown): T {
  const found = table[requestKey(request)]
  if (!found) throw new Error(`no ${feature} setup for case ${id}: its request is not in case-setups.json (${REGENERATE})`)
  return found
}

export const stylistSetupOf = (c: StylistCase): StylistSetup => lookup(setups().stylist, 'stylist', c.id, stylistRequest(c))
export const outfitSetupOf = (c: OutfitCase): OutfitSetup => lookup(setups().outfit, 'outfit', c.id, outfitRequest(c))

/** Every case whose setup is kept: the scripted sets, the preferences case, the constructed realistic stylist set. */
export const keptStylistCases = (): StylistCase[] => [...stylistCases(), preferencesCase(), ...stylistRealisticCases()]
export const keptOutfitCases = (): OutfitCase[] => outfitCases()

/** Go's setups of the kept cases, by request key. */
export async function collectSetups(go: GoPipeline): Promise<CaseSetups> {
  const stylist: CaseSetups['stylist'] = {}
  for (const c of keptStylistCases()) {
    const request = stylistRequest(c)
    stylist[requestKey(request)] = (await go.run('stylist', request, { dryRun: true })).setup as StylistSetup
  }
  const outfit: CaseSetups['outfit'] = {}
  for (const c of keptOutfitCases()) {
    const request = outfitRequest(c)
    outfit[requestKey(request)] = (await go.run('outfit', request, { dryRun: true })).setup as OutfitSetup
  }
  return { stylist, outfit }
}

async function main() {
  const go = new GoPipeline({ args: ['--provider=mock'] })
  try {
    const collected = await collectSetups(go)
    writeFileSync(FILE, JSON.stringify({ generatedBy: 'scripts/ai-eval/case-setups.ts (lookly eval, dryRun)', ...pack(collected) }, null, 1) + '\n')
    console.log(`wrote ${FILE}: ${Object.keys(collected.stylist).length} stylist and ${Object.keys(collected.outfit).length} outfit setups`)
  } finally {
    await go.close()
  }
}

if (require.main === module) main().catch((err) => {
  console.error(err)
  process.exit(1)
})
