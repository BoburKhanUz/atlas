/**
 * Shared HTTP contract for every API route.
 *
 * Error responses always have this shape (the `error` field keeps the
 * original MVP contract, so existing clients keep working):
 *
 *   { "error": "<Uzbek user-facing message>", "code": "<ERROR_CODE>",
 *     "details"?: [...], "requestId": "<id>" }
 *
 * Wrap handlers with `withApi` so thrown `ApiError`s become responses,
 * unexpected errors become a logged 500 (no internals leaked), and every
 * response carries `x-request-id`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z, type ZodType } from 'zod'
import crypto from 'crypto'
import { log } from '@/server/log'
import { SessionBusyError } from '@/server/session/protocol'
import type { ERROR_CODES } from '@/server/schemas/responses'

// Built-in validation messages in Uzbek (Zod ships uz/ru/en locales; switch
// per request when ru/en are added). Explicit schema messages still win.
z.config(z.locales.uz())

// The list itself lives with the documented response schemas, so the OpenAPI
// document can never miss a code (src/server/schemas/responses.ts).
// Session protocol codes: SESSION_RACE / SESSION_BUSY are retryable, the other
// session 401s are terminal.
export type ErrorCode = (typeof ERROR_CODES)[number]

const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  BAD_REQUEST: 'Yaroqsiz so‘rov',
  VALIDATION_ERROR: 'Ma’lumotlar noto‘g‘ri',
  UNAUTHORIZED: 'Avtorizatsiya talab qilinadi',
  FORBIDDEN: 'Ruxsat yo‘q',
  NOT_FOUND: 'Topilmadi',
  CONFLICT: 'Ziddiyat',
  PAYLOAD_TOO_LARGE: 'So‘rov hajmi juda katta',
  UNSUPPORTED_MEDIA_TYPE: 'Qo‘llab-quvvatlanmaydigan format',
  INVALID_IMAGE: 'Rasm faylini o‘qib bo‘lmadi',
  UNSUPPORTED_IMAGE_FORMAT: 'Faqat JPG, PNG yoki WEBP rasmlar qabul qilinadi (HEIC emas)',
  IMAGE_DIMENSIONS: 'Rasm o‘lchami: eng kichik tomoni kamida 256 px, eng katta tomoni ko‘pi bilan 8000 px bo‘lishi kerak',
  IDEMPOTENCY_KEY_MISMATCH: 'Bu Idempotency-Key boshqa so‘rov uchun ishlatilgan',
  IDEMPOTENCY_IN_PROGRESS: 'Xuddi shu so‘rov hali bajarilmoqda. Birozdan so‘ng qayta urinib ko‘ring.',
  RATE_LIMITED: 'Juda ko‘p urinish. Birozdan so‘ng qayta urinib ko‘ring.',
  INTERNAL: 'Serverda xatolik yuz berdi. Keyinroq qayta urinib ko‘ring.',
  INVALID_TOKEN: 'Sessiya topilmadi. Qayta kiring.',
  SESSION_EXPIRED: 'Sessiya muddati tugadi. Qayta kiring.',
  SESSION_REVOKED: 'Sessiya yakunlangan. Qayta kiring.',
  REFRESH_REUSED: 'Xavfsizlik uchun sessiya yakunlandi. Qayta kiring.',
  SESSION_RACE: 'Sessiya boshqa so‘rov tomonidan yangilandi. Qayta urinib ko‘ring.',
  CLIENT_MISMATCH: 'Bu sessiya boshqa ilova turi uchun. Qayta kiring.',
  SESSION_BUSY: 'Server band. Birozdan so‘ng qayta urinib ko‘ring.',
}

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  INVALID_IMAGE: 422,
  UNSUPPORTED_IMAGE_FORMAT: 415,
  IMAGE_DIMENSIONS: 422,
  IDEMPOTENCY_KEY_MISMATCH: 409,
  IDEMPOTENCY_IN_PROGRESS: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  INVALID_TOKEN: 401,
  SESSION_EXPIRED: 401,
  SESSION_REVOKED: 401,
  REFRESH_REUSED: 401,
  SESSION_RACE: 401,
  CLIENT_MISMATCH: 401,
  SESSION_BUSY: 503,
}

/** HTTP status for an error code (used by the OpenAPI document). */
export function errorStatus(code: ErrorCode): number {
  return STATUS[code]
}

export interface ErrorDetail {
  path: string
  message: string
}

export class ApiError extends Error {
  readonly status: number
  constructor(
    readonly code: ErrorCode,
    message?: string,
    readonly details?: ErrorDetail[],
    readonly headers?: Record<string, string>,
  ) {
    super(message ?? DEFAULT_MESSAGES[code])
    this.status = STATUS[code]
  }
}

export function requestIdOf(req: Request): string {
  const incoming = req.headers.get('x-request-id')
  return incoming && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID()
}

