// Package contracttest validates HTTP responses against the API contract
// (docs/api/openapi.json) in tests. It uses kin-openapi's JSON Schema 2020-12
// validator (the 3.0 one ignores `const`) and an ECMAScript regex engine,
// because Go's regexp cannot run the contract's email pattern (ADR 0008).
// Only test files import it, so it is not linked into the server binary.
package contracttest

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/dlclark/regexp2"
	"github.com/getkin/kin-openapi/openapi3"
)

var (
	once    sync.Once
	doc     *openapi3.T
	loadErr error
)

// Document loads the contract once per test binary.
func Document(t testing.TB) *openapi3.T {
	t.Helper()
	once.Do(func() {
		path := RepoPath("docs/api/openapi.json")
		loader := openapi3.NewLoader()
		doc, loadErr = loader.LoadFromFile(path)
		if loadErr == nil {
			loadErr = doc.Validate(context.Background(), openapi3.DisableSchemaPatternValidation())
		}
	})
	if loadErr != nil {
		t.Fatalf("load contract: %v", loadErr)
	}
	return doc
}

type ecmaMatcher struct{ re *regexp2.Regexp }

func (m ecmaMatcher) MatchString(s string) bool {
	ok, err := m.re.MatchString(s)
	return err == nil && ok
}

func compileECMA(expr string) (openapi3.RegexMatcher, error) {
	re, err := regexp2.Compile(expr, regexp2.ECMAScript)
	if err != nil {
		return nil, err
	}
	return ecmaMatcher{re}, nil
}

func visit(schema *openapi3.Schema, body []byte) error {
	var v any
	if err := json.Unmarshal(body, &v); err != nil {
		return fmt.Errorf("body is not JSON: %w", err)
	}
	return schema.VisitJSON(v, openapi3.EnableJSONSchema2020(), openapi3.SetSchemaRegexCompiler(compileECMA))
}

// Schema checks body against a component schema, e.g. "ErrorResponse".
func Schema(t testing.TB, name string, body []byte) {
	t.Helper()
	ref, ok := Document(t).Components.Schemas[name]
	if !ok {
		t.Fatalf("no schema %q in the contract", name)
	}
	if err := visit(ref.Value, body); err != nil {
		t.Errorf("body does not match %s: %v\nbody: %s", name, err, body)
	}
}

// Response checks a response of the operation at method and path (the
// contract's path template, e.g. "/api/health"): the status must be
// documented, the content type must match and the body must match the schema.
func Response(t testing.TB, method, path string, status int, header http.Header, body []byte) {
	t.Helper()
	item := Document(t).Paths.Find(path)
	if item == nil {
		t.Fatalf("no path %s in the contract", path)
	}
	op := item.GetOperation(strings.ToUpper(method))
	if op == nil {
		t.Fatalf("no %s %s in the contract", method, path)
	}
	resp := op.Responses.Status(status)
	if resp == nil || resp.Value == nil {
		t.Fatalf("%s %s: status %d is not documented", method, path, status)
	}
	mediaType := strings.TrimSpace(strings.Split(header.Get("Content-Type"), ";")[0])
	media := resp.Value.Content.Get(mediaType)
	if media == nil || media.Schema == nil {
		t.Fatalf("%s %s %d: content type %q is not documented", method, path, status, mediaType)
	}
	if err := visit(media.Schema.Value, body); err != nil {
		t.Errorf("%s %s %s: body does not match the contract: %v\nbody: %s",
			method, path, strconv.Itoa(status), err, body)
	}
}

// RepoPath resolves a path relative to the repository root.
func RepoPath(rel string) string {
	_, file, _, _ := runtime.Caller(0)
	return filepath.Join(filepath.Dir(file), "../../../..", rel)
}
