# API contract (OpenAPI 3.1)

`openapi.json` is generated — do not edit it by hand. It is also served at
`GET /api/v1/openapi.json`.

- Source: `apps/web/src/server/openapi/registry.ts` (one entry per route
  method) and the Zod schemas in `apps/web/src/server/schemas/requests.ts` /
  `responses.ts`, which the route handlers use too.
- Regenerate after changing a route or schema: `cd apps/web && bun run openapi:write`.
- CI: `openapi:check` (committed copy up to date), `openapi:validate`
  (OpenAPI 3.1 schema and `$ref`s), `tests/unit/openapi.test.ts` (every route
  file ↔ registry entry), `tests/integration/contract.itest.ts` (real handler
  responses match the schemas; every documented success and operation-specific
  error code is exercised).
- Errors: every non-2xx JSON response is `ErrorResponse`; the codes possible
  per status are listed in `x-error-codes`. Clients branch on `code`.
- Auth: `bearerAuth` (mobile, `Authorization: Bearer`) or `cookieAuth` (web).
  Auth routes take `X-Atlas-Client: mobile` for token bodies; their 200/201
  response is `MobileAuthResponse` in mobile mode and `WebAuthResponse` otherwise.

## Dart client (mobile app)

CI job `dart-client` (non-blocking) generates and analyzes a client; nothing
generated is committed. Locally:

```bash
docker run --rm -v "$PWD:/work" openapitools/openapi-generator-cli:v7.10.0 generate \
  -i /work/docs/api/openapi.json -g dart-dio -o /work/.dart-client --additional-properties=pubName=atlas_api
docker run --rm -v "$PWD/.dart-client:/client" -w /client dart:3.5.4 \
  sh -c "dart pub get && dart run build_runner build --delete-conflicting-outputs && dart analyze --no-fatal-warnings"
```

The generator's OpenAPI 3.1 support is incomplete; the document avoids the
shapes it mishandles (unions in query parameters, `additionalProperties: {}`
next to nullable fields).
