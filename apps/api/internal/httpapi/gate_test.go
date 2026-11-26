package httpapi_test

import (
	"encoding/json"
	"os"
	"slices"
	"strings"
	"testing"

	"lookly/internal/contracttest"
	"lookly/internal/httpapi"
)

// The gate's table says who may call each route; the contract says the same
// in its "security" field. They must agree for every route the server
// serves: a route the contract secures can never be public here.
func TestTheGateTableAgreesWithTheContract(t *testing.T) {
	t.Parallel()
	raw, err := os.ReadFile(contracttest.RepoPath("docs/api/openapi.json"))
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Paths map[string]map[string]struct {
			OperationID string                `json:"operationId"`
			Security    []map[string][]string `json:"security"`
		} `json:"paths"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	// What the contract says, for every operation.
	contract := map[string]string{}
	for path, item := range doc.Paths {
		for method, op := range item {
			access := "required"
			switch {
			case len(op.Security) == 0:
				access = "public"
			case slices.ContainsFunc(op.Security, func(s map[string][]string) bool { return len(s) == 0 }):
				access = "optional" // an empty requirement among the alternatives
			}
			contract[strings.ToUpper(method)+" "+path] = access
		}
	}
	// The routes that stay open to a user whose consent is out of date: to
	// see who they are (and that consent is required) and to accept the
	// texts. B3.6 adds deleting the account.
	exempt := []string{"GET /api/v1/auth/me", "POST /api/v1/legal/consent"}

	rules := httpapi.RouteRules()
	for pattern, rule := range rules {
		want, known := contract[pattern]
		if !known {
			t.Errorf("%s is in the gate's table and not in the contract", pattern)
			continue
		}
		if slices.Contains(exempt, pattern) {
			want += " exempt"
		}
		if rule != want {
			t.Errorf("%s: the gate says %q, the contract %q", pattern, rule, want)
		}
	}
	for _, pattern := range exempt {
		if _, listed := rules[pattern]; !listed {
			t.Errorf("%s is exempt from the consent check and missing from the gate's table", pattern)
		}
	}
	// Every route the server serves is in the table, so that what is public
	// is public on purpose (anything else is closed by default).
	served := httpapi.ServedRoutes()
	if len(served) < 6 {
		t.Fatalf("the generated router serves %v", served)
	}
	for _, pattern := range served {
		if _, known := contract[pattern]; !known {
			t.Errorf("the router serves %s, which is not in the contract", pattern)
		}
		if _, listed := rules[pattern]; !listed && contract[pattern] != "required" {
			t.Errorf("%s is %s in the contract and not in the gate's table: it would need a session", pattern, contract[pattern])
		}
	}
	for pattern := range rules {
		if !slices.Contains(served, pattern) {
			t.Errorf("%s is in the gate's table and not served", pattern)
		}
	}
}
