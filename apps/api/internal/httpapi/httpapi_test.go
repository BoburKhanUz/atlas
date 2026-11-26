package httpapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	"lookly/internal/apierr"
	"lookly/internal/contracttest"
	"lookly/internal/httpapi"
	"lookly/internal/httpapi/contract"
)

// fakeServer answers GetHealth with whatever the test needs. The other
// operations are not what these tests are about: the embedded interface is
// nil, so calling one of them fails the test loudly.
type fakeServer struct {
	contract.StrictServerInterface
	health func(ctx context.Context) (contract.GetHealthResponseObject, error)
}

func (f fakeServer) GetHealth(ctx context.Context, _ contract.GetHealthRequestObject) (contract.GetHealthResponseObject, error) {
	return f.health(ctx)
}

func ok(context.Context) (contract.GetHealthResponseObject, error) {
	return contract.GetHealth200JSONResponse{Status: "ok", Database: "ok", Version: "test"}, nil
}

type logs struct{ bytes.Buffer }

func (l *logs) lines(t *testing.T) []map[string]any {
	t.Helper()
	var out []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(l.String()), "\n") {
		if line == "" {
			continue
		}
		var m map[string]any
		if err := json.Unmarshal([]byte(line), &m); err != nil {
			t.Fatalf("log line is not JSON: %q", line)
		}
		out = append(out, m)
	}
	return out
}

func newHandler(t *testing.T, s contract.StrictServerInterface) (http.Handler, *logs) {
	t.Helper()
	l := &logs{}
	return httpapi.New(s, slog.New(slog.NewJSONHandler(l, nil)), &httpapi.Gate{}), l
}

func do(h http.Handler, method, target string, body io.Reader, header http.Header) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, target, body)
	for k, v := range header {
		r.Header[k] = v
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

type envelope struct {
	Error     string `json:"error"`
	Code      string `json:"code"`
	RequestID string `json:"requestId"`
	Details   []struct {
		Path    string `json:"path"`
		Message string `json:"message"`
	} `json:"details"`
}

func decodeEnvelope(t *testing.T, w *httptest.ResponseRecorder) envelope {
	t.Helper()
	contracttest.Schema(t, "ErrorResponse", w.Body.Bytes())
	var e envelope
	if err := json.Unmarshal(w.Body.Bytes(), &e); err != nil {
		t.Fatalf("envelope: %v: %s", err, w.Body)
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("content type %q", ct)
	}
	if e.RequestID == "" || e.RequestID != w.Header().Get("X-Request-Id") {
		t.Errorf("requestId %q, header %q", e.RequestID, w.Header().Get("X-Request-Id"))
	}
	return e
}

var generatedID = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

func TestRequestID(t *testing.T) {
	t.Parallel()
	h, _ := newHandler(t, fakeServer{health: ok})
	cases := []struct {
		name, sent string
		echoed     bool
	}{
		{"well-formed is echoed", "client-req-0001", true},
		{"64 characters is echoed", strings.Repeat("a", 64), true},
		{"missing is generated", "", false},
		{"too short is replaced", "abc1234", false},
		{"too long is replaced", strings.Repeat("a", 65), false},
		{"other characters are replaced", "id with spaces!", false},
		{"header injection is replaced", "abcdefgh\r\nSet-Cookie: x=1", false},
	}
	t.Run("several ids are replaced (as the Next.js API, which joins them)", func(t *testing.T) {
		t.Parallel()
		w := do(h, http.MethodGet, "/api/health", nil, http.Header{"X-Request-Id": {"client-req-0001", "client-req-0002"}})
		if got := w.Header().Get("X-Request-Id"); !generatedID.MatchString(got) {
			t.Errorf("got %q", got)
		}
	})
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			header := http.Header{}
			if tc.sent != "" {
				header["X-Request-Id"] = []string{tc.sent}
			}
			for _, target := range []string{"/api/health", "/api/nowhere"} {
				w := do(h, http.MethodGet, target, nil, header)
				got := w.Header().Get("X-Request-Id")
				if tc.echoed && got != tc.sent {
					t.Errorf("%s: echoed %q, sent %q", target, got, tc.sent)
				}
				if !tc.echoed && !generatedID.MatchString(got) {
					t.Errorf("%s: generated %q", target, got)
				}
			}
		})
	}
}

