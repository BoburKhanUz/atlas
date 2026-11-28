# API contract (OpenAPI 3.1)

`openapi.json` is the contract, edited by hand (ADR 0003; generated from a
TypeScript registry until B7.5). The Go server serves it at `GET /api/v1/openapi.json`.

- Change it here, then regenerate the Go server interface and types
  (`apps/api/scripts/generate.sh`) and the Dart client
  (`apps/mobile/tool/openapi/generate_api.sh`), then implement.
- CI: `bun run openapi:validate` in `apps/web` (OpenAPI 3.1 schema and `$ref`s);
  `generate.sh --check` and `generate_api.sh --check` (generated code current); Go's
  contract tests (`internal/contracttest`: every response the handlers give matches;
  `internal/apierr`: every error code sits under the status the document gives it);
  the API journey suite (`apps/web/api-e2e`: every answer of the running Go server
  checked against the document).
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
