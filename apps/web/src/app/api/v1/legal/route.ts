import { NextResponse } from 'next/server'
import { legalBundle } from '@/lib/legal/documents'
import { withApi } from '@/server/http'

export const runtime = 'nodejs'

// GET /api/v1/legal — public: the current privacy policy and terms of use with
// their version. Registration sends that version back (acceptedLegalVersion).
export const GET = withApi(async () => NextResponse.json(legalBundle()))
