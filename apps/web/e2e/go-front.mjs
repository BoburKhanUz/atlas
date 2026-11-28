#!/usr/bin/env node
// Test-only front proxy for the "Go mode" of the e2e suite (docs/plan/B2.md).
//
// This proxy stands in front of a Next.js server and a Go server that share
// one database and the same secrets. It sends the API to Go and the pages to
// Next.js, so the browser specs exercise the Go handlers under the web app,
// and sessions that one implementation created and the other rotates. It is
// never deployed: production switches in one step (ADR 0002).
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

/**
 * Every operation of the contract is on Go (stage B6.10): the whole API, its
 * health route and its images, everything under /api/, goes to Go. The pages
 * stay Next.js's (they read the database themselves until stage W1, within B7).
 */
const servedByGo = (path) => path === '/api' || path.startsWith('/api/')

const server = http.createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0]
  const backend = servedByGo(path) ? 'go' : 'next'
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
