/**
 * MANUAL clothing-vision evaluation (Phase 4.1). Never run in CI: it calls
 * paid provider APIs. See docs/ai/vision-evaluation.md.
 *
 *   GEMINI_API_KEY=… OPENAI_API_KEY=… bun scripts/ai-eval/vision-eval.ts \
 *     --dataset=<dir with labels.json and the photos> \
 *     --matrix=scripts/ai-eval/matrix.example.json \
 *     --out=<results dir outside the repo> [--only=<label,label>] [--limit=N] [--dry-run]
 *
 * Every image goes through the same pipeline as the app (prepareVisionImage →
 * versioned prompt + strict schema → interpretGarmentOutput → colour
 * cross-check), with no retry, no quota and no database. Results: one JSON
 * line per (config, item) in results.jsonl, plus summary.json and summary.md.
 *
 * Privacy: the dataset must hold garment photos only (no faces, no people
 * that could be identified, no personal documents). Records carry the item id,
 * never the image, the file name or a provider payload. Keys come from the
 * environment and are never written anywhere.
 */
import { promises as fs } from 'fs'
import path from 'path'
import { crossCheckPrimaryColor } from '../../src/lib/ai/color-check'
import {
  GARMENT_INSTRUCTION,
  GARMENT_JSON_SCHEMA,
  GARMENT_MAX_OUTPUT_TOKENS,
  InvalidGarmentOutputError,
  VISION_ANALYSIS_VERSION,
  interpretGarmentOutput,
} from '../../src/lib/ai/garment-analysis'
import { isAiProviderError } from '../../src/lib/ai/providers/errors'
import { GeminiProvider } from '../../src/lib/ai/providers/gemini'
import { OpenAIProvider } from '../../src/lib/ai/providers/openai'
import type { VisionProvider } from '../../src/lib/ai/providers/types'
import { prepareVisionImage } from '../../src/lib/ai/providers/vision-input'
import { estimateCostUsd } from '../../src/lib/ai/telemetry'
import { Dataset, Matrix, scoreItem, summarize, type ConfigSummary, type EvalConfig, type ItemOutcome, type ItemRecord } from './vision-scoring'

const KEY_VAR = { gemini: 'GEMINI_API_KEY', openai: 'OPENAI_API_KEY' } as const
const DEFAULT_TIMEOUT_MS = 30_000

function arg(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length)
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(file, 'utf8'))
}

function provider(config: EvalConfig): VisionProvider {
  const apiKey = process.env[KEY_VAR[config.provider]]?.trim()
  if (!apiKey) throw new Error(`${KEY_VAR[config.provider]} is not set (needed by config ${config.label})`)
  return config.provider === 'gemini' ? new GeminiProvider({ apiKey, model: config.model }) : new OpenAIProvider({ apiKey, model: config.model })
}

export async function runOne(p: VisionProvider, config: EvalConfig, bytes: Uint8Array) {
  const prepared = await prepareVisionImage(bytes, config.maxSide)
  const started = performance.now()
  let outcome: ItemOutcome
  let usage: { inputTokens?: number; outputTokens?: number } = {}
  try {
    const result = await p.analyzeImage({
      image: prepared.image,
      mimeType: prepared.mimeType,
      maxSide: prepared.maxSide,
      instruction: GARMENT_INSTRUCTION,
      jsonSchema: { name: 'garment_analysis', schema: GARMENT_JSON_SCHEMA },
      maxOutputTokens: GARMENT_MAX_OUTPUT_TOKENS,
      options: {
        geminiMediaResolution: config.geminiMediaResolution,
        geminiThinkingLevel: config.geminiThinkingLevel,
        openaiDetail: config.openaiDetail,
      },
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    })
    usage = result.metadata.usage
    const interpreted = interpretGarmentOutput(result.output)
    if (interpreted.kind === 'rejected') outcome = { kind: 'rejected', subject: interpreted.subject }
    else {
      const color = await crossCheckPrimaryColor(prepared.image, interpreted.attributes.colors)
      outcome = { kind: 'garment', attributes: interpreted.attributes, rawConfidence: interpreted.rawConfidence, colorVerdict: color.verdict }
    }
  } catch (err) {
    if (err instanceof InvalidGarmentOutputError) outcome = { kind: 'invalid' }
    else if (isAiProviderError(err)) outcome = { kind: 'error', error: err.kind }
    else outcome = { kind: 'error', error: 'unexpected' }
  }
  return { outcome, usage, latencyMs: Math.round(performance.now() - started) }
}

/**
 * Runs one configuration over dataset items (the path both this script and
 * bakeoff.ts use). `onRecord` sees each record as it is produced.
 */
