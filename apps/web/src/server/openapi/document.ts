/**
 * Builds the OpenAPI 3.1 document from the operation registry and the Zod
 * schemas (JSON Schema draft 2020-12). Deterministic: no timestamps, object
 * keys sorted, so `scripts/openapi.ts --check` can compare byte for byte with
 * the committed docs/api/openapi.json.
 */
import { z, type ZodType } from 'zod'
import pkg from '../../../package.json'
import { errorStatus, type ErrorCode } from '@/server/http'
import { OPERATIONS, REQUEST_COMPONENTS, RESPONSE_COMPONENTS, type Operation } from '@/server/openapi/registry'

// Plain JSON values (kept loose: the document is assembled from many shapes).
type Json = unknown

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` })

/**
 * Drop noise Zod adds to every schema: the long regex next to
 * `format: date-time` (the format says it), ±2^53 bounds on integers and
 * empty `additionalProperties` objects (no constraint).
 */
function simplify(value: Json): Json {
  if (Array.isArray(value)) return value.map(simplify)
  if (value && typeof value === 'object') {
    const obj = { ...(value as Record<string, Json>) }
    if (obj.format === 'date-time') delete obj.pattern
    if (obj.minimum === Number.MIN_SAFE_INTEGER) delete obj.minimum
    if (obj.maximum === Number.MAX_SAFE_INTEGER) delete obj.maximum
    // `additionalProperties: {}` (z.looseObject) means "anything", exactly like
    // omitting it — and omitting it keeps client generators on the plain path
    const ap = obj.additionalProperties
    if (ap && typeof ap === 'object' && !Array.isArray(ap) && Object.keys(ap).length === 0) delete obj.additionalProperties
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, simplify(v)]))
  }
  return value
}

function sortKeys(value: Json): Json {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    const obj = value as Record<string, Json>
    return Object.fromEntries(
      Object.keys(obj)
        .sort()
        .map((k) => [k, sortKeys(obj[k])]),
    )
  }
  return value
}

/** Component schemas for one registry; `$schema`/`$id` dropped (the document sets the dialect). */
function components(named: Record<string, ZodType>, io: 'input' | 'output'): Record<string, Json> {
  const registry = z.registry<{ id: string }>()
  for (const [id, schema] of Object.entries(named)) registry.add(schema, { id })
  const { schemas } = z.toJSONSchema(registry, { target: 'draft-2020-12', io, uri: (id) => `#/components/schemas/${id}`, unrepresentable: 'throw' })
  const out: Record<string, Json> = {}
  for (const [id, schema] of Object.entries(schemas)) {
    const { $schema: _s, $id: _i, ...rest } = schema as Record<string, Json>
    out[id] = rest
  }
  return out
}

/** Name under which a schema object is registered. */
function nameOf(schema: ZodType, named: Record<string, ZodType>): string {
  const found = Object.entries(named).find(([, s]) => s === schema)
  if (!found) throw new Error('schema used by an operation is not exported from src/server/schemas/{requests,responses}.ts')
  return found[0]
}

/** Errors every operation of a kind can return, on top of its specific ones. */
export function errorCodesFor(op: Operation): ErrorCode[] {
  const codes = new Set<ErrorCode>(op.errors)
  codes.add('INTERNAL')
  if (op.auth === 'required') codes.add('UNAUTHORIZED')
  if (op.jsonBody) {
    codes.add('BAD_REQUEST')
    codes.add('VALIDATION_ERROR')
    codes.add('PAYLOAD_TOO_LARGE')
  }
  if (op.query || op.pathParams) codes.add('VALIDATION_ERROR')
  if (op.multipart) {
    codes.add('PAYLOAD_TOO_LARGE')
    codes.add('UNSUPPORTED_MEDIA_TYPE')
  }
  if (op.idempotency) codes.add('VALIDATION_ERROR')
  // the CSRF guard (src/proxy.ts) rejects cross-origin cookie-authenticated writes
  if (op.method !== 'GET' && op.auth !== 'none') codes.add('FORBIDDEN')
  return [...codes].sort()
}

function parameters(op: Operation): Json[] {
  const params: Json[] = []
  for (const [name, description] of Object.entries(op.pathParams ?? {})) {
    params.push({ name, in: 'path', required: true, description, schema: { type: 'string' } })
  }
  if (op.query) {
    const schema = z.toJSONSchema(op.query, { target: 'draft-2020-12', io: 'input' }) as { properties?: Record<string, Json>; required?: string[] }
    for (const [name, s] of Object.entries(schema.properties ?? {})) {
      const { description, ...rest } = s as Record<string, Json>
      params.push({ name, in: 'query', required: (schema.required ?? []).includes(name), schema: rest, ...(description ? { description } : {}) })
    }
  }
  if (op.clientMode) {
    params.push({
      name: 'X-Atlas-Client',
      in: 'header',
      required: false,
      description: '`mobile` selects mobile mode: tokens in JSON bodies, no cookies. Any other value or none: web mode. Not a security boundary — each login is bound to its mode (401 CLIENT_MISMATCH otherwise).',
      schema: { type: 'string', enum: ['mobile'] },
    })
  }
  if (op.idempotency) {
    params.push({
      name: 'Idempotency-Key',
      in: 'header',
      required: false,
      description: 'Makes retries safe for 24 h: the same key and payload returns the original result (Idempotent-Replayed: true); a different payload → 409 IDEMPOTENCY_KEY_MISMATCH; still processing → 409 IDEMPOTENCY_IN_PROGRESS with Retry-After.',
      schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{8,128}$' },
    })
  }
  return params
}

