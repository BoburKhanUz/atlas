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
import { applyVisionRubric } from './eval-rubric'
import { estimateCostUsd, visionDatasetIdentity } from './live-accounting'
import { GoPipeline, openGoPipeline, refuseRemovedPipelineFlag, requireProviderKey } from './go-pipeline'
import { Dataset, Matrix, scoreItem, summarize, validateExpected, type ConfigSummary, type EvalConfig, type ItemOutcome, type ItemRecord } from './vision-scoring'

const DEFAULT_TIMEOUT_MS = 30_000

function arg(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length)
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(file, 'utf8'))
}

/**
 * runOne through the Go server's pipeline (`lookly eval`, stage B6.9): the
 * same picture preparation, prompt, schema, interpretation and colour
 * cross-check, on the server's own code.
 */
export async function runOneGo(go: GoPipeline, config: EvalConfig, bytes: Uint8Array) {
  const r = await go.run('vision', {
    image: Buffer.from(bytes).toString('base64'), maxSide: config.maxSide, timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    geminiMediaResolution: config.geminiMediaResolution, geminiThinkingLevel: config.geminiThinkingLevel, openaiDetail: config.openaiDetail,
  })
  return { outcome: r.outcome as ItemOutcome, usage: { inputTokens: r.inputTokens, outputTokens: r.outputTokens }, latencyMs: r.latencyMs, calls: r.calls }
}

/**
 * Runs one configuration over dataset items (the path both this script and
 * bakeoff.ts use). `onRecord` sees each record as it is produced.
 */
export async function evaluateVisionConfig(
  /** The Go pipeline set to this configuration's provider and model. */
  go: GoPipeline,
  config: EvalConfig,
  datasetDir: string,
  items: Dataset['items'],
  onRecord?: (record: ItemRecord) => Promise<void> | void,
  /** Reads one image (bakeoff.ts verifies each image against its frozen hash here). */
  readImage: (file: string) => Promise<Uint8Array> = async (file) => new Uint8Array(await fs.readFile(file)),
  /** Told the provider calls of each item on the Go pipeline (the run's cap). */
  onCalls?: (calls: number) => void,
): Promise<{ records: ItemRecord[]; summary: ConfigSummary }> {
  const records: ItemRecord[] = []
  for (const item of items) {
    const bytes = await readImage(path.join(datasetDir, item.file))
    const { outcome, usage, latencyMs, calls } = await runOneGo(go, config, bytes)
    onCalls?.(calls)
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

function markdown(summaries: ConfigSummary[], analysisVersion: string): string {
  const lines = [
    `# Vision evaluation (analysis ${analysisVersion})`,
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
  if (!datasetDir || !matrixFile || !outDir) throw new Error('usage: --dataset=<dir> --matrix=<file> --out=<dir> --max-calls=N [--only=a,b] [--limit=N] [--dry-run]')
  refuseRemovedPipelineFlag()
  // Each configuration runs through the Go server's pipeline (lookly eval); --max-calls caps the whole run.
  const maxCalls = Number(arg('max-calls'))
  if (!process.argv.includes('--dry-run') && !(Number.isInteger(maxCalls) && maxCalls > 0)) throw new Error('a vision run needs --max-calls=N (paid calls: owner rule 4), the cap of the whole run')
  const repoRoot = path.resolve(__dirname, '../../../..')
  if (!path.relative(repoRoot, path.resolve(outDir)).startsWith('..')) throw new Error('--out must be outside the repository (results are not committed)')

  const parsed = Dataset.parse(await readJson(path.join(datasetDir, 'labels.json')))
  // Same evaluator rubric as the bake-off, pinned to the dataset's verified identity (eval-rubric.ts).
  const dataset = { ...parsed, items: applyVisionRubric(await visionDatasetIdentity(datasetDir, parsed), parsed.items, validateExpected) }
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
  for (const c of configs) requireProviderKey(c.provider)
  let used = 0
  await fs.mkdir(outDir, { recursive: true })
  const resultsFile = path.join(outDir, 'results.jsonl')
  await fs.writeFile(resultsFile, '')
  const summaries: ConfigSummary[] = []
  for (const config of configs) {
    // One `lookly eval` per configuration, capped at what is left of the run's calls.
    const go = (await openGoPipeline({ provider: config.provider, model: config.model, maxCalls: String(maxCalls - used) })).go
    try {
      const { summary } = await evaluateVisionConfig(go, config, datasetDir, items, async (record) => {
        await fs.appendFile(resultsFile, JSON.stringify({ ...record, pipeline: 'go', settings: { ...config, price: undefined } }) + '\n')
        process.stdout.write(`${config.label} ${record.item} ${record.outcome.kind}\n`)
      }, undefined, (calls) => (used += calls))
      summaries.push(summary)
    } finally {
      await go.close()
    }
    if (used >= maxCalls) break
  }
  await fs.writeFile(path.join(outDir, 'summary.json'), JSON.stringify(summaries, null, 2) + '\n')
  const versions = new GoPipeline({ args: ['--provider=mock'] })
  const analysis = (await versions.versions().finally(() => versions.close())).visionAnalysis
  await fs.writeFile(path.join(outDir, 'summary.md'), markdown(summaries, analysis))
  console.log(`done: ${path.join(outDir, 'summary.md')}`)
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
