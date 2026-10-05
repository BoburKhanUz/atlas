import { NextResponse } from 'next/server'
import { verifyMediaSignature } from '@/lib/storage/media'
import { contentTypeForKey, getStorageProvider } from '@/lib/storage/provider'
import { ApiError, withApi } from '@/server/http'

export const runtime = 'nodejs'

// GET /api/v1/media/<storage key>?exp=...&sig=...
// Serves a private image only when the HMAC signature is valid and unexpired.
export const GET = withApi<{ params: Promise<{ key: string[] }> }>(async (req, ctx) => {
  const { key: segments } = await ctx.params
  const key = segments.join('/')
  const url = new URL(req.url)

  if (!verifyMediaSignature(key, url.searchParams.get('exp'), url.searchParams.get('sig'))) {
    throw new ApiError('NOT_FOUND')
  }

  const data = await getStorageProvider().readObject(key)
  if (!data) throw new ApiError('NOT_FOUND')

  return new NextResponse(new Uint8Array(data), {
    headers: {
      'Content-Type': contentTypeForKey(key),
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  })
})
