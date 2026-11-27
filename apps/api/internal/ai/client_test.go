package ai_test

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"lookly/internal/ai"
	"lookly/internal/config"
)

// records remembers what the client told the monitoring.
type records struct {
	mu    sync.Mutex
	calls []ai.CallRecord
}

func (r *records) RecordCall(_ context.Context, record ai.CallRecord) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls = append(r.calls, record)
}

func (r *records) all() []ai.CallRecord {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]ai.CallRecord(nil), r.calls...)
}

// scripted is a provider's API that answers each request in turn with the
// next of its replies (the last one again when they run out).
func scripted(t *testing.T, replies ...func(w http.ResponseWriter, r *http.Request)) (*httptest.Server, *atomic.Int32) {
	t.Helper()
	var n atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		i := int(n.Add(1)) - 1
		replies[min(i, len(replies)-1)](w, r)
	}))
	t.Cleanup(server.Close)
	return server, &n
}

func status(code int, body string) func(http.ResponseWriter, *http.Request) {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(code)
		_, _ = io.WriteString(w, body)
	}
}

const (
	geminiSays = `{"candidates":[{"content":{"parts":[{"text":"Salom"}]}}],"usageMetadata":{"promptTokenCount":1000,"candidatesTokenCount":200,"totalTokenCount":1200}}`
	openAISays = `{"choices":[{"message":{"content":"{\"subject\":\"single_garment\"}"}}],"usage":{"prompt_tokens":900,"completion_tokens":40,"total_tokens":940}}`
)

var question = ai.TextRequest{Messages: []ai.Message{{Role: "user", Content: "Bugun nima kiyay? maxfiy-savol"}}}

func settings(stylistTimeout time.Duration) config.AI {
	price := &config.AIPrice{InputUSDPerMTok: 0.3, OutputUSDPerMTok: 2.5}
	return config.AI{
		Stylist: config.AIRoute{Provider: config.AIGemini, Model: "gemini-test", APIKey: "fake-gemini-key-never-shown", Timeout: stylistTimeout, Price: price, Source: "AI_LLM"},
		Outfit:  config.AIRoute{Provider: config.AIMock, Model: "mock", Timeout: time.Second, Source: "AI_OUTFIT"},
		Vision: config.AIVision{
			Provider: config.AIOpenAI, Model: "gpt-vision-test", APIKey: "fake-openai-key-never-shown", Timeout: 2 * time.Second, MaxSide: 1024,
			Price: &config.AIPrice{InputUSDPerMTok: 1, OutputUSDPerMTok: 4},
		},
	}
}

func client(t *testing.T, cfg config.AI, gemini, openai string) (*ai.Client, *records) {
	t.Helper()
	rec := &records{}
	c, err := ai.NewClient(cfg, ai.Addresses{Gemini: gemini, OpenAI: openai}, rec)
	if err != nil {
		t.Fatal(err)
	}
	return c.WithoutWaits(nil), rec
}

func TestACallIsTriedOnceMoreAndToldToTheMonitoringOnce(t *testing.T) {
	t.Parallel()
	gemini, asked := scripted(t, status(503, `{"error":"busy"}`), status(200, geminiSays))
	c, rec := client(t, settings(2*time.Second), gemini.URL, "http://127.0.0.1:1")
	got, err := c.GenerateText(context.Background(), ai.StylistChat, question)
	if err != nil || got.Text != "Salom" || got.Metadata.Provider != "gemini" || got.Metadata.Model != "gemini-test" {
		t.Fatalf("got %+v, %v", got, err)
	}
	if asked.Load() != 2 {
		t.Fatalf("asked %d times", asked.Load())
	}
	calls := rec.all()
	if len(calls) != 1 {
		t.Fatalf("%d records", len(calls))
	}
	fields := calls[0].Fields()
	// 1000 × 0.3 + 200 × 2.5 dollars a million tokens.
	if fields.Feature != ai.StylistChat || fields.Provider != "gemini" || fields.Model != "gemini-test" || fields.Outcome != "ok" || fields.Attempts != 2 ||
		fields.Retry != "succeeded" || !fields.Success || *fields.Input != 1000 || *fields.Output != 200 || *fields.Total != 1200 || *fields.CostUSD != 0.0008 {
		t.Errorf("the record: %+v", fields)
	}
	if provider, model := c.TextProviderOf(ai.StylistChat); provider != "gemini" || model != "gemini-test" {
		t.Errorf("the stylist's provider: %s %s", provider, model)
	}
}

