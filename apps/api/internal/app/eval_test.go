package app_test

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"lookly/internal/app"
	"lookly/internal/golden"
)

// standIn is an OpenAI-shaped stand-in: each request gets answer(n, body).
type standIn struct {
	mu      sync.Mutex
	auth    []string
	bodies  []map[string]any
	answer  func(n int, body map[string]any) string
	refuses bool
}

func (s *standIn) serve(t *testing.T) string {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		s.mu.Lock()
		s.auth = append(s.auth, r.Header.Get("Authorization"))
		s.bodies = append(s.bodies, body)
		n := len(s.bodies)
		s.mu.Unlock()
		if s.refuses {
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(`{"error":{"message":"down"}}`))
			return
		}
		out, _ := json.Marshal(map[string]any{
			"choices": []any{map[string]any{"message": map[string]any{"content": s.answer(n, body)}}},
			"usage":   map[string]any{"prompt_tokens": 100, "completion_tokens": 20, "total_tokens": 120},
		})
		_, _ = w.Write(out)
	}))
	t.Cleanup(server.Close)
	return server.URL
}

func runEval(t *testing.T, env map[string]string, input string, args ...string) (int, []map[string]any, string) {
	t.Helper()
	var stdout, stderr bytes.Buffer
	code := app.RunEval(context.Background(), args, func(k string) (string, bool) { v, ok := env[k]; return v, ok }, strings.NewReader(input), &stdout, &stderr)
	var lines []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(stdout.String()), "\n") {
		if line == "" {
			continue
		}
		var m map[string]any
		if err := json.Unmarshal([]byte(line), &m); err != nil {
			t.Fatalf("not a JSON result: %q", line)
		}
		lines = append(lines, m)
	}
	return code, lines, stderr.String()
}

const realKey = "sk-test-real-key-must-not-leave"

func TestEvalRefusesWhatItCannotRunSafely(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		name string
		env  map[string]string
		args []string
		want string
	}{
		{"no provider", nil, nil, "--provider"},
		{"an unknown provider", nil, []string{"--provider=anthropic", "--model=x"}, "--provider"},
		{"no model", nil, []string{"--provider=openai", "--base-url=http://127.0.0.1:9"}, "--model"},
		{"a real provider without a cap", map[string]string{"OPENAI_API_KEY": realKey}, []string{"--provider=openai", "--model=gpt-x"}, "--max-calls"},
		{"a real provider without its key", nil, []string{"--provider=gemini", "--model=g", "--max-calls=5"}, "GEMINI_API_KEY"},
		{"a stand-in elsewhere", map[string]string{"OPENAI_API_KEY": realKey}, []string{"--provider=openai", "--model=x", "--base-url=https://api.openai.com/v1"}, "this machine"},
		{"a stand-in with a user", nil, []string{"--provider=openai", "--model=x", "--base-url=http://u:p@127.0.0.1:9"}, "this machine"},
		{"an argument too many", nil, []string{"--provider=mock", "extra"}, "usage"},
		{"a negative cap", nil, []string{"--provider=mock", "--max-calls=-1"}, "negative"},
		{"no time", nil, []string{"--provider=mock", "--timeout=0s"}, "--timeout must be positive"},
	} {
		code, lines, stderr := runEval(t, c.env, "", c.args...)
		if code != 2 || len(lines) != 0 || !strings.Contains(stderr, c.want) || strings.Contains(stderr, realKey) {
			t.Errorf("%s: exit %d, %d results, stderr %q", c.name, code, len(lines), stderr)
		}
	}
}

// A stylist case as the harness sends one.
const stylistCase = `{"feature":"stylist","case":{"wardrobe":[{"id":"w1","category":"shirt","subcategory":"shirt","colors":["white"],"season":["spring","summer"],"formality":"smart_casual","style":"classic","createdAt":"2026-01-01T00:00:00.000Z"},{"id":"w2","category":"pants","subcategory":"trousers","colors":["navy"],"season":["spring","summer"],"formality":"smart_casual","style":"classic","createdAt":"2026-01-02T00:00:00.000Z"},{"id":"w3","category":"shoes","subcategory":"loafers","colors":["brown"],"season":["spring","summer"],"formality":"smart_casual","style":"classic","createdAt":"2026-01-03T00:00:00.000Z"}],"occasion":"work","message":"Ertaga ishga nima kiyay?","occasionText":"ish"}}`

