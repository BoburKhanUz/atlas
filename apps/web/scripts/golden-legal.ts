/**
 * Golden vectors for the Go port of the legal-consent rules (stage B2, parity
 * strength "exact": .claude/skills/lookly-testing/references/parity.md).
 *
 * Runs the real compareLegalVersions and consentStillValid on every pair of a
 * list of versions (well-formed, malformed and edge cases) and records the
 * outputs. The Go tests must reproduce every one. The current version
 * constants are NOT taken from this file: the Go test reads them from
 * src/lib/legal/version.ts itself, so they cannot go stale.
 *
 *   cd apps/web && bun scripts/golden-legal.ts ../api/testdata/golden/legal.json
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { LEGAL_CONSENT_MIN_VERSION, LEGAL_VERSION, compareLegalVersions, consentStillValid } from '@/lib/legal/version'

const out = process.argv[2]
if (!out) throw new Error('usage: bun scripts/golden-legal.ts <output.json>')

const versions = [
  LEGAL_VERSION,
  LEGAL_CONSENT_MIN_VERSION,
  '2026-10-17.1-draft',
  '2026-10-17.2',
  '2026-10-17.3-draft',
  '2026-10-17.10-draft', // numbers compare as numbers, not as text
  '2026-10-17.010', // leading zeros
  '2026-10-17.0',
  '2026-10-16.99',
  '2026-11-24.1',
  '2027-01-01.1',
  '1999-12-31.1',
  '2026-10-17.18446744073709551616', // past 64 bits
  '2026-10-17.99999999999999999999999999',
  // JavaScript compares the numbers as doubles: these two are equal, and a
  // number of 400 digits is Infinity (equal to any other such number).
  '2026-10-17.9007199254740992',
  '2026-10-17.9007199254740993',
  `2026-10-17.${'9'.repeat(400)}`,
  `2026-10-17.${'8'.repeat(400)}-draft`,
  // malformed
  '',
  '2026-10-17',
  '2026-10-17.',
  '2026-10-17.2-Draft',
  '2026-10-17.2-draft ',
  ' 2026-10-17.2-draft',
  '2026-10-17.2-draft\n',
  '2026-1-17.2',
  '2026-10-17.-1',
  '2026-10-17.2.1',
  '٢٠٢٦-١٠-١٧.٢', // other digits
  'v2026-10-17.2',
  'latest',
]

const compare: unknown[] = []
for (const a of versions) {
  for (const b of versions) {
    const result = compareLegalVersions(a, b)
    compare.push({ a, b, result: Number.isNaN(result) ? null : result })
  }
}
const stillValid = versions.map((version) => ({ version, valid: consentStillValid(version) }))

const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
writeFileSync(
  out,
  JSON.stringify(
    {
      generatedBy: 'apps/web/scripts/golden-legal.ts',
      sourceCommit,
      note: 'result is -1, 0 or 1; null where the TypeScript function returns NaN (a malformed version). stillValid was computed with minVersion.',
      minVersion: LEGAL_CONSENT_MIN_VERSION,
      compare,
      stillValid,
    },
    null,
    1,
  ) + '\n',
)
console.log(`wrote ${out}: ${compare.length} comparisons, ${stillValid.length} validity checks`)
