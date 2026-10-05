import { NextRequest } from 'next/server'
import { signAccessToken } from '@/lib/auth'

export const TEST_USER = { sub: 'user_test_1', email: 'tester@example.com' }

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
