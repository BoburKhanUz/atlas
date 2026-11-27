package ai_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"lookly/internal/ai"
	"lookly/internal/config"
	"lookly/internal/golden"
)

const fakeKey = "fake-provider-key"

// standIn is a provider's API in the test: it answers every request as
// told and remembers what it was sent.
type standIn struct {
	mu      sync.Mutex
	server  *httptest.Server
	status  int
	body    string
	headers map[string]string
	asked   []asked
}

type asked struct {
	method, path string
	header       http.Header
	body         string
}

func newStandIn(t *testing.T) *standIn {
	t.Helper()
	s := &standIn{status: http.StatusOK, body: "{}"}
	s.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		s.mu.Lock()
		s.asked = append(s.asked, asked{r.Method, r.URL.EscapedPath(), r.Header.Clone(), string(body)})
		status, reply, headers := s.status, s.body, s.headers
		s.mu.Unlock()
		for name, value := range headers {
			w.Header().Set(name, value)
		}
		w.WriteHeader(status)
		if status != http.StatusNoContent {
			_, _ = io.WriteString(w, reply)
		}
	}))
	t.Cleanup(s.server.Close)
	return s
}

func (s *standIn) reply(status int, body string, headers map[string]string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.status, s.body, s.headers, s.asked = status, body, headers, nil
}

func (s *standIn) questions() []asked {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]asked(nil), s.asked...)
}

type provider interface {
	ai.TextProvider
	AnalyzeImage(ctx context.Context, request ai.VisionRequest) (ai.VisionResult, error)
}

func (s *standIn) provider(t *testing.T, name, model string) provider {
	t.Helper()
	var p provider
	var err error
	switch name {
	case "gemini":
		p, err = ai.NewGemini(fakeKey, model, s.server.URL)
	case "openai":
		p, err = ai.NewOpenAI(fakeKey, model, s.server.URL)
	case "mock":
		return ai.Mock{}
	default:
		t.Fatalf("no provider %q", name)
	}
	if err != nil {
		t.Fatal(err)
	}
	return p
}

var bases = map[string]string{"gemini": ai.GeminiURL, "openai": ai.OpenAIURL}

// sameSent compares what the stand-in was sent with what the Next.js
// adapter sent: the path, the headers it set, the body byte for byte.
func sameSent(t *testing.T, name, providerName string, want *golden.AISent, got []asked) {
	t.Helper()
	if want == nil {
		if len(got) != 0 {
			t.Errorf("%s: a request was sent that the Next.js adapter refuses before sending", name)
		}
		return
	}
	if len(got) != 1 {
		t.Errorf("%s: %d requests sent, want one", name, len(got))
		return
	}
	sent := got[0]
	if path := strings.TrimPrefix(want.URL, bases[providerName]); sent.method != http.MethodPost || sent.path != path || path == want.URL {
		t.Errorf("%s: sent %s %s, want POST %s", name, sent.method, sent.path, path)
	}
	for header, value := range want.Headers {
		if have := sent.header.Get(header); have != strings.Replace(value, "<key>", fakeKey, 1) {
			t.Errorf("%s: header %s is %q, want %q", name, header, strings.ReplaceAll(have, fakeKey, "<key>"), value)
		}
	}
	if strings.HasPrefix(want.Body, "<") && strings.HasSuffix(want.Body, " characters>") {
		if want.Body != fmt.Sprintf("<%d characters>", len(sent.body)) {
			t.Errorf("%s: a body of %d characters, want %s", name, len(sent.body), want.Body)
		}
	} else if sent.body != want.Body {
		t.Errorf("%s: body\n got %s\nwant %s", name, sent.body, want.Body)
	}
}

// sameFailure compares an error with the Next.js adapter's.
func sameFailure(t *testing.T, name string, want golden.AIOutcome, err error) {
	t.Helper()
	var failure *ai.Error
	if !errors.As(err, &failure) {
		t.Errorf("%s: got %v, want a provider error of kind %s", name, err, want.Kind)
		return
	}
	if want.Thrown != "" {
		// The Next.js adapter fell over; here the answer is malformed.
		if failure.Kind != ai.MalformedResponse {
			t.Errorf("%s: kind %s, want malformed_response", name, failure.Kind)
		}
		return
	}
	status := 0
	if want.Status != nil {
		status = *want.Status
	}
	var wait *float64
	if failure.RetryAfter != nil {
		ms := float64(*failure.RetryAfter) / float64(time.Millisecond)
		wait = &ms
	}
	if string(failure.Kind) != want.Kind || failure.Status != status || !reflect.DeepEqual(wait, want.RetryAfterMs) || failure.Error() != want.Message {
		t.Errorf("%s: got %q (kind %s, status %d, wait %v), want %q (kind %s, status %d, wait %v)",
			name, failure.Error(), failure.Kind, failure.Status, wait, want.Message, want.Kind, status, want.RetryAfterMs)
	}
}

