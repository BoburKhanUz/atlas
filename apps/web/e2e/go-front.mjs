#!/usr/bin/env node
// Test-only front proxy for the "Go mode" of the e2e suite (docs/plan/B2.md).
//
// Before the cutover (stage B7) the Go backend serves only some operations.
// This proxy stands in front of a Next.js server and a Go server that share
// one database and the same secrets, sends the operations Go already serves
// to Go and everything else to Next.js, so the browser specs exercise the Go
// handlers and sessions that one implementation created and the other
// rotates. It is never deployed: production switches in one step (ADR 0002).
//
//   FRONT_PORT=3100 NEXT_PORT=3110 GO_PORT=3120 node e2e/go-front.mjs
//
// Each answer carries x-e2e-backend (go | next), which e2e/go-mode.spec.ts
// checks, so a misrouted run cannot pass as "Go mode".
import http from 'node:http'

const port = (name) => {
  const value = Number(process.env[name])
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`${name} must be a port`)
  return value
}
const FRONT_PORT = port('FRONT_PORT')
const NEXT_PORT = port('NEXT_PORT')
const GO_PORT = port('GO_PORT')

/** The operations the Go server serves (apps/api/internal/httpapi/contract/oapi-codegen.yaml, and the media route). */
const GO_ROUTES = new Set([
  'POST /api/v1/auth/register',
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/logout',
  'POST /api/v1/auth/refresh',
  'GET /api/v1/auth/me',
  'POST /api/v1/auth/password/forgot',
  'POST /api/v1/auth/password/reset',
  'GET /api/v1/legal',
  'POST /api/v1/legal/consent',
  'GET /api/v1/profile',
  'PATCH /api/v1/profile',
  'DELETE /api/v1/account',
  'GET /api/v1/wardrobe/items',
  'POST /api/v1/wardrobe/items',
  'GET /api/v1/weather/current',
  'POST /api/v1/outfits/generate',
  'GET /api/v1/outfits',
  'POST /api/v1/outfits',
  'POST /api/v1/stylist/chat',
  'GET /api/v1/stylist/conversations',
  'POST /api/v1/color-profile/analyze',
  'GET /api/v1/color-profile',
  'DELETE /api/v1/color-profile',
  'POST /api/v1/client-errors',
  'GET /api/v1/openapi.json',
])

/** The operations with a parameter in the path: one item of the wardrobe, one outfit and its feedback, one conversation, and every image. */
const GO_PATTERNS = [
  { methods: ['GET', 'PATCH', 'DELETE'], path: /^\/api\/v1\/wardrobe\/items\/[^/]+$/ },
  { methods: ['GET', 'PATCH', 'DELETE'], path: /^\/api\/v1\/outfits\/[^/]+$/ },
  { methods: ['POST'], path: /^\/api\/v1\/outfits\/[^/]+\/feedback$/ },
  { methods: ['GET'], path: /^\/api\/v1\/stylist\/conversations\/[^/]+$/ },
  { methods: ['GET', 'HEAD'], path: /^\/api\/v1\/media\/.+/ },
]

const servedByGo = (method, path) => GO_ROUTES.has(`${method} ${path}`) || GO_PATTERNS.some((p) => p.methods.includes(method) && p.path.test(path))

const server = http.createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0]
  const backend = servedByGo(req.method, path) ? 'go' : 'next'
  // The request is passed on as it came, Host included: both servers compare
  // it with the Origin header (the cross-site request guard).
  const upstream = http.request(
    { host: '127.0.0.1', port: backend === 'go' ? GO_PORT : NEXT_PORT, method: req.method, path: req.url, headers: req.headers },
    (answer) => {
      res.writeHead(answer.statusCode ?? 502, { ...answer.headers, 'x-e2e-backend': backend })
      answer.pipe(res)
    },
  )
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'x-e2e-backend': backend })
    res.end()
  })
  req.pipe(upstream)
})

server.listen(FRONT_PORT, '127.0.0.1')
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)))
