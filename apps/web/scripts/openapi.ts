/**
 * The API contract (docs/api/openapi.json) is hand-owned since B7.5 (ADR
 * 0003): edit the document itself, then regenerate the Go server
 * (apps/api/scripts/generate.sh) and the Dart client
 * (apps/mobile/tool/openapi/generate_api.sh); CI fails on stale generated code.
 *
 *   bun scripts/openapi.ts --validate   the committed document is valid OpenAPI 3.1 (schema + $refs)
 */
import { promises as fs } from 'fs'
import path from 'path'
import { validate } from '@readme/openapi-parser'

export const CONTRACT = path.resolve(__dirname, '../../../docs/api/openapi.json')

async function main(): Promise<number> {
  if (process.argv[2] !== '--validate') throw new Error('usage: openapi.ts --validate (the document is hand-owned: edit docs/api/openapi.json)')
  const doc = JSON.parse(await fs.readFile(CONTRACT, 'utf8')) as { openapi: string }
  const result = await validate(structuredClone(doc) as never)
  if (result.valid) {
    console.log(`valid OpenAPI ${doc.openapi}${result.warnings.length ? ` (${result.warnings.length} warnings)` : ''}`)
    for (const w of result.warnings) console.log(`warning: ${JSON.stringify(w)}`)
    return 0
  }
  console.error(JSON.stringify(result.errors, null, 2))
  return 1
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  },
)
