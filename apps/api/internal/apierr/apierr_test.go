package apierr_test

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"slices"
	"strconv"
	"strings"
	"testing"

	"lookly/internal/apierr"
)

const contractPath = "../../../../docs/api/openapi.json"

// The Uzbek messages the Next.js server sent, frozen when it was removed
// (B7.6): the clients have shown them since, so they change only on purpose.
const recordedMessagesPath = "../../testdata/golden/error-messages.json"

type contract struct {
	Paths      map[string]map[string]json.RawMessage `json:"paths"`
	Components struct {
		Schemas struct {
			ErrorResponse struct {
				Properties struct {
					Code struct {
						Enum []string `json:"enum"`
					} `json:"code"`
				} `json:"properties"`
			} `json:"ErrorResponse"`
		} `json:"schemas"`
	} `json:"components"`
}

func loadContract(t *testing.T) contract {
	t.Helper()
	raw, err := os.ReadFile(contractPath)
	if err != nil {
		t.Fatal(err)
	}
	var c contract
	if err := json.Unmarshal(raw, &c); err != nil {
		t.Fatal(err)
	}
	return c
}

func TestTheCodesAreExactlyTheContractCodes(t *testing.T) {
	t.Parallel()
	want := slices.Clone(loadContract(t).Components.Schemas.ErrorResponse.Properties.Code.Enum)
	slices.Sort(want)
	var got []string
	for _, c := range apierr.Codes() {
		got = append(got, string(c))
	}
	slices.Sort(got)
	if len(want) == 0 || !slices.Equal(got, want) {
		t.Fatalf("codes\n got %v\nwant %v", got, want)
	}
}

// Each code's status is the one the contract documents it under
// (x-error-codes on every operation's responses).
func TestEachCodeHasTheStatusTheContractDocuments(t *testing.T) {
	t.Parallel()
	c := loadContract(t)
	seen := map[string]map[int]bool{}
	for _, item := range c.Paths {
		for _, rawOp := range item {
			var op struct {
				Responses map[string]struct {
					Codes []string `json:"x-error-codes"`
				} `json:"responses"`
			}
			if json.Unmarshal(rawOp, &op) != nil {
				continue // path-level fields such as parameters
			}
			for status, r := range op.Responses {
				n, err := strconv.Atoi(status)
				if err != nil {
					t.Fatalf("status %q", status)
				}
				for _, code := range r.Codes {
					if seen[code] == nil {
						seen[code] = map[int]bool{}
					}
					seen[code][n] = true
				}
			}
		}
	}
	for _, code := range apierr.Codes() {
		statuses := seen[string(code)]
		if len(statuses) == 0 {
			t.Errorf("%s: not documented under any response", code)
			continue
		}
		for status := range statuses {
			if status != code.Status() {
				t.Errorf("%s: status %d, the contract documents %d", code, code.Status(), status)
			}
		}
	}
}

// The Uzbek messages are the ones the Next.js server sent (recorded from its
// table at e57764f), one for every code.
func TestMessagesMatchTheRecordedOnes(t *testing.T) {
	t.Parallel()
	raw, err := os.ReadFile(recordedMessagesPath)
	if err != nil {
		t.Fatal(err)
	}
	var recorded struct {
		Messages map[string]string `json:"messages"`
	}
	if err := json.Unmarshal(raw, &recorded); err != nil {
		t.Fatal(err)
	}
	if len(recorded.Messages) != len(apierr.Codes()) {
		t.Fatalf("the record has %d messages, Go has %d codes", len(recorded.Messages), len(apierr.Codes()))
	}
	for _, code := range apierr.Codes() {
		want, ok := recorded.Messages[string(code)]
		if !ok {
			t.Errorf("%s: no recorded message", code)
			continue
		}
		if got := code.Message(); got != want {
			t.Errorf("%s:\n got %q\nwant %q", code, got, want)
		}
	}
}

func TestErrors(t *testing.T) {
	t.Parallel()
	e := apierr.New(apierr.NotFound)
	if e.Message != apierr.NotFound.Message() || e.Status() != 404 {
		t.Fatalf("New: %+v", e)
	}
	v := apierr.Validation("Ism juda uzun", apierr.Detail{Path: "name", Message: "Ism juda uzun"})
	if v.Code != apierr.ValidationError || v.Message != "Ism juda uzun" || len(v.Details) != 1 || v.Status() != 400 {
		t.Fatalf("Validation: %+v", v)
	}
	wrapped := fmt.Errorf("load item: %w", e)
	var got *apierr.Error
	if !errors.As(wrapped, &got) || got.Code != apierr.NotFound {
		t.Fatal("errors.As does not find the code through wrapping")
	}
	if !strings.Contains(e.Error(), "NOT_FOUND") {
		t.Errorf("Error() = %q", e.Error())
	}
}