func TestUnknownRouteOrMethodIsNotFound(t *testing.T) {
	t.Parallel()
	h, _ := newHandler(t, fakeServer{health: ok})
	for _, tc := range []struct{ method, target string }{
		{http.MethodGet, "/api/v1/nowhere"},
		{http.MethodGet, "/"},
		{http.MethodPost, "/api/health"},
		{http.MethodDelete, "/api/health"},
		{http.MethodGet, "/api/health/extra"},
	} {
		w := do(h, tc.method, tc.target, nil, nil)
		if w.Code != http.StatusNotFound {
			t.Errorf("%s %s: status %d", tc.method, tc.target, w.Code)
			continue
		}
		if e := decodeEnvelope(t, w); e.Code != "NOT_FOUND" || e.Error != apierr.NotFound.Message() {
			t.Errorf("%s %s: %+v", tc.method, tc.target, e)
		}
	}
}

func TestErrorsFromAServiceUseTheEnvelope(t *testing.T) {
	t.Parallel()
	h, l := newHandler(t, fakeServer{health: func(context.Context) (contract.GetHealthResponseObject, error) {
		return nil, apierr.New(apierr.ConsentRequired)
	}})
	w := do(h, http.MethodGet, "/api/health", nil, nil)
	e := decodeEnvelope(t, w)
	if w.Code != http.StatusForbidden || e.Code != "CONSENT_REQUIRED" || e.Error != apierr.ConsentRequired.Message() {
		t.Fatalf("%d %+v", w.Code, e)
	}
	for _, line := range l.lines(t) {
		if line["level"] == "ERROR" {
			t.Errorf("a 4xx contract error is not logged as an error: %v", line)
		}
	}
}

func TestValidationDetailsAreSent(t *testing.T) {
	t.Parallel()
	h, _ := newHandler(t, fakeServer{health: func(context.Context) (contract.GetHealthResponseObject, error) {
		return nil, apierr.Validation("Ism juda uzun", apierr.Detail{Path: "name", Message: "Ism juda uzun"})
	}})
	w := do(h, http.MethodGet, "/api/health", nil, nil)
	e := decodeEnvelope(t, w)
	if w.Code != 400 || e.Code != "VALIDATION_ERROR" || len(e.Details) != 1 || e.Details[0].Path != "name" {
		t.Fatalf("%d %+v", w.Code, e)
	}
}

func TestAnUnexpectedErrorIsAnInternalErrorWithoutItsText(t *testing.T) {
	t.Parallel()
	h, l := newHandler(t, fakeServer{health: func(context.Context) (contract.GetHealthResponseObject, error) {
		return nil, errors.New("pq: password authentication failed for user secret-user")
	}})
	w := do(h, http.MethodGet, "/api/health", nil, nil)
	e := decodeEnvelope(t, w)
	if w.Code != 500 || e.Code != "INTERNAL" || e.Error != apierr.Internal.Message() {
		t.Fatalf("%d %+v", w.Code, e)
	}
	if strings.Contains(w.Body.String(), "secret-user") {
		t.Error("the response leaks the cause")
	}
	logged := false
	for _, line := range l.lines(t) {
		if line["level"] == "ERROR" && line["requestId"] == e.RequestID && strings.Contains(line["err"].(string), "password authentication") {
			logged = true
		}
	}
	if !logged {
		t.Errorf("the cause is not logged with the request id: %s", l.String())
	}
}

func TestAPanicIsAnInternalErrorAndIsLogged(t *testing.T) {
	t.Parallel()
	h, l := newHandler(t, fakeServer{health: func(context.Context) (contract.GetHealthResponseObject, error) {
		panic("boom: token=abc")
	}})
	w := do(h, http.MethodGet, "/api/health", nil, nil)
	e := decodeEnvelope(t, w)
	if w.Code != 500 || e.Code != "INTERNAL" {
		t.Fatalf("%d %+v", w.Code, e)
	}
	found := false
	for _, line := range l.lines(t) {
		if line["msg"] == "panic" && line["requestId"] == e.RequestID {
			found = true
			if strings.Contains(l.String(), "token=abc") {
				t.Error("the panic value is logged (it may hold data); only its type and the stack are")
			}
		}
	}
	if !found {
		t.Errorf("panic not logged: %s", l.String())
	}
}

