/**
 * Every answer of the API journey suite is checked against the contract
 * (docs/api/openapi.json): the status must be one the operation documents; a
 * JSON body must match that status's schema; an error must carry a code the
 * operation lists for that status (x-error-codes).
 */
import Ajv2020 from 'ajv/dist/2020'
import { readFileSync } from 'node:fs'
import path from 'node:path'

type Schema = Record<string, unknown>
interface Response {
  description?: string
  content?: Record<string, { schema?: Schema }>
  'x-error-codes'?: string[]
}
interface Document {
  paths: Record<string, Record<string, { responses: Record<string, Response> }>>
  components: { schemas: Record<string, Schema> }
}

const DOC_ID = 'https://lookly.uz/openapi.json'
const doc = JSON.parse(readFileSync(path.resolve(__dirname, '../../../docs/api/openapi.json'), 'utf8')) as Document
const ajv = new Ajv2020({ strict: false, allErrors: false })
// The two formats the document uses: an RFC 3339 time with a zone, and an address.
ajv.addFormat('date-time', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/)
ajv.addFormat('email', /^[^\s@]+@[^\s@]+\.[^\s@]+$/)
ajv.addSchema({ $id: DOC_ID, components: doc.components })

const operations = Object.entries(doc.paths).flatMap(([template, item]) =>
  Object.entries(item).map(([method, op]) => ({
    method: method.toUpperCase(),
    template,
    re: new RegExp('^' + template.replace(/\{key\}/g, '.+').replace(/\{\w+\}/g, '[^/]+') + '$'),
    responses: op.responses,
  })),
)

const validators = new Map<string, ReturnType<typeof ajv.compile>>()
function validatorFor(schema: Schema) {
  const key = JSON.stringify(schema)
  let v = validators.get(key)
  if (!v) {
    // Local references point into the document's components.
    const rebased = JSON.parse(key.replace(/"#\/components\//g, `"${DOC_ID}#/components/`)) as Schema
    v = ajv.compile(rebased)
    validators.set(key, v)
  }
  return v
}

/** What is wrong with an answer, or null when it matches the contract. */
export function contractViolation(method: string, pathname: string, status: number, contentType: string, body: unknown): string | null {
  const op = operations.find((o) => o.method === method && o.re.test(pathname))
  if (!op) return `${method} ${pathname}: not an operation of the contract`
  const response = op.responses[String(status)]
  if (!response) return `${method} ${op.template}: ${status} is not a documented answer`
  const json = response.content?.['application/json']?.schema
  if (!json) return null // a binary answer or no body
  if (!contentType.includes('application/json')) return `${method} ${op.template} ${status}: not JSON (${contentType})`
  const validate = validatorFor(json)
  if (!validate(body)) return `${method} ${op.template} ${status}: ${ajv.errorsText(validate.errors)}`
  const codes = response['x-error-codes']
  if (codes) {
    const code = (body as { code?: string }).code
    if (!code || !codes.includes(code)) return `${method} ${op.template} ${status}: error code ${code} is not listed (${codes.join(', ')})`
  }
  return null
}