func sameMetadata(t *testing.T, name string, want golden.AIOutcome, got ai.Metadata) {
	t.Helper()
	m := want.Metadata
	if m == nil {
		return
	}
	if got.Provider != m.Provider || got.Model != m.Model || !reflect.DeepEqual(got.Usage, ai.Usage{InputTokens: m.Usage.InputTokens, OutputTokens: m.Usage.OutputTokens, TotalTokens: m.Usage.TotalTokens}) {
		gotJSON, _ := json.Marshal(got)
		wantJSON, _ := json.Marshal(m)
		t.Errorf("%s: metadata %s, want %s", name, gotJSON, wantJSON)
	}
}

// sameJSON says whether two JSON texts are the same value.
func sameJSON(a, b string) bool {
	var x, y any
	return json.Unmarshal([]byte(a), &x) == nil && json.Unmarshal([]byte(b), &y) == nil && reflect.DeepEqual(x, y)
}

func schemaOf(s *golden.AISchema) *ai.Schema {
	if s == nil {
		return nil
	}
	return &ai.Schema{Name: s.Name, Schema: s.Schema}
}

func TestTextRequestsAreSentAndReadAsTheNextJSAdaptersDo(t *testing.T) {
	t.Parallel()
	server := newStandIn(t)
	for _, c := range golden.LoadAIProviders(t).Text {
		server.reply(http.StatusOK, c.Reply, nil)
		request := ai.TextRequest{Temperature: c.Request.Temperature, MaxOutputTokens: c.Request.MaxOutputTokens, JSONSchema: schemaOf(c.Request.JSONSchema), Timeout: 5 * time.Second}
		for _, m := range c.Request.Messages {
			request.Messages = append(request.Messages, ai.Message{Role: m.Role, Content: m.Content})
		}
		got, err := server.provider(t, c.Provider, c.Model).Generate(context.Background(), request)
		sameSent(t, c.Name, c.Provider, c.Sent, server.questions())
		switch {
		case !c.Outcome.OK:
			sameFailure(t, c.Name, c.Outcome, err)
		case err != nil:
			t.Errorf("%s: %v", c.Name, err)
		default:
			if got.Text != c.Outcome.Text {
				t.Errorf("%s: text %q, want %q", c.Name, got.Text, c.Outcome.Text)
			}
			sameMetadata(t, c.Name, c.Outcome, got.Metadata)
		}
	}
	if ai.DefaultAddresses != (ai.Addresses{Gemini: ai.GeminiURL, OpenAI: ai.OpenAIURL}) {
		t.Error("the default addresses are not the providers' own")
	}
}

func TestVisionRequestsAreSentAndReadAsTheNextJSAdaptersDo(t *testing.T) {
	t.Parallel()
	server := newStandIn(t)
	for _, c := range golden.LoadAIProviders(t).Vision {
		if c.Request.MaxSide != float64(int(c.Request.MaxSide)) {
			continue // a side with a fraction: not a value a Go request can hold
		}
		image := make([]byte, c.ImageLength)
		for i, b := range c.ImageBytes {
			image[i] = byte(b)
		}
		request := ai.VisionRequest{
			Image: image, MimeType: c.Request.MimeType, MaxSide: int(c.Request.MaxSide), Instruction: c.Request.Instruction,
			JSONSchema: schemaOf(c.Request.JSONSchema), MaxOutputTokens: c.Request.MaxOutputTokens, Timeout: 5 * time.Second,
		}
		if o := c.Request.Options; o != nil {
			request.Options = ai.VisionOptions{GeminiMediaResolution: o.GeminiMediaResolution, GeminiThinkingLevel: o.GeminiThinkingLevel, OpenAIDetail: o.OpenAIDetail}
		}
		reply := "{}"
		if c.Reply != nil {
			reply = *c.Reply
		}
		server.reply(http.StatusOK, reply, nil)
		model := map[string]string{"gemini": "gemini-vision-test", "openai": "gpt-vision-test", "mock": "mock"}[c.Provider]
		got, err := server.provider(t, c.Provider, model).AnalyzeImage(context.Background(), request)
		sameSent(t, c.Name, c.Provider, c.Sent, server.questions())
		switch {
		case !c.Outcome.OK:
			sameFailure(t, c.Name, c.Outcome, err)
		case err != nil:
			t.Errorf("%s: %v", c.Name, err)
		default:
			if !sameJSON(string(got.Output), string(c.Outcome.Output)) {
				t.Errorf("%s: output %s, want %s", c.Name, got.Output, c.Outcome.Output)
			}
			sameMetadata(t, c.Name, c.Outcome, got.Metadata)
		}
	}
}

