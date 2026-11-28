package contract

import _ "embed"

// Document is the API contract, docs/api/openapi.json, byte for byte (a
// copy scripts/generate.sh keeps: the build context of the image is
// apps/api, outside of which the original lies).
//
//go:embed openapi.json
var Document []byte
