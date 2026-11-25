/**
 * Golden vectors for the Go port of the HTTP side of auth (stage B2, parity
 * strength "exact": .claude/skills/lookly-testing/references/parity.md).
 *
 * Runs the real functions of src/lib/session.ts and src/lib/rate-limit.ts on
 * requests built from fixed inputs and records what they decide:
 *   - csrf:       isCrossOriginCookieRequest (the cross-site request guard)
 *   - clientType: clientTypeOf (web or mobile mode)
 *   - clientIp:   clientIp (the address used for rate limits)
 *   - auth:       authenticateRequest (which credential is used)
 *
 *   cd apps/web && bun scripts/golden-auth-http.ts ../api/testdata/golden/auth-http.json
 *
 * The secret below is a fixed test value, used nowhere else.
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { NextRequest } from 'next/server'

const JWT_SECRET = 'golden-vector-jwt-secret-not-used-anywhere-else'
process.env.JWT_SECRET = JWT_SECRET
process.env.SESSION_ENC_KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString('base64')
delete process.env.ACCESS_TOKEN_TTL_SECONDS

type Headers = Array<[string, string]>

function request(method: string, headers: Headers): NextRequest {
  const h = new globalThis.Headers()
  for (const [name, value] of headers) h.append(name, value)
  return new NextRequest('http://internal.invalid/api/v1/auth/logout', { method, headers: h })
}

async function main() {
  const out = process.argv[2]
  if (!out) throw new Error('usage: bun scripts/golden-auth-http.ts <output.json>')
  const session = await import('@/lib/session')
  const rateLimit = await import('@/lib/rate-limit')
  const auth = await import('@/lib/auth')

  const withProxy = <T>(trustProxy: boolean, fn: () => T): T => {
    if (trustProxy) process.env.TRUST_PROXY = '1'
    else delete process.env.TRUST_PROXY
    try {
      return fn()
    } finally {
      delete process.env.TRUST_PROXY
    }
  }

  // ── CSRF guard ─────────────────────────────────────────────────────────────
  const HOST = 'app.example.uz'
  const AT: [string, string] = ['cookie', 'atlas_at=a']
  const csrfCases: Array<{ name: string; method: string; headers: Headers; trustProxy?: boolean }> = []
  const csrf = (name: string, method: string, headers: Headers, trustProxy = false) => csrfCases.push({ name, method, headers, trustProxy })

  for (const method of ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE']) {
    csrf(`${method} from another site, with a cookie`, method, [['host', HOST], AT, ['origin', 'https://evil.example']])
  }
  csrf('same origin', 'POST', [['host', HOST], AT, ['origin', `https://${HOST}`]])
  csrf('same host over http (only the host is compared)', 'POST', [['host', HOST], AT, ['origin', `http://${HOST}`]])
  csrf('no Origin header', 'POST', [['host', HOST], AT])
  csrf('empty Origin header', 'POST', [['host', HOST], AT, ['origin', '']])
  csrf('Origin null', 'POST', [['host', HOST], AT, ['origin', 'null']])
  csrf('Origin is not a URL', 'POST', [['host', HOST], AT, ['origin', 'app.example.uz']])
  csrf('Origin with another port', 'POST', [['host', HOST], AT, ['origin', `https://${HOST}:8443`]])
  csrf('Origin with the default https port', 'POST', [['host', HOST], AT, ['origin', `https://${HOST}:443`]])
  csrf('Origin with the default http port', 'POST', [['host', HOST], AT, ['origin', `http://${HOST}:80`]])
  csrf('Origin in upper case', 'POST', [['host', HOST], AT, ['origin', `HTTPS://${HOST.toUpperCase()}`]])
  csrf('Host in upper case', 'POST', [['host', HOST.toUpperCase()], AT, ['origin', `https://${HOST}`]])
  csrf('Origin with a path', 'POST', [['host', HOST], AT, ['origin', `https://${HOST}/some/path?x=1`]])
  csrf('Origin with a trailing slash', 'POST', [['host', HOST], AT, ['origin', `https://${HOST}/`]])
  csrf('Origin is a subdomain', 'POST', [['host', HOST], AT, ['origin', `https://evil.${HOST}`]])
  csrf('Origin is a parent domain', 'POST', [['host', HOST], AT, ['origin', 'https://example.uz']])
  csrf('Origin has the host as a prefix', 'POST', [['host', HOST], AT, ['origin', `https://${HOST}.evil.example`]])
  csrf('Origin with user info', 'POST', [['host', HOST], AT, ['origin', `https://${HOST}@evil.example`]])
  csrf('Origin with a trailing dot', 'POST', [['host', HOST], AT, ['origin', `https://${HOST}.`]])
  csrf('Origin without a host', 'POST', [['host', HOST], AT, ['origin', 'file:///etc/passwd']])
  csrf('Host with a port, same origin', 'POST', [['host', 'localhost:3100'], AT, ['origin', 'http://localhost:3100']])
  csrf('Host with a port, Origin without it', 'POST', [['host', 'localhost:3100'], AT, ['origin', 'http://localhost']])
  csrf('Host with a port, Origin with another', 'POST', [['host', 'localhost:3100'], AT, ['origin', 'http://localhost:3101']])
  csrf('IPv6 host, same origin', 'POST', [['host', '[::1]:3100'], AT, ['origin', 'http://[::1]:3100']])
  csrf('two Origin headers', 'POST', [['host', HOST], AT, ['origin', `https://${HOST}`], ['origin', `https://${HOST}`]])
  // Which requests are guarded at all
  csrf('another site, no cookie', 'POST', [['host', HOST], ['origin', 'https://evil.example']])
  csrf('another site, an unrelated cookie', 'POST', [['host', HOST], ['cookie', 'theme=dark'], ['origin', 'https://evil.example']])
  csrf('another site, the refresh cookie only', 'POST', [['host', HOST], ['cookie', 'atlas_rt=r'], ['origin', 'https://evil.example']])
  csrf('another site, both cookies among others', 'POST', [['host', HOST], ['cookie', 'theme=dark; atlas_rt=r; atlas_at=a'], ['origin', 'https://evil.example']])
  csrf('another site, an empty access cookie', 'POST', [['host', HOST], ['cookie', 'atlas_at='], ['origin', 'https://evil.example']])
  csrf('another site, a cookie whose name only starts alike', 'POST', [['host', HOST], ['cookie', 'atlas_at2=a'], ['origin', 'https://evil.example']])
  csrf('another site, with an Authorization header', 'POST', [['host', HOST], AT, ['origin', 'https://evil.example'], ['authorization', 'Bearer x']])
  csrf('another site, with an empty Authorization header', 'POST', [['host', HOST], AT, ['origin', 'https://evil.example'], ['authorization', '']])
  csrf('another site, Authorization of another scheme', 'POST', [['host', HOST], AT, ['origin', 'https://evil.example'], ['authorization', 'Basic eDp5']])
  // Behind the reverse proxy
  const PROXIED: Headers = [['host', 'api:3000'], AT, ['x-forwarded-host', HOST]]
  csrf('proxied, trusted: the forwarded host is compared', 'POST', [...PROXIED, ['origin', `https://${HOST}`]], true)
  csrf('proxied, trusted: the internal host is not the origin', 'POST', [...PROXIED, ['origin', 'http://api:3000']], true)
  csrf('proxied, not trusted: the forwarded host is ignored', 'POST', [...PROXIED, ['origin', `https://${HOST}`]], false)
  csrf('proxied, not trusted: the Host header is compared', 'POST', [...PROXIED, ['origin', 'http://api:3000']], false)
  csrf('proxied, trusted: the first forwarded host counts', 'POST', [['host', 'api:3000'], AT, ['x-forwarded-host', `${HOST}, evil.example`], ['origin', `https://${HOST}`]], true)
  csrf('proxied, trusted: a later forwarded host does not count', 'POST', [['host', 'api:3000'], AT, ['x-forwarded-host', `${HOST}, evil.example`], ['origin', 'https://evil.example']], true)
  csrf('proxied, trusted: an empty forwarded host falls back to Host', 'POST', [['host', HOST], AT, ['x-forwarded-host', ''], ['origin', `https://${HOST}`]], true)
  csrf('proxied, trusted: no forwarded host falls back to Host', 'POST', [['host', HOST], AT, ['origin', `https://${HOST}`]], true)

  const csrfOut = csrfCases.map((c) => ({
    ...c,
    crossOrigin: withProxy(!!c.trustProxy, () => session.isCrossOriginCookieRequest(request(c.method, c.headers))),
  }))

  // ── Client mode ────────────────────────────────────────────────────────────
  const clientType = [
    null,
    'mobile',
    'Mobile',
    ' MOBILE ',
    'web',
    '',
    'mobile-app',
    'mobile, mobile',
    'ios',
  ].map((value) => ({ value, clientType: session.clientTypeOf(request('POST', value === null ? [] : [['x-atlas-client', value]])) }))
  // The header sent twice reads as "mobile, mobile".
  const clientTypeTwice = session.clientTypeOf(request('POST', [['x-atlas-client', 'mobile'], ['x-atlas-client', 'mobile']]))

  // ── Client address for rate limits ─────────────────────────────────────────
  const ipCases: Array<{ name: string; headers: Headers; trustProxy: boolean }> = [
    { name: 'not trusted: forwarded headers are ignored', headers: [['x-forwarded-for', '203.0.113.7'], ['x-real-ip', '203.0.113.7']], trustProxy: false },
    { name: 'trusted: one forwarded address', headers: [['x-forwarded-for', '203.0.113.7']], trustProxy: true },
    { name: 'trusted: the right-most address is the one the proxy vouches for', headers: [['x-forwarded-for', '10.9.9.9, 198.51.100.4,203.0.113.7']], trustProxy: true },
    { name: 'trusted: spaces and empty items', headers: [['x-forwarded-for', ' 198.51.100.4 , 203.0.113.7 , ,']], trustProxy: true },
    { name: 'trusted: the header sent twice', headers: [['x-forwarded-for', '198.51.100.4'], ['x-forwarded-for', '203.0.113.7']], trustProxy: true },
    { name: 'trusted: no forwarded-for, the real-ip header', headers: [['x-real-ip', '203.0.113.9']], trustProxy: true },
    { name: 'trusted: an empty forwarded-for falls back to real-ip', headers: [['x-forwarded-for', ' , '], ['x-real-ip', '203.0.113.9']], trustProxy: true },
    { name: 'trusted: forwarded-for wins over real-ip', headers: [['x-forwarded-for', '203.0.113.7'], ['x-real-ip', '203.0.113.9']], trustProxy: true },
    { name: 'trusted: neither header', headers: [], trustProxy: true },
    { name: 'trusted: an IPv6 address', headers: [['x-forwarded-for', '2001:db8::1']], trustProxy: true },
    { name: 'trusted: not an address at all', headers: [['x-forwarded-for', 'unknown']], trustProxy: true },
  ]
  const clientIp = ipCases.map((c) => ({ ...c, ip: withProxy(c.trustProxy, () => rateLimit.clientIp(request('POST', c.headers))) }))

  // ── Which credential authenticates a request ───────────────────────────────
  const FUTURE = new Date(4102444800 * 1000) // 2100-01-01
  const bearerToken = await auth.signAccessToken({ sub: 'user_bearer', email: 'bearer@test.local', sid: 'sess_bearer' }, { expiresAt: FUTURE })
  const cookieToken = await auth.signAccessToken({ sub: 'user_cookie', email: 'cookie@test.local', sid: 'sess_cookie' }, { expiresAt: FUTURE })
  const otherCookieToken = await auth.signAccessToken({ sub: 'user_other', email: 'other@test.local', sid: 'sess_other' }, { expiresAt: FUTURE })
  const authCases: Array<{ name: string; headers: Headers }> = [
    { name: 'no credentials', headers: [] },
    { name: 'a valid bearer token', headers: [['authorization', `Bearer ${bearerToken}`]] },
    { name: 'a valid access cookie', headers: [['cookie', `atlas_at=${cookieToken}`]] },
    { name: 'both: the header is the only credential considered', headers: [['authorization', `Bearer ${bearerToken}`], ['cookie', `atlas_at=${cookieToken}`]] },
    { name: 'an invalid bearer token never falls back to a valid cookie', headers: [['authorization', 'Bearer not-a-token'], ['cookie', `atlas_at=${cookieToken}`]] },
    { name: 'an empty Authorization header never falls back to a valid cookie', headers: [['authorization', ''], ['cookie', `atlas_at=${cookieToken}`]] },
    { name: 'another scheme never falls back to a valid cookie', headers: [['authorization', 'Basic eDp5'], ['cookie', `atlas_at=${cookieToken}`]] },
    { name: 'an invalid access cookie', headers: [['cookie', 'atlas_at=not-a-token']] },
    { name: 'an empty access cookie', headers: [['cookie', 'atlas_at=']] },
    { name: 'the access token in the refresh cookie only', headers: [['cookie', `atlas_rt=${cookieToken}`]] },
    { name: 'the access cookie among others', headers: [['cookie', `theme=dark; atlas_at=${cookieToken}; atlas_rt=r`]] },
    { name: 'the access cookie twice: the last one counts', headers: [['cookie', `atlas_at=${otherCookieToken}; atlas_at=${cookieToken}`]] },
    { name: 'a quoted access cookie', headers: [['cookie', `atlas_at="${cookieToken}"`]] },
    { name: 'the Authorization header twice', headers: [['authorization', `Bearer ${bearerToken}`], ['authorization', `Bearer ${bearerToken}`]] },
    { name: 'bearer in lower case', headers: [['authorization', `bearer ${bearerToken}`]] },
  ]
  const authOut: unknown[] = []
  for (const c of authCases) {
    const result = await session.authenticateRequest(request('GET', c.headers))
    authOut.push({ ...c, via: result.via, user: result.user })
  }

  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  writeFileSync(
    out,
    JSON.stringify(
      {
        generatedBy: 'apps/web/scripts/golden-auth-http.ts',
        sourceCommit,
        note: 'Headers are [name, value] pairs in the order sent. Generated once and committed; a Go mismatch is investigated, never regenerated away.',
        generatedAtSeconds: Math.floor(Date.now() / 1000),
        jwtSecret: JWT_SECRET,
        csrf: csrfOut,
        clientType,
        clientTypeTwice,
        clientIp,
        auth: authOut,
      },
      null,
      1,
    ) + '\n',
  )
  console.log(`wrote ${out}: ${csrfOut.length} CSRF cases, ${clientType.length} client modes, ${clientIp.length} addresses, ${authOut.length} credentials`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