func TestAnAnswerIsReadAsTheNextJSAdaptersReadIt(t *testing.T) {
	t.Parallel()
	g := golden.LoadAIProviders(t)
	server := newStandIn(t)
	models := map[string]string{"gemini": "gemini-flash-test", "openai": "gpt-4.1-mini-test"}
	question := ai.TextRequest{Messages: []ai.Message{{Role: "user", Content: "Q"}}, Timeout: 5 * time.Second}
	for _, c := range g.Made {
		server.reply(c.Status, c.Body, c.Headers)
		got, err := server.provider(t, c.Provider, models[c.Provider]).Generate(context.Background(), question)
		switch {
		case !c.Outcome.OK:
			sameFailure(t, c.Name, c.Outcome, err)
			// Whatever the provider answered, none of it is in the error.
			if err != nil && (strings.Contains(err.Error(), "secret prompt") || strings.Contains(err.Error(), fakeKey)) {
				t.Errorf("%s: the error repeats the answer or the key: %v", c.Name, err)
			}
		case err != nil:
			t.Errorf("%s: %v", c.Name, err)
		default:
			if got.Text != c.Outcome.Text {
				t.Errorf("%s: text %q, want %q", c.Name, got.Text, c.Outcome.Text)
			}
			sameMetadata(t, c.Name, c.Outcome, got.Metadata)
		}
	}

	// With a schema the model's text must be JSON, and is returned as JSON.
	structured := question
	structured.JSONSchema = &ai.Schema{Name: "s", Schema: json.RawMessage(`{"type":"object"}`)}
	for _, c := range g.Structured {
		wrapped, _ := json.Marshal(c.Output)
		reply := `{"choices":[{"message":{"content":` + string(wrapped) + `}}]}`
		if c.Provider == "gemini" {
			reply = `{"candidates":[{"content":{"parts":[{"text":` + string(wrapped) + `}]}}]}`
		}
		server.reply(http.StatusOK, reply, nil)
		got, err := server.provider(t, c.Provider, models[c.Provider]).Generate(context.Background(), structured)
		switch {
		case !c.Outcome.OK:
			sameFailure(t, c.Name, c.Outcome, err)
		case err != nil:
			t.Errorf("%s: %v", c.Name, err)
		case !sameJSON(got.Text, c.Outcome.Text):
			t.Errorf("%s: text %q, want the value of %q", c.Name, got.Text, c.Outcome.Text)
		}
	}
}

