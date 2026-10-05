# Media (wardrobe images)

Code: `src/lib/storage/provider.ts` (storage + variants), `src/lib/storage/media.ts`
(signed URLs), `src/app/api/v1/wardrobe/items/route.ts` (upload),
`src/server/idempotency.ts`, `src/server/media/maintenance.ts` (scripts).

## Upload contract — `POST /api/v1/wardrobe/items` (multipart)

- `file`: JPEG, PNG or WebP (declared type and decoded content both checked);
  ≤ 8 MB; request ≤ 10 MB with `Content-Length`; ≤ 40 MP.
- Dimensions after EXIF orientation: shortest side ≥ 256 px, every side ≤ 8000 px.
- Errors: 415 `UNSUPPORTED_IMAGE_FORMAT` (HEIC/HEIF/AVIF — detected by
  content even when mislabelled — GIF, wrong declared type), 422
  `IMAGE_DIMENSIONS`, 422 `INVALID_IMAGE` (corrupt bytes), 413
  `PAYLOAD_TOO_LARGE`. Clients convert HEIC to JPEG (mobile: longest side
  ≈ 2048 px, quality ≈ 85) — there is no server-side HEIC support.

## Variants

| Variant | Key | Format | Served |
|---|---|---|---|
| master | `users/<owner>/<uuid>.<jpg/png/webp>` | full resolution, orientation applied, EXIF/GPS/XMP stripped; JPEG q92, PNG and WebP lossless | never (AI pipeline, re-derivation) |
| display | `…/<uuid>_display.webp` | longest side ≤ 1600 px, WebP q82 | `url` |
| thumb | `…/<uuid>_thumb.webp` | longest side ≤ 400 px, WebP q75 (Phase 2 `_thumb.jpg` still read) | `thumbnailUrl` |

`WardrobeImage` also records `mimeType`, `bytes` and `sha256` of the upload.
Images uploaded before variants existed have no `displayKey` and are served
from the master until `scripts/backfill-display-variants.ts --apply` runs.
Deleting an item deletes all variants; deleting an account deletes the owner
directory. A failed upload removes whatever it wrote.

## Image object in responses

`{ id, url, thumbnailUrl, urlExpiresAt, isPrimary, width, height }` — URLs are
HMAC-signed and expire (`MEDIA_URL_TTL_SECONDS`, default 1 h); they differ on
every response, so clients cache by `id` + variant. With `PUBLIC_BASE_URL`
set they are absolute and built only from that setting (never from the Host
header); otherwise relative.

## Idempotency-Key

Optional header on the upload (8–128 chars `[A-Za-z0-9_-]`), per user, 24 h:

| Situation | Response |
|---|---|
| first request | processed normally |
| same key + same payload (file bytes, filename, form fields), completed | 201 with the original item (current state), `Idempotent-Replayed: true` |
| same key, different payload | 409 `IDEMPOTENCY_KEY_MISMATCH` |
| same key, still processing | 409 `IDEMPOTENCY_IN_PROGRESS`, `Retry-After: 5` |
| earlier attempt failed | key released — the retry is processed |
| claim older than 5 min (crashed request) | taken over; the original request can no longer complete (its transaction rolls back) |
| original item deleted meanwhile | 404 |

## Scripts (manual, dry run by default)

- `bun scripts/storage-sweep.ts [--apply] [--json] [--min-age-minutes=60]` —
  deletes files no image row references (e.g. display files left behind by a
  Phase 2 rollback). Recent files are kept (an upload writes files before its
  row commits); unknown file names are reported, never deleted.
- `bun scripts/backfill-display-variants.ts [--apply] [--json]` — creates
  missing display variants; re-runnable.
