import { NextResponse } from 'next/server'
import { serializeOpenApiDocument } from '@/server/openapi/document'
import { withApi } from '@/server/http'

export const runtime = 'nodejs'

let cached: string | null = null

// GET /api/v1/openapi.json — the OpenAPI 3.1 document (public, no secrets).
// Generated from the same registry and schemas as docs/api/openapi.json.
export const GET = withApi(async () => {
  cached ??= serializeOpenApiDocument()
  return new NextResponse(cached, {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
  })
})
