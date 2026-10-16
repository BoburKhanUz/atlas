import { NextRequest } from 'next/server'
import sharp from 'sharp'
import { signAccessToken } from '@/lib/auth'

export const TEST_USER = { sub: 'user_test_1', email: 'tester@example.com' }

/**
 * A garment-like photo of one colour with a faint woven stripe: enough detail
 * for the vision sharpness check (garment-quality.ts), still that colour for
 * the pixel cross-check. Returns a sharp pipeline (add metadata, then encode).
 */
export function garmentPhoto(width: number, height: number, color = '#2F5DA8') {
  // Alternating light and dark stripes keep detail on very light and very dark colours alike.
  const stripes = Array.from({ length: Math.ceil(width / 40) }, (_, i) => `<rect x="${i * 40}" width="12" height="${height}" fill="${i % 2 ? '#000' : '#fff'}" fill-opacity="0.12"/>`).join('')
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${color}"/>${stripes}</svg>`))
}

export async function authHeader(): Promise<Record<string, string>> {
  return { authorization: `Bearer ${await signAccessToken(TEST_USER)}` }
}

export function jsonRequest(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}
