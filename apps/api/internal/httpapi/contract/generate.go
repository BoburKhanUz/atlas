// Package contract holds the server interface and types generated from the
// OpenAPI contract (docs/api/openapi.json). Never edit contract.gen.go by hand:
// run scripts/generate.sh (CI fails when it is stale).
package contract

//go:generate go tool oapi-codegen -config oapi-codegen.yaml ../../../../../docs/api/openapi.json
