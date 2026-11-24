import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { parseTokens, staleFiles, textOutputs, withBrandVariables } from '../../scripts/brand'

const dart = readFileSync(path.resolve(__dirname, '../../../mobile/lib/core/design/tokens.dart'), 'utf8')
const css = readFileSync(path.resolve(__dirname, '../../src/app/globals.css'), 'utf8')

describe('brand colours come from the mobile design tokens', () => {
  it('the committed web palette, logo and Android colours match the tokens', () => {
    expect(staleFiles(), 'run `bun run brand:write` and commit the result').toEqual([])
  })

  it('reads the opaque brand colours and refuses a tokens file without one', () => {
    expect(parseTokens(dart)).toMatchObject({ accent: '#5B21B6', accentStrong: '#4C1D95', ink: '#1F1147', background: '#FAF9FF' })
    expect(() => parseTokens(dart.replace('static const ink =', 'static const inkOld ='))).toThrow(/ink/)
  })

  it('one changed token reaches every output that uses it; nothing else changes', () => {
    const outputs = (source: string) =>
      Object.fromEntries(Object.entries(textOutputs(source, css)).map(([file, content]) => [path.basename(file), content]))
    const before = outputs(dart)
    for (const [token, hex, files] of [
      ['accent', '5B21B6', ['globals.css', 'brand-colors.ts']],
      ['accentStrong', '4C1D95', ['colors.xml', 'brand-colors.ts']],
      ['background', 'FAF9FF', ['globals.css', 'colors.xml', 'brand-colors.ts']],
    ] as const) {
      const changed = dart.replace(`static const ${token} = Color(0xFF${hex});`, `static const ${token} = Color(0xFF123456);`)
      expect(changed, token).not.toBe(dart)
      const after = outputs(changed)
      expect(Object.keys(after).filter((f) => after[f] !== before[f]).sort(), token).toEqual([...files].sort())
      for (const f of files) expect(after[f].replaceAll('#123456', `#${hex}`), `${token} in ${f}`).toBe(before[f])
    }
  })

  it('the web palette keeps brand hex values only in its base variables', () => {
    const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')))
    const accent = parseTokens(dart).accent
    expect(root.split(accent).length - 1, 'other variables use var(--primary)').toBe(1)
    expect(() => withBrandVariables(css.replace('--primary: #', '--primary-x: #'), parseTokens(dart))).toThrow(/--primary/)
  })
})