func TestAccessLog(t *testing.T) {
	t.Parallel()
	h, l := newHandler(t, fakeServer{health: ok})
	do(h, http.MethodGet, "/api/health?token=secret-query", strings.NewReader(`{"password":"secret-body"}`), http.Header{
		"X-Request-Id":  {"client-req-0002"},
		"Authorization": {"Bearer secret-header"},
	})
	do(h, http.MethodGet, "/api/v1/media/users/u1/secret-key.webp", nil, nil)
	lines := l.lines(t)
	var access []map[string]any
	for _, line := range lines {
		if line["msg"] == "request" {
			access = append(access, line)
		}
	}
	if len(access) != 2 {
		t.Fatalf("access lines: %v", lines)
	}
	first := access[0]
	if first["requestId"] != "client-req-0002" || first["method"] != "GET" || first["route"] != "GET /api/health" ||
		first["status"] != float64(200) {
		t.Errorf("access line: %v", first)
	}
	if _, ok := first["durationMs"].(float64); !ok {
		t.Errorf("no duration: %v", first)
	}
	if access[1]["route"] != "unmatched" || access[1]["status"] != float64(404) {
		t.Errorf("unmatched route line: %v", access[1])
	}
	for _, secret := range []string{"secret-query", "secret-header", "secret-key", "secret-body"} {
		if strings.Contains(l.String(), secret) {
			t.Errorf("the log contains %q: %s", secret, l.String())
		}
	}
}

func TestBodyLimit(t *testing.T) {
	t.Parallel()
	var read error
	echo := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, read = io.ReadAll(r.Body)
		if read != nil {
			httpapi.WriteError(w, r, read)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	l := &logs{}
	h := httpapi.Wrap(echo, slog.New(slog.NewJSONHandler(l, nil)))

	w := do(h, http.MethodPost, "/", strings.NewReader(strings.Repeat("a", httpapi.DefaultBodyLimit)), nil)
	if w.Code != http.StatusNoContent {
		t.Fatalf("a body of exactly the limit: %d %s", w.Code, w.Body)
	}
	// Over the limit, also when no Content-Length announces it (chunked).
	r := httptest.NewRequest(http.MethodPost, "/", io.MultiReader(strings.NewReader(strings.Repeat("a", httpapi.DefaultBodyLimit)), strings.NewReader("a")))
	r.ContentLength = -1
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("over the limit: %d %s", w.Code, w.Body)
	}
	if e := decodeEnvelope(t, w); e.Code != "PAYLOAD_TOO_LARGE" {
		t.Fatalf("%+v", e)
	}
}

func TestRequestDecodeErrors(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name   string
		err    error
		status int
		code   string
		path   string
	}{
		{"malformed JSON", &json.SyntaxError{Offset: 3}, 400, "BAD_REQUEST", ""},
		// The Next.js API validates parsed JSON with zod: a wrong type and an
		// empty body (read as {}) are validation errors there.
		{"wrong JSON type", fmt.Errorf("can't decode JSON body: %w", &json.UnmarshalTypeError{Value: "number", Field: "email"}), 400, "VALIDATION_ERROR", "email"},
		{"empty body", fmt.Errorf("can't decode JSON body: %w", io.EOF), 400, "VALIDATION_ERROR", ""},
		{"body over the limit", &http.MaxBytesError{Limit: 10}, 413, "PAYLOAD_TOO_LARGE", ""},
		{"bad parameter", &contract.InvalidParamFormatError{ParamName: "limit", Err: errors.New("x")}, 400, "VALIDATION_ERROR", "limit"},
		{"missing parameter", &contract.RequiredParamError{ParamName: "exp"}, 400, "VALIDATION_ERROR", "exp"},
		{"missing header", &contract.RequiredHeaderError{ParamName: "Idempotency-Key"}, 400, "VALIDATION_ERROR", "Idempotency-Key"},
		{"anything else", errors.New("decoder internals: field x"), 400, "BAD_REQUEST", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			l := &logs{}
			h := httpapi.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				httpapi.RequestError(w, r, tc.err)
			}), slog.New(slog.NewJSONHandler(l, nil)))
			w := do(h, http.MethodPost, "/", nil, nil)
			e := decodeEnvelope(t, w)
			if w.Code != tc.status || e.Code != tc.code {
				t.Fatalf("%d %+v", w.Code, e)
			}
			if tc.path != "" && (len(e.Details) != 1 || e.Details[0].Path != tc.path) {
				t.Errorf("details %+v", e.Details)
			}
			if strings.Contains(w.Body.String(), "internals") {
				t.Error("the decoder's text reaches the client")
			}
		})
	}
}

