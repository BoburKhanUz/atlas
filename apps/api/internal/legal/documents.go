package legal

import (
	"bytes"
	_ "embed"
)

// documents.json is the body of GET /api/v1/legal: the privacy policy and
// the terms of use with their version. Until the cutover (B7) the texts are
// owned by the Next.js app (apps/web/src/lib/legal); this copy is written
// by apps/web/scripts/legal-bundle.ts, and a test there fails when it is
// stale.
//
//go:embed documents.json
var documents []byte

// Documents is the current legal texts as JSON, as the contract's
// LegalResponse.
func Documents() []byte { return bytes.TrimSpace(documents) }
