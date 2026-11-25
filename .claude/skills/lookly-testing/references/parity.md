# Parity with the TypeScript backend

The Go backend must behave like the current Next.js API where clients depend on it.
"Behave like" has three strengths; pick the right one per area.

| Strength | Areas | How it is checked |
|---|---|---|
| **Exact** | Outfit engine (pure scoring and ordering), catalog validation, quota and consent rules, error codes and statuses, session protocol | Golden vectors: run the TypeScript code on generated inputs, store inputs and outputs as JSON under `apps/api/testdata/golden/`, and require byte-equal output from Go |
| **Within tolerance** | Colour analysis, colour cross-check, deterministic mock vision, image variants (all depend on libvips pixel output) | Same golden inputs (fixture images); compare the decisions (season, undertone, primary colour, dimensions) exactly and floating values within an agreed tolerance recorded in the test and the ADR |
| **Same contract** | Everything else | Contract tests plus the Playwright e2e suite against the Go server |

## Producing golden vectors

1. Write a small script in `apps/web/scripts/` that imports the TypeScript module and
   writes `{input, output}` records for many inputs (fixed seeds, edge cases, random
   but seeded wardrobes). Commit the script and the JSON.
2. Generate them once from the TypeScript code at a known commit; record that commit in
   the JSON header.
3. The Go test loads every record and compares. A mismatch is investigated, never
   "regenerated away".

## Traps that break exact parity

- `Math.round` rounds half up (towards +∞); Go's `math.Round` rounds half away from zero.
  Use `math.Floor(x + 0.5)` where the TypeScript code used `Math.round`, and test
  `0.49999999999999994` and negative halves (`-2.5` gives `-2` in JavaScript), where the
  naive formula differs.
- JavaScript sorts are stable; use `sort.SliceStable` / `slices.SortStableFunc`.
- Number-to-string conversions (`String(seed)`) feed hashes: reproduce JavaScript's
  shortest round-trip formatting (`strconv.FormatFloat(f, 'g', -1, 64)` differs for some
  values; test them).
- Float expressions may be fused into FMA on arm64; write explicit `float64(...)`
  conversions around intermediate results that must round.
- Dates: the TypeScript code uses UTC milliseconds and Tashkent days; never use the
  server's local time zone.
