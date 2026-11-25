package httpapi_test

import (
	"bytes"
	"encoding/json"
	"reflect"
	"testing"
	"unicode/utf8"

	"lookly/internal/apierr"
	"lookly/internal/golden"
	"lookly/internal/httpapi"
	"lookly/internal/legal"
)

// wrongType reports whether the member at path of a JSON object body is of
// another JSON type than the schema expects there (a boolean for
// ageConfirmed, a string for everything else).
func wrongType(body, path string) bool {
	var object map[string]json.RawMessage
	if json.Unmarshal([]byte(body), &object) != nil {
		return false
	}
	raw, present := object[path]
	if !present {
		return true
	}
	first := bytes.TrimSpace(raw)[0]
	if path == "ageConfirmed" {
		return first != 't' && first != 'f'
	}
	return first != '"'
}

// The Next.js validator (zod), after reporting a member of the wrong type,
// also applies the string's length rules to arrays and to objects that have
// a "length" member, and reports those too. Go reports the wrong type and
// nothing more about that member. sameDetails compares with that in mind and
// says whether the difference occurred.
func sameDetails(c golden.ValidationCase, got []apierr.Detail) (same, simplified bool) {
	type detail struct{ path, message string }
	var want []detail
	typeReported := map[string]bool{}
	for _, d := range c.Details {
		if typeReported[d.Path] {
			simplified = true
			continue // zod's follow-up on a member whose type was already reported
		}
		if d.Path != "" && wrongType(c.Body, d.Path) {
			typeReported[d.Path] = true
		}
		want = append(want, detail{d.Path, d.Message})
	}
	if len(got) != len(want) {
		return false, simplified
	}
	for i := range want {
		if got[i].Path != want[i].path || got[i].Message != want[i].message {
			return false, simplified
		}
	}
	return true, simplified
}

func TestRequestBodiesAreJudgedAsTheNextJSAPIJudgesThem(t *testing.T) {
	t.Parallel()
	g := golden.LoadAuthValidation(t)
	if g.LegalVersion != legal.Version {
		t.Fatalf("auth-validation.json was recorded with legal version %q; it is %q now: run apps/web/scripts/golden-auth-validation.ts again", g.LegalVersion, legal.Version)
	}
	simplifiedCases := 0
	for _, section := range []struct {
		name  string
		rule  httpapi.BodyRule
		cases []golden.ValidationCase
	}{
		{"login", httpapi.LoginBody, g.Login},
		{"register", httpapi.RegisterBody, g.Register},
		{"refresh", httpapi.RefreshBody, g.Refresh},
		{"logout", httpapi.LogoutBody, g.Logout},
	} {
		accepted, refused := 0, 0
		for _, c := range section.cases {
			canonical, err := section.rule([]byte(c.Body))
			name := section.name + ": " + c.Name
			if c.OK {
				accepted++
				if err != nil {
					t.Errorf("%s: refused (%v), want accepted", name, err)
					continue
				}
				var got, want any
				if json.Unmarshal(canonical, &got) != nil || json.Unmarshal(c.Value, &want) != nil || !reflect.DeepEqual(got, want) {
					t.Errorf("%s: parsed as %s, want %s", name, canonical, c.Value)
				}
				if !utf8.Valid(canonical) {
					t.Errorf("%s: the canonical body is not UTF-8", name)
				}
				continue
			}
			refused++
			if err == nil {
				t.Errorf("%s: accepted as %s, want %s", name, canonical, c.Code)
				continue
			}
			if string(err.Code) != c.Code || err.Status() != c.Status || err.Message != c.Error {
				t.Errorf("%s: %d %s %q, want %d %s %q", name, err.Status(), err.Code, err.Message, c.Status, c.Code, c.Error)
			}
			same, simplified := sameDetails(c, err.Details)
			if !same {
				t.Errorf("%s: details %+v, want %+v", name, err.Details, c.Details)
			}
			if simplified {
				simplifiedCases++
			}
		}
		if accepted == 0 || refused == 0 {
			t.Errorf("%s: %d accepted and %d refused vectors", section.name, accepted, refused)
		}
	}
	if simplifiedCases == 0 {
		t.Error("no vector shows zod's length report on a wrong type: the note about it is stale")
	}
}

// Whatever the body, a rule never panics; what it accepts is canonical JSON
// that it accepts again, unchanged.
func FuzzBodyRules(f *testing.F) {
	g := golden.LoadAuthValidation(f)
	for _, section := range [][]golden.ValidationCase{g.Login, g.Register, g.Refresh, g.Logout} {
		for i, c := range section {
			if i%3 == 0 {
				f.Add(c.Body)
			}
		}
	}
	rules := []httpapi.BodyRule{httpapi.LoginBody, httpapi.RegisterBody, httpapi.RefreshBody, httpapi.LogoutBody}
	f.Fuzz(func(t *testing.T, body string) {
		for i, rule := range rules {
			canonical, err := rule([]byte(body))
			if err != nil {
				if err.Code != apierr.BadRequest && err.Code != apierr.ValidationError {
					t.Fatalf("rule %d: code %s", i, err.Code)
				}
				if err.Code == apierr.ValidationError && (len(err.Details) == 0 || err.Details[0].Message != err.Message) {
					t.Fatalf("rule %d: message %q is not the first detail %+v", i, err.Message, err.Details)
				}
				continue
			}
			again, err := rule(canonical)
			if err != nil || !bytes.Equal(again, canonical) {
				t.Fatalf("rule %d: %q became %q, then %q (%v)", i, body, canonical, again, err)
			}
		}
	})
}
