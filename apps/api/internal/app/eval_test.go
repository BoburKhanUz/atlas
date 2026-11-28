package app_test

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"lookly/internal/app"
	"lookly/internal/color"
	"lookly/internal/golden"
)

// standIn is an OpenAI-shaped stand-in: each request gets answer(n, body).
type standIn struct {
	mu      sync.Mutex
	auth    []string
	bodies  []map[string]any
	answer  func(n int, body map[string]any) string
	refuses bool
	// failFirst answers the first requests 503.
	failFirst int
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
		if s.refuses || n <= s.failFirst {
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

// asJSON is v as decoded JSON, to compare with what the stand-in received.
func asJSON(t *testing.T, v any) any {
	t.Helper()
	encoded, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	var out any
	if err := json.Unmarshal(encoded, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func sameJSON(t *testing.T, what string, got, want any) {
	t.Helper()
	g, _ := json.Marshal(asJSON(t, got))
	w, _ := json.Marshal(asJSON(t, want))
	if !bytes.Equal(g, w) {
		t.Errorf("%s:\n got %s\nwant %s", what, g, w)
	}
}

// The setup is what was sent: a dry run asks no model and gives the same
// messages and schema the real run sends.
func TestEvalSetupIsWhatIsSentAndADryRunSendsNothing(t *testing.T) {
	t.Parallel()
	s := &standIn{answer: func(int, map[string]any) string {
		return `{"answer":"Bugun [W1] kiying.","referencedItems":["W1"],"needsMoreInfo":false}`
	}}
	url := s.serve(t)
	dry := strings.Replace(stylistCase, `{"feature":"stylist",`, `{"feature":"stylist","dryRun":true,`, 1)
	code, lines, stderr := runEval(t, nil, dry+"\n"+stylistCase+"\n", "--provider=openai", "--model=m", "--base-url="+url)
	if code != 0 || len(lines) != 2 || len(s.bodies) != 1 {
		t.Fatalf("exit %d, %v, %d calls, %s", code, lines, len(s.bodies), stderr)
	}
	d, real := lines[0], lines[1]
	if d["outcome"] != nil || d["calls"] != float64(0) || d["attempts"] != nil || d["provider"] != "openai" {
		t.Errorf("dry run %v", d)
	}
	sameJSON(t, "dry and real setups", d["setup"], real["setup"])
	setup := d["setup"].(map[string]any)
	sameJSON(t, "refs", setup["refs"], []string{"W1", "W2", "W3"})
	sameJSON(t, "messages", setup["messages"], s.bodies[0]["messages"])
	format := s.bodies[0]["response_format"].(map[string]any)["json_schema"].(map[string]any)
	schema := setup["schema"].(map[string]any)
	if schema["name"] != format["name"] {
		t.Errorf("schema name %v, sent %v", schema["name"], format["name"])
	}
	sameJSON(t, "schema", schema["schema"], format["schema"])
	sameJSON(t, "attempts", real["attempts"], []string{"ok"})
}

// Each attempt's outcome, in order: a refused first attempt, then the answer.
func TestEvalGivesEachAttemptsOutcome(t *testing.T) {
	t.Parallel()
	s := &standIn{failFirst: 1, answer: func(int, map[string]any) string {
		return `{"answer":"Bugun [W1] kiying.","referencedItems":["W1"],"needsMoreInfo":false}`
	}}
	code, lines, _ := runEval(t, nil, stylistCase+"\n", "--provider=openai", "--model=m", "--base-url="+s.serve(t))
	if code != 0 || len(lines) != 1 || lines[0]["calls"] != float64(2) {
		t.Fatalf("exit %d, %v", code, lines)
	}
	sameJSON(t, "attempts", lines[0]["attempts"], []string{"unavailable", "ok"})
	// Each case has its own: two in one run.
	again := &standIn{failFirst: 1, answer: s.answer}
	_, lines, _ = runEval(t, nil, stylistCase+"\n"+stylistCase+"\n", "--provider=openai", "--model=m", "--base-url="+again.serve(t))
	if len(lines) != 2 {
		t.Fatalf("two cases: %v", lines)
	}
	sameJSON(t, "first case", lines[0]["attempts"], []string{"unavailable", "ok"})
	sameJSON(t, "second case", lines[1]["attempts"], []string{"ok"})
	down := &standIn{refuses: true}
	_, lines, _ = runEval(t, nil, stylistCase+"\n", "--provider=openai", "--model=m", "--base-url="+down.serve(t))
	sameJSON(t, "attempts when down", lines[0]["attempts"], []string{"unavailable", "unavailable"})
}

const outfitCase = `{"feature":"outfit","case":{"wardrobe":[{"id":"a","category":"shirt","subcategory":"tshirt","colors":["white"],"season":["summer"],"formality":"casual","style":"casual"},{"id":"b","category":"shirt","subcategory":"shirt","colors":["blue"],"season":["summer"],"formality":"smart_casual","style":"classic"},{"id":"c","category":"pants","subcategory":"jeans","colors":["navy"],"season":["summer"],"formality":"casual","style":"casual"},{"id":"d","category":"shoes","subcategory":"sneakers","colors":["white"],"season":["summer"],"formality":"casual","style":"casual"}],"occasion":"casual","topN":2}}`

func TestEvalOutfitSetupNamesTheCandidatesAndTheFallback(t *testing.T) {
	t.Parallel()
	s := &standIn{answer: func(int, map[string]any) string {
		return `{"selectedCandidate":"O2","ranking":["O2","O1"],"explanation":"Bu obraz qulay.","needsMoreInfo":false}`
	}}
	url := s.serve(t)
	empty := `{"feature":"outfit","dryRun":true,"case":{"wardrobe":[],"occasion":"casual"}}`
	one := strings.Replace(strings.Replace(outfitCase, `{"feature":"outfit",`, `{"feature":"outfit","dryRun":true,`, 1),
		`{"id":"b","category":"shirt","subcategory":"shirt","colors":["blue"],"season":["summer"],"formality":"smart_casual","style":"classic"},`, "", 1)
	code, lines, stderr := runEval(t, nil, outfitCase+"\n"+empty+"\n"+one+"\n", "--provider=openai", "--model=m", "--base-url="+url)
	if code != 0 || len(lines) != 3 || len(s.bodies) != 1 {
		t.Fatalf("exit %d, %v, %s", code, lines, stderr)
	}
	setup := lines[0]["setup"].(map[string]any)
	candidates := setup["candidates"].([]any)
	if len(candidates) != 2 || setup["weatherProvided"] != false || setup["profileSent"] != false || setup["profileStrength"] != nil || setup["problem"] != "" {
		t.Errorf("setup %v", setup)
	}
	for i, c := range candidates {
		c := c.(map[string]any)
		items := c["items"].([]any)
		if c["ref"] != []string{"O1", "O2"}[i] || c["key"] == "" || len(items) != 3 || c["signals"] == nil || c["score"] == nil {
			t.Errorf("candidate %d: %v", i, c)
		}
		// Each outfit is a top, a bottom and shoes from the wardrobe.
		roles := map[string]string{}
		for _, p := range items {
			p := p.(map[string]any)
			roles[p["role"].(string)], _ = p["item"].(map[string]any)["id"].(string)
		}
		if roles["bottom"] != "c" || roles["shoes"] != "d" || (roles["top"] != "a" && roles["top"] != "b") {
			t.Errorf("candidate %d roles %v", i, roles)
		}
	}
	if explanation, ok := setup["fallbackExplanation"].(string); !ok || explanation == "" {
		t.Errorf("fallback %v", setup["fallbackExplanation"])
	}
	sameJSON(t, "messages", setup["messages"], s.bodies[0]["messages"])
	// No outfits: the problem, no fallback, no call.
	e := lines[1]["setup"].(map[string]any)
	if e["problem"] == "" || e["fallbackExplanation"] != nil || len(e["candidates"].([]any)) != 0 || lines[1]["candidates"] != float64(0) {
		t.Errorf("empty wardrobe %v", lines[1])
	}
	// One outfit: its explanation.
	if o := lines[2]["setup"].(map[string]any); len(o["candidates"].([]any)) != 1 || o["fallbackExplanation"] == nil {
		t.Errorf("one outfit %v", lines[2])
	}
}

func TestEvalVisionSetupIsThePreparedPicture(t *testing.T) {
	t.Parallel()
	s := &standIn{answer: func(int, map[string]any) string { return `{}` }}
	picture := base64.StdEncoding.EncodeToString(golden.TestdataFile(t, "vision/e2e-white-shirt.png"))
	dry := `{"feature":"vision","dryRun":true,"case":{"image":"` + picture + `","maxSide":256,"openaiDetail":"low"}}`
	tall := `{"feature":"vision","dryRun":true,"case":{"image":"` + pngOf(t, bytes.Repeat([]byte{90, 120, 160}, 256*384), 256, 384) + `","maxSide":256}}`
	garbage := `{"feature":"vision","dryRun":true,"case":{"image":"` + base64.StdEncoding.EncodeToString([]byte("not a picture")) + `","maxSide":256}}`
	code, lines, stderr := runEval(t, nil, dry+"\n"+garbage+"\n"+tall+"\n", "--provider=openai", "--model=m", "--base-url="+s.serve(t))
	if code != 0 || len(lines) != 3 || len(s.bodies) != 0 {
		t.Fatalf("exit %d, %v, %d calls, %s", code, lines, len(s.bodies), stderr)
	}
	// A tall picture stays tall: the longer side is the limit.
	if p := lines[2]["setup"].(map[string]any)["picture"].(map[string]any); p["height"] != float64(256) || p["width"].(float64) >= 256 {
		t.Errorf("tall picture %v", p)
	}
	setup := lines[0]["setup"].(map[string]any)
	p := setup["picture"].(map[string]any)
	if p["mimeType"] != "image/jpeg" || max(p["width"].(float64), p["height"].(float64)) != 256 || setup["schema"].(map[string]any)["name"] != "garment_analysis" {
		t.Errorf("setup %v", setup)
	}
	if g := lines[1]["setup"].(map[string]any); g["picture"] != nil {
		t.Errorf("a file that is no picture: %v", lines[1])
	}
}

func TestEvalNamesTheVersions(t *testing.T) {
	t.Parallel()
	code, lines, _ := runEval(t, nil, `{"feature":"versions"}`+"\n", "--provider=mock")
	if code != 0 || len(lines) != 1 {
		t.Fatalf("exit %d %v", code, lines)
	}
	sameJSON(t, "versions", lines[0]["outcome"], map[string]string{
		"kind": "versions", "visionAnalysis": "v2", "stylistPrompt": "v2", "rankingPrompt": "v2", "engine": "outfit-engine-v2", "colorAnalysis": "color-analysis-v2",
	})
}

// A case with a member the server does not know, at any depth, is refused,
// not half read.
func TestEvalRefusesACaseWithAnUnknownMember(t *testing.T) {
	t.Parallel()
	unknown := strings.Replace(stylistCase, `"occasion":"work"`, `"occasion":"work","colour":"red"`, 1)
	code, lines, _ := runEval(t, nil, unknown+"\n"+strings.Replace(stylistCase, `"id":"w1",`, `"id":"w1","brand":"x",`, 1)+"\n", "--provider=mock")
	if code != 0 || len(lines) != 2 {
		t.Fatalf("exit %d %v", code, lines)
	}
	for _, l := range lines {
		if r, _ := l["refused"].(string); !strings.Contains(r, "not a stylist case") {
			t.Errorf("result %v", l)
		}
	}
}

// pngOf is a picture of the pixels (R, G, B bytes, row by row).
func pngOf(t *testing.T, rgb []byte, w, h int) string {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for i := 0; i < w*h; i++ {
		copy(img.Pix[4*i:], []byte{rgb[3*i], rgb[3*i+1], rgb[3*i+2], 255})
	}
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return base64.StdEncoding.EncodeToString(b.Bytes())
}

func solid(t *testing.T, v byte) string {
	t.Helper()
	return pngOf(t, bytes.Repeat([]byte{v}, 320*320*3), 320, 320)
}

// The colour case gives the analysis of the selfie's canvas: the vectors'
// profile or refusal for each vector picture an upload accepts (a side of at
// least 256; a canvas is at most 320, so it is analysed as it is), the
// quality refusals of plain pictures, and the upload's own refusals.
func TestEvalAnalysesASelfie(t *testing.T) {
	t.Parallel()
	g := golden.LoadColor(t)
	var input strings.Builder
	var vectors []golden.ColorCanvas
	add := func(image string) { input.WriteString(`{"feature":"color","case":{"image":"` + image + `"}}` + "\n") }
	for _, c := range g.Canvases {
		rgb, w, h := c.Pixels(t, color.IsSkinPixel)
		if min(w, h) < 256 || max(w, h) > color.CanvasMaxSide {
			continue
		}
		vectors = append(vectors, c)
		add(pngOf(t, rgb, w, h))
	}
	plain := []struct{ image, want string }{
		{solid(t, 0), `{"kind":"rejected_quality","reason":"too_dark"}`},
		{solid(t, 255), `{"kind":"rejected_quality","reason":"overexposed"}`},
		{solid(t, 128), `{"kind":"rejected_quality","reason":"low_detail"}`},
		{pngOf(t, bytes.Repeat([]byte{128}, 240*320*3), 240, 320), `{"kind":"error","error":"picture_size"}`},
		{base64.StdEncoding.EncodeToString([]byte("not a picture")), `{"kind":"error","error":"unreadable_picture"}`},
	}
	for _, p := range plain {
		add(p.image)
	}
	code, lines, stderr := runEval(t, nil, input.String(), "--provider=mock")
	if len(vectors) < 10 || code != 0 || len(lines) != len(vectors)+len(plain) {
		t.Fatalf("%d vectors, exit %d, %d results, %s", len(vectors), code, len(lines), stderr)
	}
	kinds := map[string]int{}
	for i, c := range vectors {
		o := lines[i]["outcome"].(map[string]any)
		kinds[o["kind"].(string)]++
		if lines[i]["calls"] != float64(0) || lines[i]["provider"] != "deterministic" || lines[i]["model"] != "color-analysis-v2" {
			t.Errorf("%s: %v", c.Name, lines[i])
		}
		switch c.Result.Error {
		case "":
			if o["kind"] != "profile" {
				t.Errorf("%s: %v", c.Name, o)
				continue
			}
			var want any
			if err := json.Unmarshal(c.Result.Value, &want); err != nil {
				t.Fatal(err)
			}
			sameJSON(t, c.Name, o["profile"], want)
		case "skin_not_visible":
			if o["kind"] != "rejected_skin" {
				t.Errorf("%s: %v", c.Name, o)
			}
		default:
			t.Fatalf("%s: vector %s", c.Name, c.Result.Error)
		}
	}
	if kinds["profile"] == 0 || kinds["rejected_skin"] == 0 {
		t.Errorf("outcomes %v", kinds)
	}
	for i, p := range plain {
		var want any
		_ = json.Unmarshal([]byte(p.want), &want)
		sameJSON(t, p.want, lines[len(vectors)+i]["outcome"], want)
	}
}

// Whether the colour profile is shown to the model (a confidence of at least
// 0.3 and a known season) and how strongly the engine uses it (its
// confidence, 0.3 for a profile without one, none under 0.25).
func TestEvalOutfitSetupSaysHowTheProfileIsUsed(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		profile  string
		sent     bool
		strength any
	}{
		{`{"season":"autumn","undertone":"warm","confidence":0.8}`, true, 0.8},
		{`{"season":"autumn","undertone":"warm","confidence":0.28}`, false, 0.28},
		{`{"season":"autumn","undertone":"warm","confidence":0.2}`, false, nil},
		{`{"season":"autumn","undertone":"warm"}`, false, 0.3},
		{`null`, false, nil},
	} {
		req := strings.Replace(outfitCase, `"occasion":"casual"`, `"occasion":"casual","colorProfile":`+c.profile, 1)
		req = strings.Replace(req, `{"feature":"outfit",`, `{"feature":"outfit","dryRun":true,`, 1)
		code, lines, stderr := runEval(t, nil, req+"\n", "--provider=mock")
		if code != 0 || len(lines) != 1 || lines[0]["setup"] == nil {
			t.Fatalf("%s: exit %d %v %s", c.profile, code, lines, stderr)
		}
		setup := lines[0]["setup"].(map[string]any)
		if setup["profileSent"] != c.sent || setup["profileStrength"] != c.strength {
			t.Errorf("%s: sent %v, strength %v", c.profile, setup["profileSent"], setup["profileStrength"])
		}
	}
}

// With --gate every attempt is asked about first and told after; a refused
// one is never sent, nor counted.
func TestEvalGateAsksBeforeEveryAttempt(t *testing.T) {
	t.Parallel()
	s := &standIn{failFirst: 1, answer: func(int, map[string]any) string {
		return `{"answer":"Bugun [W1] kiying.","referencedItems":["W1"],"needsMoreInfo":false}`
	}}
	url := s.serve(t)
	input := stylistCase + "\n" + `{"admit":true}` + "\n" + `{"admit":true}` + "\n"
	code, lines, stderr := runEval(t, nil, input, "--provider=openai", "--model=m", "--base-url="+url, "--gate")
	if code != 0 || len(lines) != 5 || len(s.bodies) != 2 {
		t.Fatalf("exit %d, %d lines %v, %d sent, %s", code, len(lines), lines, len(s.bodies), stderr)
	}
	for i, key := range []string{"ask", "attempted", "ask", "attempted"} {
		if lines[i][key] == nil {
			t.Fatalf("line %d is not %q: %v", i, key, lines[i])
		}
	}
	a := lines[0]["ask"].(map[string]any)
	text := a["text"].(map[string]any)
	if a["feature"] != "stylist_chat" || a["provider"] != "openai" || a["model"] != "m" || a["vision"] != nil ||
		text["maxOutputTokens"] == nil || text["schema"].(map[string]any)["name"] != "stylist_answer" {
		t.Errorf("ask %v", a)
	}
	sameJSON(t, "asked messages", text["messages"], s.bodies[0]["messages"])
	sameJSON(t, "first end", lines[1]["attempted"], map[string]any{"outcome": "unavailable"})
	sameJSON(t, "second end", lines[3]["attempted"], map[string]any{"outcome": "ok", "inputTokens": 100, "outputTokens": 20})
	if r := lines[4]; r["calls"] != float64(2) || r["outcome"].(map[string]any)["kind"] != "answer" {
		t.Errorf("result %v", r)
	}
}

func TestEvalGateRefusalsAndBadAnswers(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		name, answers string
		sent          int
	}{
		{"refused", `{"admit":false}` + "\n", 0},
		{"the retry refused", `{"admit":true}` + "\n" + `{"admit":false}` + "\n", 1},
		{"no answer", "", 0},
		{"not an answer", `{"admit":"yes"}` + "\n", 0},
		{"an unknown member", `{"admit":true,"also":1}` + "\n", 0},
	} {
		s := &standIn{refuses: true}
		code, lines, stderr := runEval(t, nil, stylistCase+"\n"+c.answers, "--provider=openai", "--model=m", "--base-url="+s.serve(t), "--gate")
		if code != 0 || len(lines) == 0 || len(s.bodies) != c.sent {
			t.Errorf("%s: exit %d, %v, %d sent, %s", c.name, code, lines, len(s.bodies), stderr)
			continue
		}
		r := lines[len(lines)-1]
		if o := r["outcome"].(map[string]any); o["kind"] != "error" || o["error"] != "cancelled" || r["calls"] != float64(c.sent) {
			t.Errorf("%s: result %v", c.name, r)
		}
	}
}

func TestEvalGateShowsThePictureSize(t *testing.T) {
	t.Parallel()
	s := &standIn{answer: func(int, map[string]any) string { return `{}` }}
	picture := base64.StdEncoding.EncodeToString(golden.TestdataFile(t, "vision/e2e-white-shirt.png"))
	vision := `{"feature":"vision","case":{"image":"` + picture + `","maxSide":256,"openaiDetail":"low"}}`
	code, lines, stderr := runEval(t, nil, vision+"\n"+`{"admit":false}`+"\n", "--provider=openai", "--model=m", "--base-url="+s.serve(t), "--gate")
	if code != 0 || len(lines) != 2 || len(s.bodies) != 0 {
		t.Fatalf("exit %d, %v, %s", code, lines, stderr)
	}
	v := lines[0]["ask"].(map[string]any)["vision"].(map[string]any)
	if v["mimeType"] != "image/jpeg" || max(v["width"].(float64), v["height"].(float64)) != 256 || v["maxSide"] != float64(256) ||
		v["maxOutputTokens"] == nil || v["options"].(map[string]any)["openaiDetail"] != "low" {
		t.Errorf("ask %v", v)
	}
}
