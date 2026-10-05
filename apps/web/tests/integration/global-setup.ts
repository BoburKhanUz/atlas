/** Creates the app database for integration tests (all migrations + test clock); drops it afterwards. */
import { APP_DB, createDb, dropDb, enabled, installTestClock, migrationsDir, prisma, rmDir } from './pg'

export default async function setup() {
  if (!enabled) return
  createDb(APP_DB)
  const dir = migrationsDir()
  const r = await prisma(APP_DB, dir)
  rmDir(dir)
  if (r.code !== 0) throw new Error(`migrate deploy failed for ${APP_DB}:\n${r.output}`)
  installTestClock(APP_DB)
  return () => {
    if (!process.env.ATLAS_ITEST_KEEP) dropDb(APP_DB)
  }
}