export function errorResponse(err: ApiError, requestId?: string): NextResponse {
  return NextResponse.json(
    {
      error: err.message,
      code: err.code,
      ...(err.details?.length ? { details: err.details } : {}),
      ...(requestId ? { requestId } : {}),
    },
    {
      status: err.status,
      headers: { ...(err.headers ?? {}), ...(requestId ? { 'x-request-id': requestId } : {}) },
    },
  )
}

/** 503 SESSION_BUSY: retry after a second (lock contention on one session family). */
export function sessionBusy(): ApiError {
  return new ApiError('SESSION_BUSY', undefined, undefined, { 'Retry-After': '1' })
}

/** Convenience for handlers that return instead of throw. */
export function apiError(code: ErrorCode, message?: string, details?: ErrorDetail[]) {
  return errorResponse(new ApiError(code, message, details))
}

type Handler<C> = (req: NextRequest, ctx: C) => Promise<Response> | Response

/** Wrap a route handler: error mapping, request id, structured logging. */
export function withApi<C = unknown>(handler: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    const requestId = requestIdOf(req)
    const started = Date.now()
    const path = new URL(req.url).pathname
    try {
      const res = await handler(req, ctx)
      res.headers.set('x-request-id', requestId)
      // 503 + Retry-After (SESSION_BUSY) is expected contention, not a failure
      if (res.status === 503 && res.headers.has('retry-after')) log.warn('request deferred', { requestId, method: req.method, path, status: res.status })
      else if (res.status >= 500) log.error('request failed', { requestId, method: req.method, path, status: res.status })
      return res
    } catch (err) {
      if (err instanceof SessionBusyError) {
        log.warn('session store busy', { requestId, method: req.method, path })
        return errorResponse(sessionBusy(), requestId)
      }
      if (err instanceof ApiError) {
        if (err.code === 'SESSION_BUSY') log.warn('request deferred', { requestId, method: req.method, path, code: err.code })
        else if (err.status >= 500) log.error('request failed', { requestId, method: req.method, path, err })
        return errorResponse(err, requestId)
      }
      log.error('unhandled error', { requestId, method: req.method, path, ms: Date.now() - started, err })
      return errorResponse(new ApiError('INTERNAL'), requestId)
    }
  }
}

// ─── Request body helpers ────────────────────────────────────────────────────

export const JSON_BODY_LIMIT = 64 * 1024 // 64 KB
export const UPLOAD_BODY_LIMIT = 10 * 1024 * 1024 // 10 MB (8 MB image + multipart overhead)

/** Reject bodies over `limit` using Content-Length before reading them. */
export function assertBodySize(req: Request, limit: number, { requireLength = false } = {}) {
  const raw = req.headers.get('content-length')
  if (raw === null) {
    if (requireLength) throw new ApiError('PAYLOAD_TOO_LARGE', 'So‘rov hajmi ko‘rsatilmagan')
    return
  }
  const len = Number(raw)
  if (!Number.isFinite(len) || len < 0) throw new ApiError('BAD_REQUEST')
  if (len > limit) throw new ApiError('PAYLOAD_TOO_LARGE')
}

function zodDetails(error: z.ZodError): ErrorDetail[] {
  return error.issues.slice(0, 20).map((i) => ({ path: i.path.join('.'), message: i.message }))
}

/** Parse + validate a JSON body (size-limited). Throws ApiError on failure. */
export async function parseJson<T>(req: Request, schema: ZodType<T>, limit = JSON_BODY_LIMIT): Promise<T> {
  assertBodySize(req, limit)
  const text = await req.text()
  if (Buffer.byteLength(text) > limit) throw new ApiError('PAYLOAD_TOO_LARGE')
  let body: unknown
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    throw new ApiError('BAD_REQUEST', 'Yaroqsiz JSON')
  }
  return validate(body, schema)
}

/** Validate an already-read value (query params, form fields…). */
export function validate<T>(value: unknown, schema: ZodType<T>): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new ApiError('VALIDATION_ERROR', parsed.error.issues[0]?.message, zodDetails(parsed.error))
  }
  return parsed.data
}

/** Read multipart form data with an upload size limit (Content-Length required). */
export async function parseForm(req: Request, limit = UPLOAD_BODY_LIMIT): Promise<FormData> {
  assertBodySize(req, limit, { requireLength: true })
  const type = req.headers.get('content-type') ?? ''
  if (!type.toLowerCase().startsWith('multipart/form-data')) {
    throw new ApiError('UNSUPPORTED_MEDIA_TYPE', 'multipart/form-data kutilgan')
  }
  try {
    return await req.formData()
  } catch {
    throw new ApiError('BAD_REQUEST', 'Yaroqsiz forma ma’lumotlari')
  }
}
