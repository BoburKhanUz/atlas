# 0008. Generating the Go server from the OpenAPI 3.1 contract

- Status: accepted
- Date: 2026-11-25
- Decided by: the engineer (within the owner-approved plan; ADR 0003 asked for this spike)

## Context

The contract (`docs/api/openapi.json`) is OpenAPI 3.1, generated from the TypeScript
registry until B7 (ADR 0003). It uses these 3.1 features:

- 121 nullable fields written as `anyOf: [X, {type: null}]`;
- one `oneOf` whose branches are told apart by a string `const` (`ColorProfileResponse`);
- non-string `const` (`OkResponse.ok: true`, `Detection.mock`);
- `propertyNames` and `contentMediaType`.

The email pattern copied from zod uses lookahead (`(?!\.)(?!.*\.\.)`), which Go's regexp
(RE2) does not support. The Dart client already needs a preparation step for its
generator (`apps/mobile/tool/openapi/prepare_spec.dart`).

The spike (2026-11-25) ran oapi-codegen v2.8.2 (strict net/http server) on the document
unchanged:

- It generated all 35 operations and 62 schemas; the code compiled with no errors.
- Nullable fields became pointers. With `nullable-type: true`, optional nullable request
  fields become `nullable.Nullable[T]`, which tells "sent as null" from "not sent". PATCH
  needs this: `subcategory: null` clears a field, an absent field keeps it.
- Both unions (`AuthResponse`, `ColorProfileResponse`) became types with typed
  `From…`/`As…` helpers.
- Multipart bodies arrive as a streaming `*multipart.Reader`, binary media as `io.Reader`.
- The default error handlers write the raw error text with a plain 400. They must be
  replaced.

Response validation with kin-openapi v0.153.0:

- Its default (3.0) validator ignored `const`: a wrong `status` and `ok: false` passed.
- With `openapi3.EnableJSONSchema2020()` both were rejected.
- The email pattern fails to compile. With `openapi3.SetSchemaRegexCompiler` and
  `regexp2` in ECMAScript mode it is enforced: a leading dot and `..` are rejected.

## Decision

- Generate the Go server with **oapi-codegen v2.8.2** (pinned as a Go `tool` dependency),
  options `strict-server`, `std-http-server`, `models` and `nullable-type: true`, directly
  from `docs/api/openapi.json`. There is no preparation step and no hand-edited copy.
- The generated interface contains **only the operations implemented so far**
  (`include-operation-ids`). A stage adds its operations with their handlers. A test
  lists the operations not yet implemented, so the gap stays visible and reaches zero at
  B7. No stub handlers exist.
- The generator's three error hooks are replaced so that decode and encode failures
  answer with the contract's envelope and never echo internals.
- **Contract tests** validate every response against the document with kin-openapi,
  using the JSON Schema 2020-12 validator and an ECMAScript regex engine (`regexp2`,
  test-only dependency).
- The server enforces the email rule in code (same rule as the pattern, without
  lookahead) when auth arrives in B2. Go's regexp cannot run the pattern.
- CI regenerates the code and fails on any difference.

## Consequences

- Adding an endpoint means adding its operation id to the generator config and
  implementing the generated method: the compiler then enforces the request and
  response types.
- Request validation beyond types (enums, lengths, patterns) is not done by the
  generator. Each handler's service validates its input and answers `VALIDATION_ERROR`
  with Uzbek messages, as the Next.js API does.
- The Go toolchain must be 1.25 or newer (oapi-codegen requirement); the module uses
  Go 1.26.
- If the TypeScript registry starts emitting a 3.1 construct the generator cannot read,
  generation fails in CI. It does not drift silently.

## Alternatives considered

- **ogen:** strong 3.1 support and built-in validation, but its generated types (option
  wrappers for every field) and its own router make every handler and test more verbose.
  oapi-codegen handled the whole document, so the plan's choice stands.
- **A preparation step that rewrites 3.1 into 3.0** (as for Dart): not needed for
  generation; it would only add a second document to keep in sync.
- **Hand-written routes and types:** rejected by ADR 0003; drift would only show at
  runtime.
