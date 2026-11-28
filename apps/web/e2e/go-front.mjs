#!/usr/bin/env node
// Test-only front proxy of the browser suite: what Caddy does in production
// (deploy/Caddyfile): everything under /api/ to the Go server, the pages to
// the web app. Never deployed.
//
//   FRONT_PORT=3100 NEXT_PORT=3110 GO_PORT=3120 node e2e/go-front.mjs
import http from 'node:http'

const port = (name) => {
  const value = Number(process.env[name])
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`${name} must be a port`)
  return value
}
const FRONT_PORT = port('FRONT_PORT')
const NEXT_PORT = port('NEXT_PORT')
const GO_PORT = port('GO_PORT')

const servedByGo = (path) => path === '/api' || path.startsWith('/api/')

const server = http.createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0]
  // Passed on as it came, Host included: the Go server compares it with the Origin header.
  const upstream = http.request(
    { host: '127.0.0.1', port: servedByGo(path) ? GO_PORT : NEXT_PORT, method: req.method, path: req.url, headers: req.headers },
    (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.headers)
      answer.pipe(res)
    },
  )
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502)
    res.end()
  })
  req.pipe(upstream)
})

server.listen(FRONT_PORT, '127.0.0.1')
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)))
