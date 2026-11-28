/**
 * The evaluation harness's own catalog and types (scripts/ai-eval/catalog.ts,
 * protocol.ts; docs/plan/B7.md, B7.4c) are the server's: the error kinds are
 * Go's, and while the web app's AI code exists, the catalog and the types are
 * exactly its own (the type checks run in `bun run typecheck`).
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, expectTypeOf, it } from 'vitest'
import * as local from '../../scripts/ai-eval/catalog'
import { AI_ERROR_KINDS, errorKindOf, type AiErrorKind, type AiPrice, type ColorProfileInput, type ColorProfileRow, type ColorVerdict, type GarmentAttributes, type GenerateProblem, type LLMProvider, type LLMRequest, type Occasion, type StylePreferences, type UserProfileSummary, type VisionImageMimeType, type VisionProvider, type VisionRequest, type WardrobeItemSummary, type WardrobeRow, type WeatherSnapshot } from '../../scripts/ai-eval/protocol'
import * as app from '@/lib/ai/catalog'
import type { ColorVerdict as AppColorVerdict } from '@/lib/ai/color-check'
import type { Occasion as AppOccasion } from '@/lib/ai/color-theory'
import type { AiPrice as AppAiPrice } from '@/lib/ai/config'
import { CONFIDENCE_KEYS, SUBJECTS, type GarmentAttributes as AppGarmentAttributes } from '@/lib/ai/garment-analysis'
import type { ColorProfileInput as AppColorProfileInput, GenerateProblem as AppGenerateProblem, UserProfileSummary as AppUserProfileSummary, WardrobeItemSummary as AppWardrobeItemSummary, WeatherSnapshot as AppWeatherSnapshot } from '@/lib/ai/outfit-engine'
import { AiProviderError, type AiErrorKind as AppAiErrorKind } from '@/lib/ai/providers/errors'
import type { LLMProvider as AppLLMProvider, LLMRequest as AppLLMRequest, VisionImageMimeType as AppVisionImageMimeType, VisionProvider as AppVisionProvider, VisionRequest as AppVisionRequest } from '@/lib/ai/providers/types'
import type { ColorProfileRow as AppColorProfileRow, StylePreferences as AppStylePreferences, WardrobeRow as AppWardrobeRow } from '@/lib/ai/stylist-context'

describe("the harness's protocol", () => {
  it("names Go's error kinds", () => {
    const go = readFileSync(path.resolve(__dirname, '../../../api/internal/ai/errors.go'), 'utf8')
    const kinds = [...go.matchAll(/^\t\w+\s+Kind = "([a-z_]+)"/gm)].map((m) => m[1])
    expect(kinds.length).toBeGreaterThan(5)
    expect([...AI_ERROR_KINDS].sort()).toEqual(kinds.sort())
  })

  it("has the catalog the server embeds, which is the app's", () => {
    const names = ['CATEGORIES', 'SUBCATEGORIES', 'COLORS', 'PATTERNS', 'MATERIALS', 'STYLES', 'SLEEVE_LENGTHS', 'FITS', 'SEASONS', 'FORMALITIES', 'GENDERS', 'OCCASIONS'] as const
    for (const n of names) expect(local[n], n).toEqual(app[n])
    expect(local.SUBJECTS).toEqual(SUBJECTS)
    expect(local.CONFIDENCE_KEYS).toEqual(CONFIDENCE_KEYS)
  })

  it("has the app's types (while they exist)", () => {
    expectTypeOf<AiErrorKind>().toEqualTypeOf<AppAiErrorKind>()
    expectTypeOf<LLMRequest>().toEqualTypeOf<AppLLMRequest>()
    expectTypeOf<LLMProvider>().toEqualTypeOf<AppLLMProvider>()
    expectTypeOf<VisionRequest>().toEqualTypeOf<AppVisionRequest>()
    expectTypeOf<VisionProvider>().toEqualTypeOf<AppVisionProvider>()
    expectTypeOf<VisionImageMimeType>().toEqualTypeOf<AppVisionImageMimeType>()
    expectTypeOf<AiPrice>().toEqualTypeOf<AppAiPrice>()
    expectTypeOf<Occasion>().toEqualTypeOf<AppOccasion>()
    expectTypeOf<WardrobeItemSummary>().toEqualTypeOf<AppWardrobeItemSummary>()
    expectTypeOf<WardrobeRow>().toEqualTypeOf<AppWardrobeRow>()
    expectTypeOf<WeatherSnapshot>().toEqualTypeOf<AppWeatherSnapshot>()
    expectTypeOf<StylePreferences>().toEqualTypeOf<AppStylePreferences>()
    expectTypeOf<ColorProfileInput>().toEqualTypeOf<AppColorProfileInput>()
    expectTypeOf<ColorProfileRow>().toEqualTypeOf<AppColorProfileRow>()
    expectTypeOf<GenerateProblem>().toEqualTypeOf<AppGenerateProblem>()
    expectTypeOf<UserProfileSummary>().toEqualTypeOf<AppUserProfileSummary>()
    expectTypeOf<GarmentAttributes>().toEqualTypeOf<AppGarmentAttributes>()
    expectTypeOf<ColorVerdict>().toEqualTypeOf<AppColorVerdict>()
  })
})

describe('a scripted failure', () => {
  it('is read by its kind, whoever made it', () => {
    expect(errorKindOf(new AiProviderError('rate_limited', 'x'))).toBe('rate_limited')
    expect(errorKindOf({ kind: 'timeout' })).toBe('timeout')
    expect(errorKindOf({ kind: 'bogus' })).toBeNull()
    expect(errorKindOf(new Error('plain'))).toBeNull()
    expect(errorKindOf(null)).toBeNull()
    expect(errorKindOf('timeout')).toBeNull()
  })
})

describe("the harness stands without the web app's AI code", () => {
  it('no script of scripts/ai-eval imports src/ (it goes in B7.6)', () => {
    const root = path.resolve(__dirname, '../../scripts/ai-eval')
    const files = (readdirSync(root, { recursive: true }) as string[]).filter((f) => f.endsWith('.ts'))
    expect(files.length).toBeGreaterThan(30)
    const offenders = files.filter((f) => /from\s+['"](?:@\/|(?:\.\.\/)+src\/)|import\(\s*['"](?:@\/|(?:\.\.\/)+src\/)/.test(readFileSync(path.join(root, f), 'utf8')))
    expect(offenders).toEqual([])
  })
})
