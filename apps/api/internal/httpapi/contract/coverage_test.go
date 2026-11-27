package contract_test

import (
	"bufio"
	"encoding/json"
	"maps"
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
	"analyzeColorProfile", "deleteColorProfile", "deleteOutfit", "generateOutfits",
	"getColorProfile", "getConversation", "getOpenApiDocument", "getOutfit",
	"listConversations", "listOutfits", "reportClientErrors",
	"saveOutfit", "sendOutfitFeedback",
	"stylistChat", "updateOutfit",
}

// servedByHand are the operations served without generated code, each with
// its reason.
var servedByHand = map[string]string{
	// Its {key} holds slashes; a generated pattern matches one segment only
	// (internal/httpapi/server_media.go).
	"getMedia": "the storage key in the path contains slashes",
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
	byHand := slices.Sorted(maps.Keys(servedByHand))
	all := slices.Sorted(slices.Values(slices.Concat(generated, pending, byHand)))
	if !slices.Equal(all, contractOperations(t)) {
		t.Fatalf("generated %v + not yet implemented %v + served by hand %v\n  != contract %v", generated, pending, byHand, contractOperations(t))
	}
	for _, id := range generated {
		if slices.Contains(pending, id) || slices.Contains(byHand, id) {
			t.Errorf("%s is generated and also listed as not yet implemented or served by hand", id)
		}
	}
	for _, id := range byHand {
		if slices.Contains(pending, id) {
			t.Errorf("%s is served by hand and also listed as not yet implemented", id)
		}
	}
}
