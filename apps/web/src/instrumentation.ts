/**
 * Next.js startup hook — runs once when the server boots. Refuse to start with
 * missing or insecure secrets instead of failing on every request.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertServerConfig } = await import('@/lib/config')
    try {
      assertServerConfig()
    } catch (err) {
      console.error(`[config] ${(err as Error).message}`)
      console.error('[config] Refusing to start. See .env.example.')
      process.exit(1)
    }
  }
}