func TestEvalRunsAStylistCaseAgainstAStandInWithoutAKey(t *testing.T) {
	t.Parallel()
	s := &standIn{answer: func(n int, _ map[string]any) string {
		if n == 1 {
			return `{"answer":"Bugun [W9] kiying.","referencedItems":[],"needsMoreInfo":false}`
		}
		return `{"answer":"Bugun [W1] va [W2] ni kiying.","referencedItems":["W1","W2"],"needsMoreInfo":false}`
	}}
	url := s.serve(t)
	code, lines, stderr := runEval(t, map[string]string{"OPENAI_API_KEY": realKey}, stylistCase+"\nnot json\n", "--provider=openai", "--model=gpt-eval", "--base-url="+url)
	if code != 0 || len(lines) != 2 {
		t.Fatalf("exit %d, %v, %s", code, lines, stderr)
	}
	r := lines[0]
	o := r["outcome"].(map[string]any)
	if o["kind"] != "answer" || o["firstError"] != "invalid_reference" || o["raw"] != "Bugun [W1] va [W2] ni kiying." ||
		strings.Contains(o["shown"].(string), "[W") || r["calls"] != float64(2) || r["requests"] != float64(2) ||
		r["inputTokens"] != float64(200) || r["provider"] != "openai" || r["model"] != "gpt-eval" {
		t.Errorf("result %v", r)
	}
	if lines[1]["refused"] == nil {
		t.Errorf("the bad line: %v", lines[1])
	}
	for _, a := range s.auth {
		if a != "Bearer stand-in-no-key" {
			t.Errorf("the stand-in got %q", a)
		}
	}
	// The request: the rules, the context, the user's turn.
	messages := s.bodies[0]["messages"].([]any)
	if len(messages) != 3 || messages[2].(map[string]any)["content"] != `{"message":"Ertaga ishga nima kiyay?","occasion":"ish"}` {
		t.Errorf("messages %v", messages)
	}
}

func TestEvalStopsBeforeTheCallCap(t *testing.T) {
	t.Parallel()
	s := &standIn{answer: func(int, map[string]any) string {
		return `{"answer":"Bugun [W1] kiying.","referencedItems":["W1"],"needsMoreInfo":false}`
	}}
	url := s.serve(t)
	// Each request may take two attempts: with a cap of 2, the first case
	// runs (one call) and the second, which could reach 3, is refused before
	// any call.
	code, lines, _ := runEval(t, nil, stylistCase+"\n"+stylistCase+"\n", "--provider=openai", "--model=m", "--base-url="+url, "--max-calls=2")
	if code != 0 || len(lines) != 2 || len(s.bodies) != 1 {
		t.Fatalf("exit %d, %v, %d calls", code, lines, len(s.bodies))
	}
	if o := lines[1]["outcome"].(map[string]any); o["kind"] != "error" || o["error"] != "call_cap" || lines[1]["calls"] != float64(0) {
		t.Errorf("second %v", lines[1])
	}
	// A provider that fails: its error kind, both attempts counted.
	down := &standIn{refuses: true}
	code, lines, _ = runEval(t, nil, stylistCase+"\n", "--provider=openai", "--model=m", "--base-url="+down.serve(t))
	if o := lines[0]["outcome"].(map[string]any); code != 0 || o["kind"] != "error" || o["error"] != "unavailable" || lines[0]["calls"] != float64(2) {
		t.Errorf("down: %v", lines)
	}
}

func TestEvalRunsOutfitAndVisionCases(t *testing.T) {
	t.Parallel()
	s := &standIn{answer: func(_ int, body map[string]any) string {
		if body["response_format"].(map[string]any)["json_schema"].(map[string]any)["name"] == "garment_analysis" {
			return `{"subject":"single_garment","category":"shirt","subcategory":"tshirt","colors":["white"],"pattern":"solid","material":"cotton","sleeveLength":"short","fit":"regular","style":"casual","season":["summer"],"gender":"unisex","formality":"casual","confidence":{"category":0.9,"subcategory":0.8,"color":0.9,"pattern":0.8,"material":0.6,"sleeveLength":0.8,"fit":0.6,"style":0.7,"season":0.6,"gender":0.6,"formality":0.7}}`
		}
		return `{"selectedCandidate":"O2","ranking":["O2","O1"],"explanation":"Bu obraz qulay.","needsMoreInfo":false}`
	}}
	url := s.serve(t)
	outfit := `{"feature":"outfit","case":{"wardrobe":[{"id":"a","category":"shirt","subcategory":"tshirt","colors":["white"],"season":["summer"],"formality":"casual","style":"casual"},{"id":"b","category":"shirt","subcategory":"shirt","colors":["blue"],"season":["summer"],"formality":"smart_casual","style":"classic"},{"id":"c","category":"pants","subcategory":"jeans","colors":["navy"],"season":["summer"],"formality":"casual","style":"casual"},{"id":"d","category":"shoes","subcategory":"sneakers","colors":["white"],"season":["summer"],"formality":"casual","style":"casual"}],"occasion":"casual","topN":2}}`
	picture := base64.StdEncoding.EncodeToString(golden.TestdataFile(t, "vision/e2e-white-shirt.png"))
	vision := `{"feature":"vision","case":{"image":"` + picture + `","maxSide":512,"openaiDetail":"low"}}`
	code, lines, stderr := runEval(t, nil, outfit+"\n"+vision+"\n", "--provider=openai", "--model=m", "--base-url="+url)
	if code != 0 || len(lines) != 2 {
		t.Fatalf("exit %d %v %s", code, lines, stderr)
	}
	if o := lines[0]["outcome"].(map[string]any); o["kind"] != "ranked" || o["explanation"] != "Bu obraz qulay." || lines[0]["candidates"] != float64(2) {
		t.Errorf("outfit %v", lines[0])
	}
	o := lines[1]["outcome"].(map[string]any)
	if o["kind"] != "garment" || o["attributes"].(map[string]any)["subcategory"] != "tshirt" || o["colorVerdict"] == nil || o["rawConfidence"] == nil {
		t.Errorf("vision %v", lines[1])
	}
}
