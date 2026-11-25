package contract_test

import (
	"bufio"
	"encoding/json"
	"os"
	"slices"
	"strings"
	"testing"
)

// notYetImplemented lists the contract operations the Go server does not
// serve yet. Each stage moves its operations from here into
// oapi-codegen.yaml together with their handlers; the list is empty at the
// cutover (B7).
var notYetImplemented = []string{
	"acceptLegalDocuments", "analyzeColorProfile", "createWardrobeItem", "deleteAccount",
	"deleteColorProfile", "deleteOutfit", "deleteWardrobeItem", "generateOutfits",
	"getColorProfile", "getConversation", "getCurrentWeather", "getLegalDocuments",
	"getMedia", "getOpenApiDocument", "getOutfit", "getProfile", "getWardrobeItem",
	"listConversations", "listOutfits", "listWardrobeItems", "reportClientErrors",
	"requestPasswordReset", "resetPassword", "saveOutfit", "sendOutfitFeedback",
	"stylistChat", "updateOutfit", "updateProfile", "updateWardrobeItem",
}

func contractOperations(t *testing.T) []string {
	t.Helper()
	raw, err := os.ReadFile("../../../../../docs/api/openapi.json")
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Paths map[string]map[string]struct {
			OperationID string `json:"operationId"`
		} `json:"paths"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	var ids []string
	for _, item := range doc.Paths {
		for method, op := range item {
			switch method {
			case "get", "post", "put", "patch", "delete":
				ids = append(ids, op.OperationID)
			}
		}
	}
	slices.Sort(ids)
	return ids
}

// generatedOperations reads include-operation-ids from oapi-codegen.yaml (a
// plain YAML list in our own file; no YAML library needed).
func generatedOperations(t *testing.T) []string {
	t.Helper()
	f, err := os.Open("oapi-codegen.yaml")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	var ids []string
	inList := false
	s := bufio.NewScanner(f)
	for s.Scan() {
		line := strings.TrimSpace(s.Text())
		switch {
		case line == "include-operation-ids:":
			inList = true
		case inList && strings.HasPrefix(line, "- "):
			ids = append(ids, strings.TrimSpace(strings.TrimPrefix(line, "- ")))
		case inList:
			inList = false
		}
	}
	if err := s.Err(); err != nil {
		t.Fatal(err)
	}
	slices.Sort(ids)
	return ids
}

func TestEveryContractOperationIsGeneratedOrListedAsNotYetImplemented(t *testing.T) {
	generated := generatedOperations(t)
	if len(generated) == 0 {
		t.Fatal("no include-operation-ids in oapi-codegen.yaml")
	}
	pending := slices.Sorted(slices.Values(notYetImplemented))
	all := slices.Sorted(slices.Values(append(slices.Clone(generated), pending...)))
	if !slices.Equal(all, contractOperations(t)) {
		t.Fatalf("generated %v + not yet implemented %v\n  != contract %v", generated, pending, contractOperations(t))
	}
	for _, id := range generated {
		if slices.Contains(pending, id) {
			t.Errorf("%s is generated and also listed as not yet implemented", id)
		}
	}
}
