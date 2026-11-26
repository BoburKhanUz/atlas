# 0009. Image processing in Go without C: standard decoders, WebP encoded by transpiled libwebp

- Status: accepted
- Date: 2026-11-26
- Decided by: the engineer (within the owner-approved plan, stage B4)

## Context

Every wardrobe upload is decoded, checked (format by content, dimensions, pixel count),
turned upright (EXIF orientation), stripped of metadata and written as three variants:
the master in its own format, a display WebP (≤ 1600 px, quality 82) and a thumbnail
WebP (≤ 400 px, quality 75). The Next.js API does this with sharp (libvips, C).
`apps/web/src/lib/storage/provider.ts`.

The Go image is a static binary on distroless (ADR 0001, B0). The input is untrusted
bytes from any client. Go's standard library decodes JPEG and PNG and encodes them;
`golang.org/x/image` decodes WebP and resizes; nothing in either encodes WebP.

## Decision

- Decoding untrusted input uses memory-safe Go only: `image/jpeg`, `image/png`,
  `golang.org/x/image/webp`. Dimensions and pixel count are read from the header
  (`DecodeConfig`) before anything is decoded; HEIC, HEIF and AVIF are recognised by
  their container brand and refused (415), as now.
- EXIF orientation is read by our own small parser (JPEG APP1, WebP `EXIF` chunk, PNG
  `eXIf`) and applied to the pixels. Re-encoding drops every other kind of metadata.
- Resizing uses `golang.org/x/image/draw` (Catmull-Rom), never enlarging.
- WebP is encoded with `github.com/gen2brain/webp`: libwebp compiled to WebAssembly and
  transpiled to Go (no cgo). It only ever encodes pixels we produced. Its optional path
  through a system libwebp (`purego`) cannot work in the static binary, and the server
  refuses to start if it ever reports one loaded, so the code that runs is the code
  that was reviewed and tested.
- Masters are re-encoded in their own format: JPEG quality 92 (Go's encoder), PNG,
  WebP lossless.

## Consequences

- The image stays static and distroless; no C library reads attacker-controlled bytes.
- Output bytes differ from sharp's (other resampling and encoders); dimensions, formats,
  limits and orientation are the same, and tests compare those, not bytes. The mock
  vision's colour reading works on a 32×32 resample of its own and is compared with the
  TypeScript one on the e2e fixtures and solid images.
- WebP encoding in transpiled code is slower than native libwebp (measured in B4; the
  upload's time limit and a bound on concurrent image work keep it in check).
- Differences from sharp to accept: animated WebP is refused (sharp took the first
  frame); CMYK JPEG is converted without its colour profile; 12-bit JPEG is refused.
- A new dependency to watch (`gen2brain/webp`, MIT; libwebp, BSD) and `x/image`.

## Alternatives considered

- **libvips through cgo (govips)**: the same engine as sharp, fast; but cgo, a runtime
  image with libvips and its C decoders reading untrusted input, and no static binary.
- **cgo libwebp (chai2010/webp)**: cgo again, for the encoder only.
- **Display and thumbnail as JPEG**: no new dependency, but larger files for every
  image shown, and a visible change of the stored format for no user benefit.
