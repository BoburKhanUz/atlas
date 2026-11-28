package httpapi_test

import (
	"encoding/json"
	"log/slog"
	"reflect"
	"testing"
	"time"

	"lookly/internal/clienterrors"
	"lookly/internal/golden"
	"lookly/internal/httpapi"
	"lookly/internal/httpapi/contract"
)

// A client error report is judged as the Next.js route judges it, and logs
// the fields it logged: scrubbed, then redacted. The device time is written
// in one form (RFC 3339, UTC).
func TestClientErrorReportsAreJudgedAndLoggedAsTheNextJSRouteDoes(t *testing.T) {
	t.Parallel()
	g := golden.LoadClientErrors(t)
	if g.LogMessage != clienterrors.Message {
		t.Fatalf("message %q", g.LogMessage)
	}
	for _, c := range g.Requests {
		canonical, refusal := httpapi.ClientErrorsBody([]byte(c.Body))
		if !c.OK {
			if refusal == nil {
				t.Errorf("%s: accepted %s, want %s %s", c.Name, canonical, c.Code, c.Error)
				continue
			}
			details := make([]map[string]any, len(refusal.Details))
			for i, d := range refusal.Details {
				details[i] = map[string]any{"path": d.Path, "message": d.Message}
			}
			wantDetails := make([]map[string]any, len(c.Details))
			for i, d := range c.Details {
				wantDetails[i] = map[string]any{"path": d.Path, "message": d.Message}
			}
			if refusal.Status() != c.Status || string(refusal.Code) != c.Code || refusal.Message != c.Error || !reflect.DeepEqual(asAny(details), asAny(wantDetails)) {
				t.Errorf("%s: %d %s %q %v\nwant %d %s %q %v", c.Name, refusal.Status(), refusal.Code, refusal.Message, details, c.Status, c.Code, c.Error, wantDetails)
			}
			continue
		}
		if refusal != nil {
			t.Errorf("%s: refused %v", c.Name, refusal)
			continue
		}
		var body contract.ClientErrorsRequest
		if err := json.Unmarshal(canonical, &body); err != nil {
			t.Fatalf("%s: the generated decoder refuses the canonical body %s: %v", c.Name, canonical, err)
		}
		reports := httpapi.ClientReports(body)
		if len(reports) != len(c.Logged) {
			t.Fatalf("%s: %d reports, want %d", c.Name, len(reports), len(c.Logged))
		}
		for i, r := range reports {
			got := map[string]any{}
			for _, a := range clienterrors.Fields(r) {
				if a.Value.Kind() == slog.KindBool {
					got[a.Key] = a.Value.Bool()
				} else {
					got[a.Key] = a.Value.String()
				}
			}
			want := c.Logged[i]
			if at, ok := want["occurredAt"].(string); ok {
				parsed, err := time.Parse(time.RFC3339Nano, at)
				if err != nil {
					parsed, err = time.Parse("2006-01-02T15:04Z", at)
				}
				if err != nil {
					t.Fatalf("%s: %q", c.Name, at)
				}
				want["occurredAt"] = parsed.UTC().Format(time.RFC3339Nano)
			}
			if !reflect.DeepEqual(asAny(got), asAny(want)) {
				t.Errorf("%s, report %d:\n got %v\nwant %v", c.Name, i, got, want)
			}
		}
	}
}

func asAny(v any) any {
	encoded, _ := json.Marshal(v)
	var out any
	_ = json.Unmarshal(encoded, &out)
	return out
}
