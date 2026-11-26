/**
 * Golden vectors for the Go port of the idempotency request hash (stage
 * B4, parity strength "exact": a retry may reach the other server, and must
 * be recognised as the same request).
 *
 * Runs the real multipartRequestHash.
 *
 *   cd apps/web && bun scripts/golden-idempotency.ts ../api/testdata/golden/idempotency.json
 */
import { writeFileSync } from 'node:fs'
import { multipartRequestHash } from '@/server/idempotency'

const out = process.argv[2]
if (!out) throw new Error('usage: bun scripts/golden-idempotency.ts <output.json>')

const bytes = (...parts: Array<string | number[]>) => Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'utf8') : Buffer.from(p))))

const cases: Array<{ name: string; file: Buffer; filename: string; fields: Record<string, string> }> = [
  { name: 'plain', file: bytes('image bytes'), filename: 'shirt.jpg', fields: {} },
  { name: 'empty file and name', file: bytes(''), filename: '', fields: {} },
  { name: 'binary bytes', file: bytes([0, 255, 137, 80, 78, 71, 13, 10, 26, 10]), filename: 'a.png', fields: {} },
  { name: 'another byte', file: bytes([0, 255, 137, 80, 78, 71, 13, 10, 26, 11]), filename: 'a.png', fields: {} },
  { name: 'another name', file: bytes('image bytes'), filename: 'shirt.jpeg', fields: {} },
  { name: 'the filename field', file: bytes('image bytes'), filename: 'shirt.jpg', fields: { filename: 'jeans.jpg' } },
  { name: 'fields in another order are the same request', file: bytes('x'), filename: 'a.jpg', fields: { b: '2', a: '1', filename: 'f' } },
  { name: 'fields sorted', file: bytes('x'), filename: 'a.jpg', fields: { a: '1', b: '2', filename: 'f' } },
  { name: 'a field moved into the name is another request', file: bytes('x'), filename: 'a.jpg","b', fields: {} },
  { name: 'quotes, backslash and controls in the name', file: bytes('x'), filename: 'a"b\\c\n\r\t\b\f\u0001\u001f\u007f.jpg', fields: {} },
  { name: 'markup characters stay as they are', file: bytes('x'), filename: '<a&b>.jpg', fields: { note: "</script>&'" } },
  { name: 'non-ASCII names', file: bytes('x'), filename: 'ko‘ylak-қизил-👕.jpg', fields: { filename: 'сумка' } },
  { name: 'line and paragraph separators', file: bytes('x'), filename: 'a b c.jpg', fields: {} },
  // Field names sort by UTF-16 code units: a character outside the BMP (two
  // surrogates, D83D…) comes before U+FF21, although its code point is higher.
  { name: 'field names sorted by UTF-16 units', file: bytes('x'), filename: 'a.jpg', fields: { 'Ａ': 'fullwidth', '👕': 'astral', z: 'ascii', '': 'empty' } },
  { name: 'empty values', file: bytes('x'), filename: 'a.jpg', fields: { filename: '', note: '' } },
]

writeFileSync(
  out,
  JSON.stringify(
    {
      source: 'apps/web/src/server/idempotency.ts (multipartRequestHash)',
      cases: cases.map((c) => ({ name: c.name, fileBase64: c.file.toString('base64'), filename: c.filename, fields: c.fields, hash: multipartRequestHash({ fileBytes: c.file, filename: c.filename, fields: c.fields }) })),
    },
    null,
    2,
  ) + '\n',
)
console.log(`${cases.length} request hashes → ${out}`)
