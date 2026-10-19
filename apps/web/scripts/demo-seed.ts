/**
 * Create (or refresh) the demo account from a folder of clothing photos and a
 * manifest with their attributes. No AI call is made: the attributes come
 * from the manifest, so the demo wardrobe is exactly what was prepared.
 *
 *   DEMO_EMAIL=… DEMO_PASSWORD=… bun scripts/demo-seed.ts --manifest demo/manifest.json [--apply] [--reset]
 *
 * - Without --apply: a dry run that validates the manifest and the photos.
 * - With --apply: creates the user (accepted legal version, 18+ confirmed),
 *   preferences and items. An existing demo user keeps its id; its name,
 *   password and preferences are updated.
 * - With --reset (and --apply): the existing demo user's wardrobe items and
 *   their images are deleted first. Without it, an existing wardrobe is left
 *   alone and the run stops.
 *
 * Needs the same DATABASE_URL and storage settings as the server. The
 * password is read from the environment and never printed.
 * Exit 0 ok, 1 error.
 */
import { readFile, stat } from 'fs/promises'
import path from 'path'
import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/lib/auth'
import { LEGAL_VERSION } from '../src/lib/legal/version'
import { checkImageEnvelope, getStorageProvider, type StoredImage } from '../src/lib/storage/provider'
import { DemoManifest, demoCredentials, manifestErrors, photoMimeType } from '../src/server/demo/manifest'

const ANALYSIS = { provider: 'demo-seed', model: 'manual', version: 'demo-seed-1' }

function options(argv: string[]) {
  let manifest: string | undefined
  const flags = new Set<string>()
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--manifest') manifest = argv[++i]
    else if (a === '--apply' || a === '--reset') flags.add(a)
    else throw new Error(`unknown option ${a}`)
  }
  if (!manifest) throw new Error('--manifest <file> is required')
  if (flags.has('--reset') && !flags.has('--apply')) throw new Error('--reset needs --apply')
  return { manifest: path.resolve(manifest), apply: flags.has('--apply'), reset: flags.has('--reset') }
}

async function main(): Promise<number> {
  const opts = options(process.argv.slice(2))
  const { email, password } = demoCredentials(process.env)

  const parsed = DemoManifest.safeParse(JSON.parse(await readFile(opts.manifest, 'utf8')))
  if (!parsed.success) {
    for (const line of manifestErrors(parsed.error)) console.error(line)
    return 1
  }
  const manifest = parsed.data
  const dir = path.dirname(opts.manifest)

  // Every photo exists and passes the upload envelope before anything is written.
  const photos: Buffer[] = []
  for (const item of manifest.items) {
    const file = path.join(dir, item.file)
    const { size } = await stat(file).catch(() => {
      throw new Error(`photo not found: ${item.file}`)
    })
    const envelope = checkImageEnvelope({ type: photoMimeType(item.file), size })
    if (envelope) throw new Error(`photo ${item.file}: ${envelope}`)
    photos.push(await readFile(file))
  }
  const byCategory = manifest.items.reduce<Record<string, number>>((acc, i) => ({ ...acc, [i.category]: (acc[i.category] ?? 0) + 1 }), {})
  console.log(`demo account ${email}: ${manifest.items.length} items (${Object.entries(byCategory).map(([c, n]) => `${c} ${n}`).join(', ')})`)
  if (!opts.apply) {
    console.log('DRY RUN: manifest and photos are valid (use --apply to write)')
    return 0
  }

  const db = new PrismaClient()
  const storage = getStorageProvider()
  try {
    const passwordHash = await hashPassword(password)
    const preferences = {
      preferredStyles: JSON.stringify(manifest.preferences.preferredStyles),
      favoriteColors: JSON.stringify(manifest.preferences.favoriteColors),
    }
    let user = await db.user.findUnique({ where: { email }, include: { wardrobeItems: { include: { images: true } } } })
    if (user && user.wardrobeItems.length > 0 && !opts.reset) {
      console.error(`${email} already has ${user.wardrobeItems.length} items; use --reset to replace them`)
      return 1
    }
    if (!user) {
      const created = await db.$transaction(async (tx) => {
        const u = await tx.user.create({ data: { email, name: manifest.name, passwordHash } })
        await tx.userProfile.create({ data: { userId: u.id } })
        await tx.userPreferences.create({ data: { userId: u.id, dislikedStyles: '[]', dislikedColors: '[]', language: 'uz', ...preferences } })
        await tx.legalConsent.create({ data: { userId: u.id, version: LEGAL_VERSION, ageConfirmed: true } })
        return u
      })
      console.log('created the demo user')
      user = { ...created, wardrobeItems: [] }
    } else {
      await db.user.update({ where: { id: user.id }, data: { name: manifest.name, passwordHash } })
      await db.userPreferences.upsert({
        where: { userId: user.id },
        create: { userId: user.id, dislikedStyles: '[]', dislikedColors: '[]', language: 'uz', ...preferences },
        update: preferences,
      })
      const consented = await db.legalConsent.findFirst({ where: { userId: user.id, version: LEGAL_VERSION } })
      if (!consented) await db.legalConsent.create({ data: { userId: user.id, version: LEGAL_VERSION, ageConfirmed: true } })
      if (user.wardrobeItems.length) {
        await db.wardrobeItem.deleteMany({ where: { userId: user.id } })
        await storage.deleteObjects(user.wardrobeItems.flatMap((i) => i.images.flatMap((img) => [img.storageKey, img.displayKey, img.thumbnailKey])))
        console.log(`removed ${user.wardrobeItems.length} earlier items`)
      }
      console.log('updated the demo user')
    }

    for (const [i, item] of manifest.items.entries()) {
      let stored: StoredImage | null = null
      try {
        stored = await storage.saveImage(photos[i], user.id)
        const image = stored
        await db.wardrobeItem.create({
          data: {
            userId: user.id,
            category: item.category,
            subcategory: item.subcategory,
            colors: JSON.stringify(item.colors),
            pattern: item.pattern,
            material: item.material,
            sleeveLength: item.sleeveLength,
            fit: item.fit,
            style: item.style,
            season: JSON.stringify(item.season),
            gender: item.gender,
            formality: item.formality,
            // Given by hand: nothing to review.
            confidences: '{}',
            wasCorrected: false,
            correctionLog: '[]',
            analysisProvider: ANALYSIS.provider,
            analysisModel: ANALYSIS.model,
            analysisVersion: ANALYSIS.version,
            analyzedAt: new Date(),
            images: {
              create: [
                {
                  storageKey: image.key,
                  displayKey: image.displayKey,
                  thumbnailKey: image.thumbnailKey,
                  isPrimary: true,
                  width: image.width,
                  height: image.height,
                  mimeType: image.mimeType,
                  bytes: image.bytes,
                  sha256: image.sha256,
                },
              ],
            },
          },
        })
      } catch (err) {
        if (stored) await storage.deleteObjects([stored.key, stored.displayKey, stored.thumbnailKey]).catch(() => {})
        throw new Error(`item ${i + 1} (${item.file}): ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    console.log(`APPLIED: ${manifest.items.length} items`)
    return 0
  } finally {
    await db.$disconnect()
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  },
)
