---
name: lookly-testing
description: Test-first development and verification rules for Lookly (Go backend, Flutter app, Next.js web, e2e). Use before writing or changing any code, when fixing a bug, when a test fails or is flaky, and before claiming that anything works, passes or is fixed. Do NOT use for documentation-only changes.
---

# Lookly testing

Tests are the evidence the owner relies on. A claim without a test run from this
session is not a result.

## The rules

1. **Red, then green.** Write the test first, run it, and see it fail for the expected
   reason. Then write the smallest code that makes it pass, then run the whole suite of
   the touched app. Code written before its test is rewritten test-first.
2. **Every bug gets a regression test** that fails on the old code before it is fixed.
3. **Test behaviour through public interfaces** at the agreed seam: the HTTP handler for
   the backend, the notifier or the screen for Flutter, the page for web. Do not test
   private helpers or call order.
4. **Expected values come from independent sources** (a literal worked out by hand, a
   golden vector from the old implementation), never from the code under test.
5. **Mock only at system boundaries:** AI providers, mail, weather, clock, randomness,
   object storage, the network. Use the real PostgreSQL for anything that touches SQL.
6. **Never skip, disable, loosen or delete a test to get green.** A flaky test is a bug:
   find the race or the hidden dependency and fix it. Re-running until green is not a fix.
7. **Verify before you claim.** Run the command, read the whole output, report the
   numbers ("754 passed, 0 failed"). Do not rely on a subagent's or an earlier run's
   claim: re-run it yourself. Say plainly what you did not run.

## What a finished change has

- Unit tests for each rule or branch added (happy path, each error path, boundaries:
  empty, one, max, max+1, unicode, zero/negative).
- A test at the seam for each user story in the spec.
- For a bug: the regression test, plus a search for the same mistake elsewhere.
- For security-relevant code (auth, tokens, uploads, quotas): tests for the refusal
  paths, not only the success path.

## Go backend (`apps/api`)

```bash
go vet -tags nodynamic ./... && go run honnef.co/go/tools/cmd/staticcheck@v0.8.2 -tags integration,nodynamic ./... && go test -race -tags nodynamic ./...
LOOKLY_TEST_DATABASE_URL=... go test -race -tags integration,nodynamic ./...   # real PostgreSQL 16
```

- Table-driven tests; `t.Parallel()` where the test owns its data.
- SQL, transactions and locks are tested against a real PostgreSQL 16 (a throwaway
  database per test package). Never mock the database.
- Handlers are tested over `httptest` with the real router, middleware and error
  envelope; assert status, `code` and body shape against the contract.
- Contract tests: every response in the tests is validated against `docs/api/openapi.json`.
- Parity with the old TypeScript backend: see `references/parity.md`.
- Fuzz (`go test -fuzz`) parsers and anything that reads untrusted bytes: image sniffing,
  signed URL verification, request decoding. Commit the interesting corpus entries.

## Flutter (`apps/mobile`)

```bash
dart format --set-exit-if-changed lib test && flutter analyze && flutter test
```

- Override providers with `ProviderScope(overrides: ...)`; the fake backend harness is
  `test/support/fake_session.dart` (`SessionHarness`, `appOverrides`).
- `pump()` for one frame, `pumpAndSettle()` only when no infinite animation runs
  (skeletons and spinners never settle: pump a fixed duration instead).
- Golden tests (from stage M4, when the dark theme and the 2.0 text scale exist):
  main screens in light and dark, 360×800 logical size, text scale 1.0 and 2.0. Until
  then, widget tests at 320×568 and the current 1.6 cap. Generate goldens with
  `--update-goldens` only for an intended change, and look at the image before committing.
- `integration_test/` (from stage M6) covers the main journeys on an emulator or
  simulator: sign up, add an item, generate an outfit, chat, delete the account.
- `test/integration/` talks to a real backend and skips itself unless
  `ATLAS_ITEST_BASE_URL` is set. That skip is by design, not a skipped test in the sense
  of rule 6; run them against staging when the stage touches the API client.
- Test the keyboard-real inputs: apostrophes `'` `’` `ʻ` in Uzbek text, pasted text,
  empty and very long input.

## Web and e2e (`apps/web`)

```bash
bun run lint && bun run typecheck && bun run test
bun run test:e2e     # local: apps/web/e2e/run-local.sh with a PostgreSQL 16
```

- e2e tests drive the real server (today Next.js, after cutover the Go API) with mock AI
  providers. Wait for the page's own first requests before changing server state
  underneath it, or the test races the page.
- In a cloud session the installed Chromium revision may differ from the one Playwright
  expects; point `PLAYWRIGHT_BROWSERS_PATH` at a directory that links the expected
  revision name to the installed browser rather than downloading another.

## Reporting results

State, per app: the command, passed/failed/skipped counts, and anything not run
(device, iOS, live AI). If a test failed and you fixed it, say what the cause was.
