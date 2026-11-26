package legal_test

import (
	"encoding/json"
	"testing"

	"lookly/internal/contracttest"
	"lookly/internal/legal"
)

// The embedded texts are a copy of the Next.js app's (which checks that the
// copy equals its source). Here: the copy is the version this server takes
// consent for, and it is what the contract promises.
func TestTheEmbeddedTextsAreTheCurrentVersion(t *testing.T) {
	t.Parallel()
	contracttest.Schema(t, "LegalResponse", legal.Documents())
	var bundle struct {
		Version   string `json:"version"`
		Documents []struct {
			ID       string `json:"id"`
			Title    string `json:"title"`
			Sections []struct {
				Heading    string   `json:"heading"`
				Paragraphs []string `json:"paragraphs"`
			} `json:"sections"`
		} `json:"documents"`
	}
	if err := json.Unmarshal(legal.Documents(), &bundle); err != nil {
		t.Fatal(err)
	}
	if bundle.Version != legal.Version {
		t.Fatalf("documents.json holds version %q; the server takes consent for %q: run apps/web/scripts/legal-bundle.ts again", bundle.Version, legal.Version)
	}
	var ids []string
	for _, d := range bundle.Documents {
		ids = append(ids, d.ID)
		if d.Title == "" || len(d.Sections) == 0 {
			t.Errorf("document %q has no title or no sections", d.ID)
		}
		for _, s := range d.Sections {
			if s.Heading == "" || len(s.Paragraphs) == 0 {
				t.Errorf("document %q: a section without a heading or paragraphs", d.ID)
			}
		}
	}
	if len(ids) != 2 || ids[0] != "privacy" || ids[1] != "terms" {
		t.Errorf("documents %v, want privacy and terms", ids)
	}
}