func TestStatusesWaitsAndRetriesAreTheNextJSLayers(t *testing.T) {
	t.Parallel()
	g := golden.LoadAIProviders(t)
	for _, c := range g.Statuses {
		if c.Status >= 200 && c.Status <= 299 {
			continue // a success is not classified
		}
		if got := ai.KindOfStatus(c.Status); string(got) != c.Kind {
			t.Errorf("status %d: %s, want %s", c.Status, got, c.Kind)
		}
	}
	now := time.UnixMilli(g.RetryAfter.Now)
	for _, c := range g.RetryAfter.Cases {
		value := ""
		if c.Value != nil {
			value = *c.Value
		}
		var got *float64
		if wait := ai.ParseRetryAfter(value, now); wait != nil {
			ms := float64(*wait) / float64(time.Millisecond)
			got = &ms
		}
		if !reflect.DeepEqual(got, c.Ms) {
			t.Errorf("Retry-After %q: %v, want %v", value, deref(got), deref(c.Ms))
		}
	}
	for _, c := range g.Retries {
		step := 0
		attempts, sleeps, err := ai.Retry(context.Background(), c.Random, func() error {
			raw := c.Steps[step]
			step++
			var word string
			if json.Unmarshal(raw, &word) == nil {
				if word == "ok" {
					return nil
				}
				return errors.New("not ours")
			}
			var failure struct {
				Kind         string   `json:"kind"`
				RetryAfterMs *float64 `json:"retryAfterMs"`
			}
			if err := json.Unmarshal(raw, &failure); err != nil {
				t.Fatal(err)
			}
			e := &ai.Error{Kind: ai.Kind(failure.Kind), Provider: "p"}
			if failure.RetryAfterMs != nil {
				wait := time.Duration(*failure.RetryAfterMs) * time.Millisecond
				e.RetryAfter = &wait
			}
			return e
		})
		kind := ""
		var failure *ai.Error
		if errors.As(err, &failure) {
			kind = string(failure.Kind)
		} else if err != nil {
			kind = "not ours"
		}
		if sleeps == nil {
			sleeps = []float64{}
		}
		if attempts != c.Outcome.Attempts || (err == nil) != c.Outcome.OK || kind != c.Outcome.Kind || !reflect.DeepEqual(sleeps, c.Sleeps) {
			t.Errorf("%s: %d attempts, waits %v, error %v; want %d attempts, waits %v, kind %q", c.Name, attempts, sleeps, err, c.Outcome.Attempts, c.Sleeps, c.Outcome.Kind)
		}
	}
	for _, c := range g.VisionChecks {
		if c.MaxSide != float64(int(c.MaxSide)) {
			continue
		}
		err := ai.CheckVisionRequest("p", ai.VisionRequest{Image: make([]byte, c.ImageLength), MimeType: c.MimeType, MaxSide: int(c.MaxSide), Instruction: c.Instruction})
		switch {
		case c.Problem == nil && err != nil:
			t.Errorf("%s: refused: %v", c.Name, err)
		case c.Problem != nil && (err == nil || err.Error() != *c.Problem):
			t.Errorf("%s: %v, want %s", c.Name, err, *c.Problem)
		}
	}
}

func deref(f *float64) any {
	if f == nil {
		return nil
	}
	return *f
}

func TestTheCallRecordIsTheNextJSMonitorings(t *testing.T) {
	t.Parallel()
	for _, c := range golden.LoadAIProviders(t).Calls {
		r := c.Record
		record := ai.CallRecord{
			Feature: ai.Feature(r.Feature), Provider: r.Provider, Model: r.Model, Outcome: r.Outcome,
			Latency: time.Duration(r.LatencyMs * float64(time.Millisecond)), Attempts: r.Attempts, HTTPStatus: r.HTTPStatus,
		}
		if r.Usage != nil {
			record.Usage = ai.Usage{InputTokens: r.Usage.InputTokens, OutputTokens: r.Usage.OutputTokens, TotalTokens: r.Usage.TotalTokens}
		}
		if r.Price != nil {
			record.Price = &config.AIPrice{InputUSDPerMTok: r.Price.InputUsdPerMTok, OutputUSDPerMTok: r.Price.OutputUsdPerMTok}
		}
		got, err := json.Marshal(record.Fields())
		if err != nil {
			t.Fatal(err)
		}
		if !sameJSON(string(got), string(c.Fields)) {
			t.Errorf("%s:\n got %s\nwant %s", c.Name, got, c.Fields)
		}
	}
}

func TestTheMockAnswersWithoutACall(t *testing.T) {
	t.Parallel()
	for _, c := range golden.LoadAIProviders(t).MockText {
		var request struct {
			JSONSchema *golden.AISchema `json:"jsonSchema"`
		}
		if err := json.Unmarshal(c.Request, &request); err != nil {
			t.Fatal(err)
		}
		got, err := ai.Mock{}.Generate(context.Background(), ai.TextRequest{JSONSchema: schemaOf(request.JSONSchema)})
		if err != nil || got.Text != c.Outcome.Text {
			t.Errorf("%s: %q, %v; want %q", c.Name, got.Text, err, c.Outcome.Text)
		}
		sameMetadata(t, c.Name, c.Outcome, got.Metadata)
	}
}
