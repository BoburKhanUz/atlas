/**
 * Golden vectors for the Go port of the password reset e-mail (stage B3,
 * parity strength "exact": .claude/skills/lookly-testing/references/parity.md).
 *
 * Runs the real resetLink and resetEmail and records the link and the
 * message (subject, text, HTML) byte for byte, with the link lifetime the
 * text names. Go reproduces every one.
 *
 *   cd apps/web && bun scripts/golden-password-reset.ts ../api/testdata/golden/password-reset.json
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { RESET_TOKEN_TTL_MINUTES, resetEmail, resetLink } from '@/server/password-reset'

const out = process.argv[2]
if (!out) throw new Error('usage: bun scripts/golden-password-reset.ts <output.json>')

// Tokens as the servers make them: 32 random bytes in base64url (43
// characters of [A-Za-z0-9_-]), so nothing in a link needs escaping.
const TOKENS = ['q83vEjRWeJCrze8SNFZ4kKvN7xI0VniQq83vEjRWeJA', '-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-', 'A'.repeat(43)]
const ORIGINS: Array<string | undefined> = [undefined, 'https://lookly.example.uz', 'http://127.0.0.1:3100']

const links: unknown[] = []
const messages: unknown[] = []
for (const origin of ORIGINS) {
  if (origin === undefined) delete process.env.PUBLIC_BASE_URL
  else process.env.PUBLIC_BASE_URL = origin
  for (const token of TOKENS) {
    const link = resetLink(token)
    links.push({ publicBaseUrl: origin ?? null, token, link })
    messages.push({ to: 'aziza@example.uz', link, ...pick(resetEmail('aziza@example.uz', link)) })
  }
}
// The link is escaped where it enters the HTML: a link with every escaped
// character shows how (real links have none of them).
const odd = 'https://lookly.example.uz/reset-password?token=a&b=<c>"d\'e'
messages.push({ to: 'o\'neil+test@example.uz', link: odd, ...pick(resetEmail('o\'neil+test@example.uz', odd)) })

function pick(m: { to: string; subject: string; text: string; html: string }) {
  return { subject: m.subject, text: m.text, html: m.html }
}

const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
writeFileSync(
  out,
  JSON.stringify(
    {
      generatedBy: 'apps/web/scripts/golden-password-reset.ts',
      sourceCommit,
      note: 'links: resetLink(token) with PUBLIC_BASE_URL set to publicBaseUrl (null: unset). messages: resetEmail(to, link).',
      ttlMinutes: RESET_TOKEN_TTL_MINUTES,
      links,
      messages,
    },
    null,
    1,
  ) + '\n',
)
console.log(`wrote ${out}: ${links.length} links, ${messages.length} messages`)
