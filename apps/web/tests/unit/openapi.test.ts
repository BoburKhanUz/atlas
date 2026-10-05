/** OAS-01..03: the OpenAPI document covers exactly the route files, is deterministic, committed and valid. */
import { promises as fs } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { validate } from '@readme/openapi-parser'
import { buildOpenApiDocument, serializeOpenApiDocument } from '@/server/openapi/document'
import { OPERATIONS } from '@/server/openapi/registry'
import { ERROR_CODES } from '@/server/schemas/responses'
import { errorStatus } from '@/server/http'

const APP_DIR = path.resolve(__dirname, '../../src/app')
const COMMITTED = path.resolve(__dirname, '../../../../docs/api/openapi.json')

async function routeFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await routeFiles(full)))
    else if (entry.name === 'route.ts') out.push(full)
  }
  return out
}

describe('OpenAPI document', () => {
  it('OAS-01: every exported route method has exactly one registry entry, and every entry has a route', async () => {
    const fromFiles = new Set<string>()
    for (const file of await routeFiles(path.join(APP_DIR, 'api'))) {
      const src = await fs.readFile(file, 'utf8')
      const route = path.relative(APP_DIR, path.dirname(file)).split(path.sep).join('/')
      for (const m of src.matchAll(/^export (?:const|async function) (GET|POST|PUT|PATCH|DELETE)\b/gm)) fromFiles.add(`${m[1]} ${route}`)
    }
    const fromRegistry = OPERATIONS.map((o) => `${o.method} ${o.route}`)
    expect(new Set(fromRegistry).size).toBe(fromRegistry.length)
    expect([...fromFiles].sort()).toEqual([...fromRegistry].sort())
    // OpenAPI paths agree with the route directories
    for (const o of OPERATIONS) {
      expect(o.path, o.operationId).toBe('/' + o.route.replace(/\[\.\.\.(\w+)\]/g, '{$1}').replace(/\[(\w+)\]/g, '{$1}'))
    }
    expect(new Set(OPERATIONS.map((o) => o.operationId)).size).toBe(OPERATIONS.length)
  })

  it('OAS-02: generation is deterministic and the committed docs/api/openapi.json is up to date', async () => {
    const a = serializeOpenApiDocument()
    const b = serializeOpenApiDocument()
    expect(a).toBe(b)
    expect(a).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/) // no timestamps
    expect(await fs.readFile(COMMITTED, 'utf8'), 'run `bun run openapi:write`').toBe(a)
  })

  it('OAS-03: the document is a valid OpenAPI 3.1 description (schema + $refs)', async () => {
    const doc = buildOpenApiDocument() as { openapi: string; paths: Record<string, Record<string, { responses: Record<string, { 'x-error-codes'?: string[] }> }>> }
    expect(doc.openapi).toBe('3.1.0')
    const result = await validate(structuredClone(doc) as never)
    if (!result.valid) expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)
    // every documented error code sits under its real HTTP status
    for (const ops of Object.values(doc.paths)) {
      for (const op of Object.values(ops)) {
        for (const [status, r] of Object.entries(op.responses)) {
          for (const code of r['x-error-codes'] ?? []) expect(errorStatus(code as (typeof ERROR_CODES)[number])).toBe(Number(status))
        }
      }
    }
  })

  it('the document carries no secrets or environment values', () => {
    const text = serializeOpenApiDocument()
    for (const name of ['JWT_SECRET', 'MEDIA_SIGNING_SECRET', 'SESSION_ENC_KEY']) {
      const value = process.env[name]
      if (value) expect(text).not.toContain(value)
    }
    expect(text).not.toMatch(/postgres(ql)?:\/\//)
  })
})
