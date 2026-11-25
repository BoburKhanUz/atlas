package contracttest

import "testing"

// The validator must reject what the contract forbids, including 3.1
// keywords (const, oneOf by const) and the lookahead email pattern.
func TestTheValidatorEnforcesTheContract(t *testing.T) {
	t.Parallel()
	cases := []struct {
		schema, body string
		ok           bool
	}{
		{"ErrorResponse", `{"error":"x","code":"NOT_FOUND","requestId":"r"}`, true},
		{"ErrorResponse", `{"error":"x","code":"NOPE"}`, false},
		{"ErrorResponse", `{"error":"x","code":"NOT_FOUND","extra":1}`, false},
		{"ErrorResponse", `{"code":"NOT_FOUND"}`, false},
		{"HealthResponse", `{"status":"ok","database":"ok","version":"1"}`, true},
		{"HealthResponse", `{"status":"fine","database":"ok","version":"1"}`, false},
		{"ImageObject", `{"id":"i","url":"u","thumbnailUrl":null,"urlExpiresAt":"2026-01-01T00:00:00Z","isPrimary":true,"width":null,"height":null}`, true},
		{"ImageObject", `{"id":"i","url":"u","thumbnailUrl":5,"urlExpiresAt":"2026-01-01T00:00:00Z","isPrimary":true,"width":null,"height":null}`, false},
		{"ColorProfileResponse", `{"status":"not_analyzed","colorProfile":null,"message":"m"}`, true},
		{"ColorProfileResponse", `{"status":"bogus","colorProfile":null,"message":"m"}`, false},
		{"OkResponse", `{"ok":true}`, true},
		{"OkResponse", `{"ok":false}`, false},
		{"LoginRequest", `{"email":"a@b.uz","password":"x"}`, true},
		{"LoginRequest", `{"email":".a@b.uz","password":"x"}`, false},
		{"LoginRequest", `{"email":"a..b@b.uz","password":"x"}`, false},
	}
	for _, c := range cases {
		schema := Document(t).Components.Schemas[c.schema].Value
		if err := visit(schema, []byte(c.body)); (err == nil) != c.ok {
			t.Errorf("%s %s: want ok=%v, got err=%v", c.schema, c.body, c.ok, err)
		}
	}
}