func TestAFailureIsTheLastAttemptsAndIsRecorded(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		name     string
		replies  []func(http.ResponseWriter, *http.Request)
		kind     ai.Kind
		status   int
		attempts int32
	}{
		{"refused credentials are not tried again", []func(http.ResponseWriter, *http.Request){status(401, `{}`)}, ai.Auth, 401, 1},
		{"a bad request is not tried again", []func(http.ResponseWriter, *http.Request){status(400, `{}`)}, ai.InvalidRequest, 400, 1},
		{"busy twice", []func(http.ResponseWriter, *http.Request){status(503, `{}`), status(502, `{}`)}, ai.Unavailable, 502, 2},
		{"busy, then refused", []func(http.ResponseWriter, *http.Request){status(500, `{}`), status(403, `{}`)}, ai.Auth, 403, 2},
		{"too many requests with a long wait is not tried again", []func(http.ResponseWriter, *http.Request){func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Retry-After", "30")
			w.WriteHeader(429)
		}}, ai.RateLimited, 429, 1},
		{"too many requests with a short wait is tried again", []func(http.ResponseWriter, *http.Request){func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Retry-After", "1")
			w.WriteHeader(429)
		}}, ai.RateLimited, 429, 2},
		{"an answer that is not JSON", []func(http.ResponseWriter, *http.Request){status(200, `<html>`)}, ai.MalformedResponse, 0, 1},
		// An answer that would be read as "Salom" if all nine megabytes of it were read.
		{"an answer too long to be one", []func(http.ResponseWriter, *http.Request){status(200, `{"candidates":[{"content":{"parts":[{"text":"Salom"}]}}],"padding":"`+strings.Repeat("x", 9<<20)+`"}`)}, ai.MalformedResponse, 0, 1},
		{"a filtered answer", []func(http.ResponseWriter, *http.Request){status(200, `{"promptFeedback":{"blockReason":"SAFETY"}}`)}, ai.ContentFiltered, 0, 1},
	} {
		gemini, asked := scripted(t, c.replies...)
		client, rec := client(t, settings(5*time.Second), gemini.URL, "http://127.0.0.1:1")
		_, err := client.GenerateText(context.Background(), ai.StylistChat, question)
		var failure *ai.Error
		if !errors.As(err, &failure) || failure.Kind != c.kind || failure.Status != c.status || asked.Load() != c.attempts {
			t.Errorf("%s: %v after %d attempts", c.name, err, asked.Load())
			continue
		}
		calls := rec.all()
		if len(calls) != 1 || calls[0].Outcome != string(c.kind) || calls[0].HTTPStatus != c.status || calls[0].Attempts != int(c.attempts) ||
			calls[0].Usage != (ai.Usage{}) || calls[0].Price != nil {
			t.Errorf("%s: the record %+v", c.name, calls)
		}
		// Nothing of the question, the answer or the key is in the error or the record.
		if text := fmt.Sprintf("%v %+v", err, calls); strings.Contains(text, "never-shown") || strings.Contains(text, "maxfiy") || strings.Contains(text, "busy") {
			t.Errorf("%s: %s", c.name, text)
		}
	}
}

func TestAnAttemptHasItsRoutesTimeLimit(t *testing.T) {
	t.Parallel()
	release := make(chan struct{})
	silent, asked := scripted(t, func(http.ResponseWriter, *http.Request) { <-release })
	arrived := make(chan struct{}, 4)
	waiting, got := scripted(t, func(http.ResponseWriter, *http.Request) {
		arrived <- struct{}{}
		<-release
	})
	// Registered after the servers' own cleanups, so it runs before them:
	// a server closes only when its handlers have returned.
	t.Cleanup(func() { close(release) })
	c, _ := client(t, settings(150*time.Millisecond), silent.URL, silent.URL)

	// The route's limit, when the request names none: two attempts of it.
	started := time.Now()
	_, err := c.GenerateText(context.Background(), ai.StylistChat, question)
	var failure *ai.Error
	if !errors.As(err, &failure) || failure.Kind != ai.Timeout || asked.Load() != 2 {
		t.Fatalf("got %v after %d attempts", err, asked.Load())
	}
	if took := time.Since(started); took < 250*time.Millisecond || took > 5*time.Second {
		t.Errorf("two attempts of 150 ms took %v", took)
	}
	// The request's own limit wins.
	short := question
	short.Timeout = 30 * time.Millisecond
	started = time.Now()
	if _, err := c.GenerateText(context.Background(), ai.StylistChat, short); !errors.As(err, &failure) || failure.Kind != ai.Timeout {
		t.Fatalf("got %v", err)
	}
	if took := time.Since(started); took > 250*time.Millisecond {
		t.Errorf("two attempts of 30 ms took %v", took)
	}
	// The vision settings' limit for a picture.
	visionCfg := settings(time.Second)
	visionCfg.Vision.Timeout = 100 * time.Millisecond
	v, _ := client(t, visionCfg, silent.URL, silent.URL)
	picture := ai.VisionRequest{Image: []byte{1, 2, 3}, MimeType: "image/jpeg", MaxSide: 1024, Instruction: "I"}
	if _, err := v.AnalyzeImage(context.Background(), ai.ClothingAnalysis, picture); !errors.As(err, &failure) || failure.Kind != ai.Timeout {
		t.Fatalf("got %v", err)
	}

	// A caller that gives up is not a timeout, and is not tried again. It
	// gives up when the provider has the request, not after a guessed time.
	w, waitingRec := client(t, settings(10*time.Second), waiting.URL, waiting.URL)
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		<-arrived
		cancel()
	}()
	if _, err := w.GenerateText(ctx, ai.StylistChat, question); !errors.As(err, &failure) || failure.Kind != ai.Cancelled {
		t.Fatalf("got %v", err)
	}
	if got.Load() != 1 {
		t.Errorf("a cancelled call was tried %d times", got.Load())
	}
	if calls := waitingRec.all(); len(calls) != 1 || calls[0].Outcome != "cancelled" || calls[0].Attempts != 1 {
		t.Errorf("the record of the cancelled call: %+v", calls)
	}
	// A call that starts cancelled asks nobody.
	if _, err := w.GenerateText(ctx, ai.StylistChat, question); !errors.As(err, &failure) || failure.Kind != ai.Cancelled || got.Load() != 1 {
		t.Fatalf("got %v, asked %d times", err, got.Load())
	}
}

