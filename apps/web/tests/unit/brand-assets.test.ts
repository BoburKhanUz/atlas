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
    expect(parseTokens(dart)).toMatchObject({ accent: '#0F766E', ink: '#0B3B37', background: '#F8F8F6', textPrimary: '#111111' })
    expect(() => parseTokens(dart.replace('static const ink =', 'static const inkOld ='))).toThrow(/ink/)
  })

  it('one changed token reaches every output; nothing else changes', () => {
    const changed = dart.replace('static const accent = Color(0xFF0F766E);', 'static const accent = Color(0xFF7C3AED);')
    expect(changed).not.toBe(dart)
    const before = textOutputs(dart, css)
    const after = textOutputs(changed, css)
    for (const [file, content] of Object.entries(after)) {
      expect(content, file).toContain('#7C3AED')
      expect(content, file).not.toContain('#0F766E')
      expect(content.replaceAll('#7C3AED', '#0F766E'), file).toBe(before[file])
    }
  })

  it('the web palette keeps brand hex values only in its base variables', () => {
    const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')))
    const accent = parseTokens(dart).accent
    expect(root.split(accent).length - 1, 'other variables use var(--primary)').toBe(1)
    expect(() => withBrandVariables(css.replace('--primary: #', '--primary-x: #'), parseTokens(dart))).toThrow(/--primary/)
  })
})
