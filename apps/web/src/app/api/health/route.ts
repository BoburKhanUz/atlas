import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import pkg from '../../../../package.json'
import { withApi } from '@/server/http'
import { log } from '@/server/log'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VERSION = process.env.APP_VERSION || pkg.version

// GET /api/health — liveness + database reachability (used by Docker healthcheck).
// Public: exposes no secrets, only status, database state and app version.
export const GET = withApi(async () => {
  try {
    await db.$queryRaw`SELECT 1`
  } catch (err) {
    log.warn('health check: database unreachable', { err })
    return NextResponse.json(
      { status: 'degraded', database: 'unreachable', version: VERSION },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }
  return NextResponse.json(
    { status: 'ok', database: 'ok', version: VERSION },
    { headers: { 'Cache-Control': 'no-store' } },
  )
})
