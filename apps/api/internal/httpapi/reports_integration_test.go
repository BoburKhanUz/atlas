//go:build integration

package httpapi_test

import (
	"encoding/json"
	"net/http"
	"os"
	"strconv"
	"strings"
	"testing"

	"lookly/internal/clienterrors"
	"lookly/internal/contracttest"
)

const reportsPath = "/api/v1/client-errors"

func reportBody(n int) map[string]any {
	reports := make([]any, n)
	for i := range reports {
		reports[i] = map[string]any{
			"platform": "android", "appVersion": "0.1.0+1", "kind": "flutter", "errorType": "StateError",
			"message": "Bad state for aziza@example.uz", "route": "/wardrobe/item/cm0abcdefghijklmnop12?x=1", "occurredAt": "2026-11-28T07:00Z",
		}
	}
	return map[string]any{"reports": reports}
}

func clientErrorLines(a *api) []map[string]any {
	var out []map[string]any
	for _, line := range strings.Split(a.logs(), "\n") {
		var l map[string]any
		if json.Unmarshal([]byte(line), &l) == nil && l["msg"] == clienterrors.Message {
			out = append(out, l)
		}
	}
	return out
}

func TestReportsAreLoggedScrubbedAndNeverNeedASession(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{})
	got := a.do(call{path: reportsPath, body: reportBody(2)})
	a.is(got, http.StatusOK, "")
	if got.body["ok"] != true {
		t.Fatalf("%s", got.raw)
	}
	m := a.mobileRegister(nil)
	a.is(a.do(call{path: reportsPath, mobile: true, bearer: m.accessToken, body: reportBody(1)}), http.StatusOK, "")
	lines := clientErrorLines(a)
	if len(lines) != 3 {
		t.Fatalf("%d lines: %s", len(lines), a.logs())
	}
	l := lines[0]
	if l["level"] != "ERROR" || l["platform"] != "android" || l["kind"] != "flutter" || l["fatal"] != false || l["errorType"] != "StateError" ||
		l["message"] != "Bad state for [REDACTED_EMAIL]" || l["route"] != "/wardrobe/item/:id" || l["occurredAt"] != "2026-11-28T07:00:00Z" {
		t.Errorf("line %v", l)
	}
	if strings.Contains(a.logs(), "aziza@example.uz") {
		t.Error("an address reached the log")
	}
	// Nothing is stored.
	if n := query[int](a, `SELECT count(*)::int FROM information_schema.tables WHERE table_name ILIKE '%clienterror%'`); n != 0 {
		t.Errorf("%d tables", n)
	}
	bad := a.do(call{path: reportsPath, body: map[string]any{"reports": []any{}}})
	a.is(bad, http.StatusBadRequest, "VALIDATION_ERROR")
	if len(clientErrorLines(a)) != 3 {
		t.Error("a refused body was logged")
	}
}

func TestReportsAreLimitedPerAddressAndForEveryone(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{trustProxy: true})
	from := func(addr string) call {
		return call{path: reportsPath, body: reportBody(1), headers: map[string]string{"X-Forwarded-For": addr}}
	}
	for range clienterrors.PerAddress.Limit {
		a.is(a.do(from("203.0.113.7")), http.StatusOK, "")
	}
	limited := a.do(from("203.0.113.7"))
	a.is(limited, http.StatusTooManyRequests, "RATE_LIMITED")
	if wait, err := strconv.Atoi(limited.header.Get("Retry-After")); err != nil || wait <= 0 {
		t.Errorf("Retry-After %q", limited.header.Get("Retry-After"))
	}
	// Another address is not this one.
	a.is(a.do(from("203.0.113.8")), http.StatusOK, "")
	if n := len(clientErrorLines(a)); n != clienterrors.PerAddress.Limit+1 {
		t.Errorf("%d lines", n)
	}
	// For everyone: what is left of the shared limit, from many addresses.
	for i := clienterrors.PerAddress.Limit + 1; i < clienterrors.ForAll.Limit; i++ {
		a.is(a.do(from("198.51.100."+strconv.Itoa(i%250))), http.StatusOK, "")
	}
	a.is(a.do(from("192.0.2.1")), http.StatusTooManyRequests, "RATE_LIMITED")
}

func TestTheContractIsServedAsItIs(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{})
	got := a.do(call{method: http.MethodGet, path: "/api/v1/openapi.json"})
	a.is(got, http.StatusOK, "")
	want, err := os.ReadFile(contracttest.RepoPath("docs/api/openapi.json"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got.raw) != string(want) || got.header.Get("Content-Type") != "application/json; charset=utf-8" {
		t.Errorf("served %d bytes (%s), the contract is %d", len(got.raw), got.header.Get("Content-Type"), len(want))
	}
}
