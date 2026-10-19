/**
 * The demo account manifest (scripts/demo-seed.ts): who the demo user is and
 * which clothes are in the wardrobe, with their attributes given by hand, so
 * seeding needs no AI call. Every value is a catalog id, checked with the same
 * schemas as the API.
 */
import path from 'path'
import { z } from 'zod'
import {
  categorySchema,
  colorSchema,
  colorsSchema,
  fitSchema,
  formalitySchema,
  genderSchema,
  materialSchema,
  patternSchema,
  seasonsSchema,
  sleeveLengthSchema,
  styleSchema,
  subcategoriesOf,
  subcategorySchema,
} from '@/server/schemas/catalog'

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'] as const

export const DemoItem = z
  .object({
    /** Photo path, relative to the manifest file. */
    file: z
      .string()
      .min(1)
      .refine((f) => IMAGE_EXTENSIONS.includes(path.extname(f).toLowerCase() as (typeof IMAGE_EXTENSIONS)[number]), {
        message: `photo must be ${IMAGE_EXTENSIONS.join(', ')}`,
      })
      .refine((f) => !path.isAbsolute(f) && !f.split(/[\\/]/).includes('..'), {
        message: 'photo path must stay inside the manifest folder',
      }),
    category: categorySchema,
    subcategory: subcategorySchema.nullable().default(null),
    colors: colorsSchema.min(1),
    pattern: patternSchema.nullable().default(null),
    material: materialSchema.nullable().default(null),
    sleeveLength: sleeveLengthSchema.nullable().default(null),
    fit: fitSchema.nullable().default(null),
    style: styleSchema.nullable().default(null),
    season: seasonsSchema.min(1),
    gender: genderSchema.nullable().default(null),
    formality: formalitySchema.nullable().default(null),
  })
  .strict()
  .superRefine((item, ctx) => {
    if (item.subcategory && !subcategoriesOf(item.category).includes(item.subcategory)) {
      ctx.addIssue({ code: 'custom', path: ['subcategory'], message: `${item.subcategory} is not a ${item.category} subcategory` })
    }
  })

export const DemoManifest = z
  .object({
    name: z.string().trim().min(1).max(60),
    preferences: z
      .object({
        preferredStyles: z.array(styleSchema).max(5).default([]),
        favoriteColors: z.array(colorSchema).max(8).default([]),
      })
      .strict()
      .default({ preferredStyles: [], favoriteColors: [] }),
    items: z.array(DemoItem).min(1).max(60),
  })
  .strict()
  .superRefine((m, ctx) => {
    const seen = new Set<string>()
    m.items.forEach((item, i) => {
      if (seen.has(item.file)) ctx.addIssue({ code: 'custom', path: ['items', i, 'file'], message: 'the same photo twice' })
      seen.add(item.file)
    })
  })

export type DemoManifest = z.infer<typeof DemoManifest>
export type DemoItem = z.infer<typeof DemoItem>

/** Content type of a photo by its extension (the storage layer decodes and checks the bytes). */
export function photoMimeType(file: string): string {
  const ext = path.extname(file).toLowerCase()
  return ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
}

/** Readable validation errors, one per line ("items.2.subcategory: …"). */
export function manifestErrors(error: z.ZodError): string[] {
  return error.issues.map((i) => `${i.path.join('.') || '(manifest)'}: ${i.message}`)
}

/** The demo password comes from the environment; it is never printed. */
export function demoCredentials(env: Record<string, string | undefined>): { email: string; password: string } {
  const email = env.DEMO_EMAIL?.trim().toLowerCase()
  const password = env.DEMO_PASSWORD
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('DEMO_EMAIL is missing or not an e-mail address')
  if (!password || password.length < 8) throw new Error('DEMO_PASSWORD is missing or shorter than 8 characters')
  return { email, password }
}
