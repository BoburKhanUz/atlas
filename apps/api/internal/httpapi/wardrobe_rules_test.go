package httpapi_test

import (
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"reflect"
	"testing"

	"lookly/internal/apierr"
	"lookly/internal/golden"
	"lookly/internal/httpapi"
)

// same compares an outcome with what a rule returned: the parsed value, or
// the error envelope's status, code, message and details.
func same(t *testing.T, name string, want golden.Outcome, got any, err *apierr.Error) {
	t.Helper()
	if want.OK {
		if err != nil {
			t.Errorf("%s: refused (%v), want accepted", name, err)
			return
		}
		var w any
		_ = json.Unmarshal(want.Value, &w)
		encoded, _ := json.Marshal(got)
		var g any
		_ = json.Unmarshal(encoded, &g)
		if !reflect.DeepEqual(g, w) {
			t.Errorf("%s: parsed as %s, want %s", name, encoded, want.Value)
		}
		return
	}
	if err == nil {
		t.Errorf("%s: accepted as %v, want %s", name, got, want.Code)
		return
	}
	if string(err.Code) != want.Code || err.Status() != want.Status || err.Message != want.Error || len(err.Details) != len(want.Details) {
		t.Errorf("%s: %d %s %q %+v, want %d %s %q %+v", name, err.Status(), err.Code, err.Message, err.Details, want.Status, want.Code, want.Error, want.Details)
		return
	}
	for i, d := range want.Details {
		if err.Details[i].Path != d.Path || err.Details[i].Message != d.Message {
			t.Errorf("%s: detail %d is %+v, want %+v", name, i, err.Details[i], d)
		}
	}
}

func TestWardrobeRequestsAreJudgedAsTheNextJSAPIJudgesThem(t *testing.T) {
	t.Parallel()
	g := golden.LoadWardrobeValidation(t)
	judge(t, []goldenSection{{name: "patch", rule: httpapi.WardrobePatchBody, cases: g.Patch, exact: true}})

	for _, c := range g.Query {
		values := url.Values{}
		for k, v := range c.Query {
			values.Set(k, v)
		}
		canonical, err := httpapi.WardrobeListQuery(values)
		var got map[string]any
		if err == nil {
			got = map[string]any{}
			for k := range canonical {
				got[k] = canonical.Get(k)
			}
			// The limit is a number in the Next.js value.
			if limit, ok := got["limit"].(string); ok {
				var n json.Number = json.Number(limit)
				got["limit"] = n
			}
		}
		same(t, "query: "+c.Name, c.Outcome, got, err)
	}
	for _, c := range g.ID {
		id, err := httpapi.ItemID(c.ID)
		var got any
		if err == nil {
			got = map[string]string{"id": id}
		}
		same(t, "id "+c.ID, c.Outcome, got, err)
	}
	for _, c := range g.IdempotencyKey {
		r := httptest.NewRequest("POST", "/", nil)
		name := "key absent"
		if c.Key != nil {
			r.Header.Set("Idempotency-Key", *c.Key)
			name = "key " + *c.Key
		}
		key, present, err := httpapi.IdempotencyKey(r)
		var got any
		if err == nil && present {
			got = key
		}
		same(t, name, c.Outcome, got, err)
	}
}

// Whatever the query, the rule never panics, and what it accepts it
// accepts again unchanged.
func FuzzWardrobeListQuery(f *testing.F) {
	for _, c := range golden.LoadWardrobeValidation(f).Query {
		f.Add(c.Query["category"], c.Query["limit"], c.Query["cursor"])
	}
	f.Fuzz(func(t *testing.T, category, limit, cursor string) {
		q := url.Values{"category": {category}, "limit": {limit}, "cursor": {cursor}}
		canonical, err := httpapi.WardrobeListQuery(q)
		if err != nil {
			if err.Code != apierr.ValidationError || len(err.Details) == 0 {
				t.Fatalf("%v", err)
			}
			return
		}
		again, err := httpapi.WardrobeListQuery(canonical)
		if err != nil || again.Encode() != canonical.Encode() {
			t.Fatalf("%v became %v, then %v (%v)", q, canonical, again, err)
		}
	})
}