export async function evaluateVisionConfig(
  p: VisionProvider,
  config: EvalConfig,
  datasetDir: string,
  items: Dataset['items'],
  onRecord?: (record: ItemRecord) => Promise<void> | void,
): Promise<{ records: ItemRecord[]; summary: ConfigSummary }> {
  const records: ItemRecord[] = []
  for (const item of items) {
    const bytes = new Uint8Array(await fs.readFile(path.join(datasetDir, item.file)))
    const { outcome, usage, latencyMs } = await runOne(p, config, bytes)
    const record: ItemRecord = {
      config: config.label,
      provider: config.provider,
      model: config.model,
      maxSide: config.maxSide,
      item: item.id,
      latencyMs,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: estimateCostUsd(usage, config.price ?? null),
      outcome,
      ...scoreItem(item.expected, outcome),
    }
    records.push(record)
    await onRecord?.(record)
  }
  return { records, summary: summarize(records, new Map(items.map((i) => [i.id, i.expected]))) }
}

const pct = (n: number | null) => (n === null ? '—' : `${(n * 100).toFixed(1)}%`)

function markdown(summaries: ConfigSummary[]): string {
  const lines = [
    `# Vision evaluation (analysis ${VISION_ANALYSIS_VERSION})`,
    '',
    'Confidence values are the RAW model confidences; they are not calibrated.',
    '',
    '| config | provider | model | maxSide | n | subject | false reject | false accept | invalid | errors | category | subcategory | primary colour | colour conflict | p50 ms | p95 ms | in tok | out tok | $/1000 |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ]
  for (const s of summaries) {
    lines.push(
      `| ${s.config} | ${s.provider} | ${s.model} | ${s.maxSide} | ${s.items} | ${pct(s.subjectAccuracy)} | ${pct(s.falseRejectionRate)} | ${pct(s.falseAcceptanceRate)} | ${pct(s.invalidRate)} | ${pct(s.errorRate)} | ${pct(s.fieldAccuracy.category?.accuracy ?? null)} | ${pct(s.fieldAccuracy.subcategory?.accuracy ?? null)} | ${pct(s.fieldAccuracy.primaryColor?.accuracy ?? null)} | ${pct(s.colorConflictRate)} | ${s.latencyMs.p50} | ${s.latencyMs.p95} | ${s.meanInputTokens ?? '—'} | ${s.meanOutputTokens ?? '—'} | ${s.costPer1000Usd ?? '—'} |`,
    )
  }
  lines.push('', '## Calibration (raw confidence → observed accuracy)', '')
  for (const s of summaries) {
    lines.push(`- **${s.config}**: ${s.calibration.map((b) => `${b.range}: ${pct(b.accuracy)} (n=${b.n})`).join(' · ')}`)
  }
  return lines.join('\n') + '\n'
}

async function main() {
  const datasetDir = arg('dataset')
  const matrixFile = arg('matrix')
  const outDir = arg('out')
  if (!datasetDir || !matrixFile || !outDir) throw new Error('usage: --dataset=<dir> --matrix=<file> --out=<dir> [--only=a,b] [--limit=N] [--dry-run]')
  const repoRoot = path.resolve(__dirname, '../../../..')
  if (!path.relative(repoRoot, path.resolve(outDir)).startsWith('..')) throw new Error('--out must be outside the repository (results are not committed)')

  const dataset = Dataset.parse(await readJson(path.join(datasetDir, 'labels.json')))
  const only = arg('only')?.split(',')
  const configs = Matrix.parse(await readJson(matrixFile)).configs.filter((c) => !only || only.includes(c.label))
  const limit = Number(arg('limit') ?? dataset.items.length)
  const items = dataset.items.slice(0, limit)

  if (process.argv.includes('--dry-run')) {
    for (const i of items) await fs.access(path.join(datasetDir, i.file))
    console.log(`dry run ok: ${items.length} items × ${configs.length} configs = ${items.length * configs.length} provider calls`)
    return
  }

  // Fail before any paid call when a key is missing.
  const providers = new Map(configs.map((c) => [c.label, provider(c)]))
  await fs.mkdir(outDir, { recursive: true })
  const resultsFile = path.join(outDir, 'results.jsonl')
  await fs.writeFile(resultsFile, '')
  const summaries: ConfigSummary[] = []
  for (const config of configs) {
    const { summary } = await evaluateVisionConfig(providers.get(config.label)!, config, datasetDir, items, async (record) => {
      await fs.appendFile(resultsFile, JSON.stringify({ ...record, settings: { ...config, price: undefined } }) + '\n')
      process.stdout.write(`${config.label} ${record.item} ${record.outcome.kind}\n`)
    })
    summaries.push(summary)
  }
  await fs.writeFile(path.join(outDir, 'summary.json'), JSON.stringify(summaries, null, 2) + '\n')
  await fs.writeFile(path.join(outDir, 'summary.md'), markdown(summaries))
  console.log(`done: ${path.join(outDir, 'summary.md')}`)
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
