#!/usr/bin/env node
// Test-only launcher of the Go worker for the browser and API suites
// (playwright.config.ts, playwright.api.config.ts). It creates the job queue's tables (`lookly migrate
// river`), runs `lookly worker` and answers on WORKER_PORT, so that
// Playwright (which waits for a URL) knows the worker was started. The
// worker does what the Go server queues: it makes password reset links and
// writes them to the mail outbox, and removes the images of deleted
// accounts. Never deployed.
//
//   GO_BINARY=<lookly> WORKER_PORT=3130 <the worker's environment> node e2e/go-worker.mjs
import { spawn, spawnSync } from 'node:child_process'
import http from 'node:http'

const binary = process.env.GO_BINARY
if (!binary) throw new Error('GO_BINARY is not set')
const port = Number(process.env.WORKER_PORT)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('WORKER_PORT must be a port')

const migrated = spawnSync(binary, ['migrate', 'river'], { stdio: ['ignore', 'ignore', 'inherit'] })
if (migrated.status !== 0) process.exit(migrated.status ?? 1)

const worker = spawn(binary, ['worker'], { stdio: ['ignore', 'ignore', 'inherit'] })
const server = http.createServer((_req, res) => res.end('ok'))
// The worker gone is a failed run, not a quiet one.
worker.on('exit', (code) => {
  server.close()
  process.exit(code ?? 1)
})
server.listen(port, '127.0.0.1')
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => worker.kill('SIGTERM'))