// partial writes the start of a 200 and then fails, as when the client goes
// away mid-response.
type partial struct{}

func (partial) VisitGetHealthResponse(w http.ResponseWriter) error {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"ok"`))
	return errors.New("write tcp: broken pipe")
}

func TestAFailureAfterTheResponseStartedAddsNothingToIt(t *testing.T) {
	t.Parallel()
	h, l := newHandler(t, fakeServer{health: func(context.Context) (contract.GetHealthResponseObject, error) {
		return partial{}, nil
	}})
	w := do(h, http.MethodGet, "/api/health", nil, nil)
	if w.Code != http.StatusOK || w.Body.String() != `{"status":"ok"` {
		t.Fatalf("%d %q: an error envelope was appended to a started response", w.Code, w.Body.String())
	}
	for _, line := range l.lines(t) {
		if line["level"] == "ERROR" {
			t.Errorf("a broken connection is not an internal error: %v", line)
		}
	}
	if !strings.Contains(l.String(), "response not completed") {
		t.Errorf("not logged: %s", l.String())
	}
}

func TestAnAbortedRequestIsStillLogged(t *testing.T) {
	t.Parallel()
	h, l := newHandler(t, fakeServer{health: func(context.Context) (contract.GetHealthResponseObject, error) {
		panic(http.ErrAbortHandler)
	}})
	func() {
		defer func() {
			if v := recover(); v != http.ErrAbortHandler {
				t.Errorf("recovered %v, want http.ErrAbortHandler passed on to net/http", v)
			}
		}()
		do(h, http.MethodGet, "/api/health", nil, nil)
	}()
	if !strings.Contains(l.String(), `"msg":"request"`) {
		t.Errorf("no access line: %s", l.String())
	}
}

// Over the limit, net/http must learn about it, so the connection is closed
// instead of drained for reuse (only a real server shows this).
func TestAnOversizedBodyClosesTheConnection(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(httpapi.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := io.ReadAll(r.Body); err != nil {
			httpapi.WriteError(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}), slog.New(slog.NewJSONHandler(io.Discard, nil))))
	defer srv.Close()
	resp, err := http.Post(srv.URL, "application/json", strings.NewReader(strings.Repeat("a", httpapi.DefaultBodyLimit+1)))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusRequestEntityTooLarge || !resp.Close {
		t.Fatalf("status %d, Connection: close %v", resp.StatusCode, resp.Close)
	}
}

// A request is given a bounded time: its context ends, so a handler waiting
// on the database (a full pool, a stalled query) is released instead of
// holding its goroutine until the client gives up.
func TestARequestsContextEndsAfterTheRequestTimeout(t *testing.T) {
	t.Parallel()
	if httpapi.RequestTimeout != 30*time.Second {
		t.Fatalf("request timeout %s", httpapi.RequestTimeout)
	}
	l := &logs{}
	var waited error
	h := httpapi.WrapWithTimeout(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
			waited = r.Context().Err()
			httpapi.WriteError(w, r, waited)
		case <-time.After(5 * time.Second):
			w.WriteHeader(http.StatusNoContent)
		}
	}), slog.New(slog.NewJSONHandler(l, nil)), 50*time.Millisecond)
	w := do(h, http.MethodGet, "/api/health", nil, nil)
	if !errors.Is(waited, context.DeadlineExceeded) {
		t.Fatalf("the handler's context ended with %v", waited)
	}
	if e := decodeEnvelope(t, w); w.Code != http.StatusInternalServerError || e.Code != "INTERNAL" {
		t.Errorf("answer %d %s", w.Code, e.Code)
	}
	// A request that finishes in time is not cut.
	quick := httpapi.WrapWithTimeout(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.Context().Err(); err != nil {
			t.Errorf("context already ended: %v", err)
		}
		w.WriteHeader(http.StatusNoContent)
	}), slog.New(slog.NewJSONHandler(l, nil)), time.Minute)
	if w := do(quick, http.MethodGet, "/api/health", nil, nil); w.Code != http.StatusNoContent {
		t.Errorf("status %d", w.Code)
	}
}
