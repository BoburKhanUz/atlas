/**
 * Media maintenance used by scripts/storage-sweep.ts and
 * scripts/backfill-display-variants.ts (manual, dry run by default).
 * Reports contain storage keys and image ids only.
 */
import sharp from 'sharp'
import type { PrismaClient } from '@prisma/client'
import { DISPLAY_MAX_SIDE, displayKeyFor, isValidStorageKey, type StorageProvider } from '@/lib/storage/provider'

export interface SweepReport {
  applied: boolean
  files: number
  referenced: number
  /** Unreferenced files older than the minimum age (deleted with --apply). */
  orphans: string[]
  /** Unreferenced but too recent (an upload may still be committing). */
  recentUnreferenced: number
  /** Files whose names we never generate (never deleted; investigate). */
  unknown: string[]
}

/**
 * Files no WardrobeImage row references: display variants left behind by a
 * Phase 2 rollback, crashed uploads. Files younger than `minAgeMs` are kept,
 * because an upload writes its files before its database row commits.
 */
export async function sweepStorage(
  db: PrismaClient,
  storage: StorageProvider,
  opts: { apply: boolean; minAgeMs: number; now?: Date },
): Promise<SweepReport> {
  const now = opts.now ?? new Date()
  const files = await storage.listObjects()
  const rows = await db.wardrobeImage.findMany({ select: { storageKey: true, displayKey: true, thumbnailKey: true } })
  const referenced = new Set(rows.flatMap((r) => [r.storageKey, r.displayKey, r.thumbnailKey]).filter((k): k is string => !!k))
  const report: SweepReport = { applied: opts.apply, files: files.length, referenced: 0, orphans: [], recentUnreferenced: 0, unknown: [] }
  for (const f of files) {
    if (!isValidStorageKey(f.key)) report.unknown.push(f.key)
    else if (referenced.has(f.key)) report.referenced++
    else if (now.getTime() - f.modifiedAt.getTime() >= opts.minAgeMs) report.orphans.push(f.key)
    else report.recentUnreferenced++
  }
  report.orphans.sort()
  report.unknown.sort()
  if (opts.apply && report.orphans.length) {
    // re-check right before deleting: a row may have been created meanwhile
    const again = await db.wardrobeImage.findMany({
      where: { OR: [{ storageKey: { in: report.orphans } }, { displayKey: { in: report.orphans } }, { thumbnailKey: { in: report.orphans } }] },
      select: { storageKey: true, displayKey: true, thumbnailKey: true },
    })
    const nowReferenced = new Set(again.flatMap((r) => [r.storageKey, r.displayKey, r.thumbnailKey]))
    report.orphans = report.orphans.filter((k) => !nowReferenced.has(k))
    await storage.deleteObjects(report.orphans)
  }
  return report
}

export interface BackfillReport {
  applied: boolean
  missingDisplay: number
  created: number
  failed: { imageId: string; reason: string }[]
}

/** Create the 1600 px WebP display variant for images uploaded before variants existed. Idempotent. */
export async function backfillDisplayVariants(db: PrismaClient, storage: StorageProvider, opts: { apply: boolean }): Promise<BackfillReport> {
  const report: BackfillReport = { applied: opts.apply, missingDisplay: 0, created: 0, failed: [] }
  let cursor: string | undefined
  for (;;) {
    const batch = await db.wardrobeImage.findMany({
      where: { displayKey: null },
      select: { id: true, storageKey: true },
      orderBy: { id: 'asc' },
      take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    if (!batch.length) break
    cursor = batch[batch.length - 1].id
    report.missingDisplay += batch.length
    if (!opts.apply) continue
    for (const img of batch) {
      const master = await storage.readObject(img.storageKey)
      if (!master) {
        report.failed.push({ imageId: img.id, reason: 'master missing' })
        continue
      }
      const displayKey = displayKeyFor(img.storageKey)
      try {
        const data = await sharp(master, { limitInputPixels: 40_000_000 })
          .rotate()
          .resize(DISPLAY_MAX_SIDE, DISPLAY_MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 82 })
          .toBuffer()
        await storage.writeObject(displayKey, data)
      } catch {
        report.failed.push({ imageId: img.id, reason: 'could not decode master' })
        continue
      }
      const { count } = await db.wardrobeImage.updateMany({ where: { id: img.id, displayKey: null }, data: { displayKey } })
      if (count === 1) report.created++
    }
  }
  return report
}
