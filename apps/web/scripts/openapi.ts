/**
 * OpenAPI document (docs/api/openapi.json, generated from src/server/openapi).
 *
 *   bun scripts/openapi.ts --write      regenerate the committed copy
 *   bun scripts/openapi.ts --check      exit 1 when the committed copy is out of date (CI)
 *   bun scripts/openapi.ts --validate   validate the generated document (OpenAPI 3.1 schema + refs)
 */
import { promises as fs } from 'fs'
import path from 'path'
import { validate } from '@readme/openapi-parser'
import { buildOpenApiDocument, serializeOpenApiDocument } from '../src/server/openapi/document'

const OUT = path.resolve(__dirname, '../../../docs/api/openapi.json')

async function main(): Promise<number> {
  const mode = process.argv[2]
  const text = serializeOpenApiDocument()
  if (mode === '--write') {
    await fs.mkdir(path.dirname(OUT), { recursive: true })
    await fs.writeFile(OUT, text)
    console.log(`wrote ${path.relative(process.cwd(), OUT)}`)
    return 0
  }
  if (mode === '--check') {
    const committed = await fs.readFile(OUT, 'utf8').catch(() => '')
    if (committed === text) {
      console.log('docs/api/openapi.json is up to date')
      return 0
    }
    console.error('docs/api/openapi.json is out of date: run `bun run openapi:write` and commit the result')
    return 1
  }
  if (mode === '--validate') {
    const result = await validate(structuredClone(buildOpenApiDocument()) as never)
    if (result.valid) {
      console.log(`valid OpenAPI ${(buildOpenApiDocument() as { openapi: string }).openapi}${result.warnings.length ? ` (${result.warnings.length} warnings)` : ''}`)
      for (const w of result.warnings) console.log(`warning: ${JSON.stringify(w)}`)
      return 0
    }
    console.error(JSON.stringify(result.errors, null, 2))
    return 1
  }
  throw new Error('usage: openapi.ts --write | --check | --validate')
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  },
)
