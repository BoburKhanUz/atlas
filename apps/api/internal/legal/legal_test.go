package legal_test

import (
	"encoding/json"
	"os"
	"regexp"
	"testing"

	"lookly/internal/contracttest"
	"lookly/internal/legal"
)

type vectors struct {
	GeneratedBy  string `json:"generatedBy"`
	SourceCommit string `json:"sourceCommit"`
	Note         string `json:"note"`
	MinVersion   string `json:"minVersion"`
	Compare      []struct {
		A      string `json:"a"`
		B      string `json:"b"`
		Result *int   `json:"result"`
	} `json:"compare"`
	StillValid []struct {
		Version string `json:"version"`
		Valid   bool   `json:"valid"`
	} `json:"stillValid"`
}

func load(t testing.TB) vectors {
	t.Helper()
	f, err := os.Open(contracttest.RepoPath("apps/api/testdata/golden/legal.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	dec := json.NewDecoder(f)
	dec.DisallowUnknownFields()
	var v vectors
	if err := dec.Decode(&v); err != nil {
		t.Fatal(err)
	}
	if len(v.Compare) == 0 || len(v.StillValid) == 0 {
		t.Fatal("legal.json: a section is empty")
	}
	return v
}

func TestCompareMatchesTheTypeScriptComparison(t *testing.T) {
	t.Parallel()
	results := map[int]int{}
	malformed := 0
	for _, c := range load(t).Compare {
		got, ok := legal.Compare(c.A, c.B)
		switch {
		case c.Result == nil && ok:
			t.Errorf("Compare(%q, %q) = %d, want malformed", c.A, c.B, got)
		case c.Result != nil && (!ok || got != *c.Result):
			t.Errorf("Compare(%q, %q) = %d %v, want %d", c.A, c.B, got, ok, *c.Result)
		}
		if c.Result == nil {
			malformed++
		} else {
			results[*c.Result]++
		}
	}
	if results[-1] == 0 || results[0] == 0 || results[1] == 0 || malformed == 0 {
		t.Errorf("the vectors do not reach every outcome: %v, %d malformed", results, malformed)
	}
}

// The Go constants are the website's (apps/web/src/lib/legal/version.ts): the
// legal pages show the texts under that version and the server records
// consent to it, so the two must agree.
func TestTheVersionsAreTheTypeScriptOnes(t *testing.T) {
	t.Parallel()
	source, err := os.ReadFile(contracttest.RepoPath("apps/web/src/lib/legal/version.ts"))
	if err != nil {
		t.Fatal(err)
	}
	constant := func(name string) string {
		m := regexp.MustCompile(`(?m)^export const ` + name + ` = '([^']+)'$`).FindSubmatch(source)
		if m == nil {
			t.Fatalf("%s not found in version.ts", name)
		}
		return string(m[1])
	}
	if got := constant("LEGAL_VERSION"); got != legal.Version {
		t.Errorf("LEGAL_VERSION is %q in TypeScript, %q in Go", got, legal.Version)
	}
	// Both are well formed, and the current version itself counts as consent.
	if _, ok := legal.Compare(legal.Version, legal.MinConsentVersion); !ok || !legal.StillValid(legal.Version) || !legal.StillValid(legal.MinConsentVersion) {
		t.Error("the current versions are malformed or do not count as consent")
	}
}

func TestStillValidMatchesTheTypeScriptRule(t *testing.T) {
	t.Parallel()
	v := load(t)
	// The recorded answers depend on the minimum version at recording time.
	if v.MinVersion != legal.MinConsentVersion {
		t.Fatalf("legal.json was recorded with the minimum version %q; it is %q now: set its minimum and work out each case's answer again by hand (its generator, apps/web/scripts/golden-legal.ts, is in git history at e57764f)", v.MinVersion, legal.MinConsentVersion)
	}
	valid, invalid := 0, 0
	for _, c := range v.StillValid {
		if got := legal.StillValid(c.Version); got != c.Valid {
			t.Errorf("StillValid(%q) = %v, want %v", c.Version, got, c.Valid)
		}
		if c.Valid {
			valid++
		} else {
			invalid++
		}
	}
	if valid == 0 || invalid == 0 {
		t.Errorf("%d valid and %d invalid vectors", valid, invalid)
	}
}

func FuzzCompare(f *testing.F) {
	for _, c := range load(f).Compare[:60] {
		f.Add(c.A, c.B)
	}
	f.Fuzz(func(t *testing.T, a, b string) {
		ab, ok1 := legal.Compare(a, b)
		ba, ok2 := legal.Compare(b, a)
		if ok1 != ok2 || (ok1 && ab != -ba) {
			t.Fatalf("Compare(%q, %q) = %d %v, reversed %d %v", a, b, ab, ok1, ba, ok2)
		}
		if aa, ok := legal.Compare(a, a); ok && aa != 0 {
			t.Fatalf("Compare(%q, itself) = %d", a, aa)
		}
		if !ok1 && (legal.StillValid(a) && a != legal.MinConsentVersion && legal.StillValid(b) && b != legal.MinConsentVersion) {
			t.Fatalf("both %q and %q count as consent, yet they cannot be compared", a, b)
		}
	})
}