func TestEachRoleAsksItsOwnProviderAndTheMockAsksNobody(t *testing.T) {
	t.Parallel()
	gemini, askedGemini := scripted(t, status(200, geminiSays))
	openai, askedOpenAI := scripted(t, status(200, openAISays))
	c, rec := client(t, settings(time.Second), gemini.URL, openai.URL)

	if _, err := c.GenerateText(context.Background(), ai.StylistChat, question); err != nil {
		t.Fatal(err)
	}
	// The outfit route is the mock's: no request leaves.
	got, err := c.GenerateText(context.Background(), ai.OutfitExplanation, question)
	if err != nil || got.Text != ai.MockText || got.Metadata.Provider != "mock" {
		t.Fatalf("the mock route: %+v, %v", got, err)
	}
	picture := ai.VisionRequest{Image: []byte{1, 2, 3}, MimeType: "image/jpeg", MaxSide: 1024, Instruction: "I"}
	seen, err := c.AnalyzeImage(context.Background(), ai.ClothingAnalysis, picture)
	if err != nil || string(seen.Output) != `{"subject":"single_garment"}` || seen.Metadata.Provider != "openai" {
		t.Fatalf("the picture: %+v, %v", seen, err)
	}
	if askedGemini.Load() != 1 || askedOpenAI.Load() != 1 {
		t.Fatalf("gemini was asked %d times, openai %d", askedGemini.Load(), askedOpenAI.Load())
	}
	calls := rec.all()
	if len(calls) != 3 || calls[1].Provider != "mock" || calls[1].Feature != ai.OutfitExplanation || calls[1].Fields().CostUSD != nil ||
		calls[2].Feature != ai.ClothingAnalysis || calls[2].Provider != "openai" || *calls[2].Fields().CostUSD != 0.00106 {
		t.Errorf("the records: %+v", calls)
	}
	if provider, model := c.VisionProvider(); provider != "openai" || model != "gpt-vision-test" {
		t.Errorf("the vision provider: %s %s", provider, model)
	}
	// A feature that has no text route.
	if _, err := c.GenerateText(context.Background(), ai.ClothingAnalysis, question); err == nil {
		t.Error("a text request for a feature without a text route was served")
	}
	if len(rec.all()) != 3 {
		t.Error("a request that was never made was recorded")
	}
}

func TestAnAnswerThatSendsUsElsewhereIsAFailure(t *testing.T) {
	t.Parallel()
	var elsewhere atomic.Int32
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		elsewhere.Add(1)
		_, _ = io.WriteString(w, geminiSays)
	}))
	t.Cleanup(other.Close)
	redirecting, _ := scripted(t, func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, other.URL+r.URL.Path, http.StatusTemporaryRedirect)
	})
	c, _ := client(t, settings(time.Second), redirecting.URL, redirecting.URL)
	_, err := c.GenerateText(context.Background(), ai.StylistChat, question)
	var failure *ai.Error
	if !errors.As(err, &failure) || failure.Kind != ai.ProviderError || failure.Status != http.StatusTemporaryRedirect {
		t.Fatalf("got %v", err)
	}
	if elsewhere.Load() != 0 {
		t.Error("the redirect was followed: the key went elsewhere")
	}
}

func TestAClientIsNotBuiltOfWhatItDoesNotKnow(t *testing.T) {
	t.Parallel()
	for name, change := range map[string]func(c *config.AI){
		"an unknown stylist provider": func(c *config.AI) { c.Stylist.Provider = "claude" },
		"an unknown outfit provider":  func(c *config.AI) { c.Outfit.Provider = "" },
		"an unknown vision provider":  func(c *config.AI) { c.Vision.Provider = "zai" },
		"a real provider without key": func(c *config.AI) { c.Stylist.APIKey = "" },
		"vision without its key":      func(c *config.AI) { c.Vision.APIKey = "" },
	} {
		cfg := settings(time.Second)
		change(&cfg)
		if c, err := ai.NewClient(cfg, ai.DefaultAddresses, &records{}); err == nil {
			t.Errorf("%s: built %+v", name, c)
		}
	}
}