function requestBody(op: Operation): Json | undefined {
  if (op.jsonBody) {
    return {
      required: !op.jsonBodyMobileOnly,
      ...(op.jsonBodyMobileOnly ? { description: 'Mobile mode only (web mode uses the cookies)' } : {}),
      content: { 'application/json': { schema: ref(nameOf(op.jsonBody, REQUEST_COMPONENTS)) } },
    }
  }
  if (op.multipart) {
    const properties: Record<string, Json> = {}
    const required: string[] = []
    for (const [name, f] of Object.entries(op.multipart.fields)) {
      properties[name] = f.binary ? { type: 'string', contentMediaType: 'application/octet-stream', description: f.description } : { type: 'string', description: f.description }
      if (f.required) required.push(name)
    }
    return {
      required: true,
      description: 'multipart/form-data; Content-Length required; at most 10 MB',
      content: { 'multipart/form-data': { schema: { type: 'object', properties, required } } },
    }
  }
  return undefined
}

function responses(op: Operation): Record<string, Json> {
  const out: Record<string, Json> = {}
  for (const s of op.success) {
    const headers = Object.fromEntries(Object.entries(s.headers ?? {}).map(([h, d]) => [h, { description: d, schema: { type: 'string' } }]))
    const content = s.binary
      ? Object.fromEntries(s.binary.map((t) => [t, t === 'application/json' ? { schema: { type: 'object' } } : { schema: { type: 'string', contentMediaType: t } }]))
      : { 'application/json': { schema: ref(nameOf(s.schema!, RESPONSE_COMPONENTS)) } }
    out[String(s.status)] = { description: s.description, content, ...(Object.keys(headers).length ? { headers } : {}) }
  }
  const byStatus = new Map<number, ErrorCode[]>()
  for (const code of errorCodesFor(op)) {
    const status = errorStatus(code)
    byStatus.set(status, [...(byStatus.get(status) ?? []), code])
  }
  for (const [status, codes] of [...byStatus.entries()].sort(([a], [b]) => a - b)) {
    const retry = codes.some((c) => c === 'SESSION_BUSY' || c === 'IDEMPOTENCY_IN_PROGRESS' || c === 'RATE_LIMITED' || c === 'AI_QUOTA_EXCEEDED' || c === 'AI_UNAVAILABLE')
    out[String(status)] = {
      description: `Error. code: ${codes.join(' | ')}`,
      'x-error-codes': codes,
      content: { 'application/json': { schema: ref('ErrorResponse') } },
      ...(retry ? { headers: { 'Retry-After': { description: 'Seconds to wait before retrying (retryable codes)', schema: { type: 'string' } } } } : {}),
    }
  }
  return out
}

function security(op: Operation): Json[] {
  const authed = [{ bearerAuth: [] }, { cookieAuth: [] }]
  if (op.auth === 'required') return authed
  if (op.auth === 'optional') return [{}, ...authed]
  return []
}

export function buildOpenApiDocument(): Json {
  const requestSchemas = components(REQUEST_COMPONENTS, 'input')
  const responseSchemas = components(RESPONSE_COMPONENTS, 'output')
  for (const id of Object.keys(requestSchemas)) {
    if (id in responseSchemas) throw new Error(`schema name used for both a request and a response: ${id}`)
  }

  const paths: Record<string, Record<string, Json>> = {}
  for (const op of OPERATIONS) {
    const body = requestBody(op)
    const params = parameters(op)
    paths[op.path] ??= {}
    paths[op.path][op.method.toLowerCase()] = {
      operationId: op.operationId,
      summary: op.summary,
      tags: op.tags,
      security: security(op),
      ...(params.length ? { parameters: params } : {}),
      ...(body ? { requestBody: body } : {}),
      responses: responses(op),
    }
  }

  return sortKeys(simplify({
    openapi: '3.1.0',
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    info: {
      title: 'ATLAS API',
      version: pkg.version,
      description:
        'ATLAS personal stylist API (web and mobile). Errors always use ErrorResponse; branch on `code`. ' +
        'Web clients authenticate with HttpOnly cookies, mobile clients send `X-Atlas-Client: mobile` to the auth ' +
        'routes and `Authorization: Bearer <accessToken>` everywhere else. See docs/architecture/sessions.md and media.md.',
    },
    tags: [...new Set(OPERATIONS.flatMap((o) => o.tags))].sort().map((name) => ({ name })),
    paths,
    components: {
      schemas: { ...requestSchemas, ...responseSchemas },
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Mobile: the accessToken from login/register/refresh (15 min)' },
        cookieAuth: { type: 'apiKey', in: 'cookie', name: 'atlas_at', description: 'Web: HttpOnly access cookie set by login/register/refresh' },
      },
    },
  }))
}

/** The committed / served form: 2-space JSON with a trailing newline. */
export function serializeOpenApiDocument(): string {
  return JSON.stringify(buildOpenApiDocument(), null, 2) + '\n'
}
