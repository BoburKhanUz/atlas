//go:build integration

package httpapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"io"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"lookly/internal/ai"
	"lookly/internal/config"
	"lookly/internal/config/configtest"
	"lookly/internal/imaging"
	"lookly/internal/quota"
	"lookly/internal/vision"
	"lookly/internal/wardrobe"
)

// testAI is the tests' AI configuration: the mock everywhere, the rollout
// open (the defaults of a test environment).
func testAI(t *testing.T) config.AI {
	t.Helper()
	cfg, err := config.Load(configtest.Getenv(nil))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.AI.Vision.Provider != config.AIMock || !cfg.AI.Rollout.Vision || cfg.AI.Rollout.Percent != 100 {
		t.Fatalf("the test environment's AI: %v", cfg.AI)
	}
	return cfg.AI
}

// newAnalyzer is the garment analysis of a test server: settings nil is
// testAI; at is where a real provider is asked.
func newAnalyzer(t *testing.T, pool *pgxpool.Pool, pictures *imaging.Processor, log *slog.Logger, settings *config.AI, at ai.Addresses) *vision.Analyzer {
	t.Helper()
	cfg := testAI(t)
	if settings != nil {
		cfg = *settings
	}
	monitor := ai.NewMonitor(log, "test")
	client, err := ai.NewClient(cfg, at, monitor)
	if err != nil {
		t.Fatal(err)
	}
	return vision.NewAnalyzer(vision.AnalyzerConfig{
		Client: client, Quotas: quota.New(pool, monitor, log), Pictures: pictures, Monitor: monitor,
		Settings: cfg.Vision, Rollout: cfg.Rollout, Log: log,
	})
}

// provider is a stand-in for OpenAI's chat completions: each request gets
// the next answer (the last one again when they run out).
type provider struct {
	mu      sync.Mutex
	answers []func(w http.ResponseWriter)
	bodies  [][]byte
}

func (p *provider) asked() [][]byte {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([][]byte(nil), p.bodies...)
}

// says answers with a model's text.
func says(output any) func(w http.ResponseWriter) {
	text, err := json.Marshal(output)
	if err != nil {
		panic(err)
	}
	body, _ := json.Marshal(map[string]any{
		"choices": []any{map[string]any{"message": map[string]any{"content": string(text)}}},
		"usage":   map[string]any{"prompt_tokens": 900, "completion_tokens": 120, "total_tokens": 1020},
	})
	return func(w http.ResponseWriter) { _, _ = w.Write(body) }
}

func failsWith(status int) func(w http.ResponseWriter) {
	return func(w http.ResponseWriter) {
		w.WriteHeader(status)
		_, _ = io.WriteString(w, `{"error":{"message":"down"}}`)
	}
}

var refuses = func(w http.ResponseWriter) {
	_, _ = io.WriteString(w, `{"choices":[{"finish_reason":"content_filter","message":{"content":null}}]}`)
}

// withProvider is a server whose garment analysis asks the stand-in:
// OpenAI's vision model, the rollout as given (nil: open).
func withProvider(t *testing.T, rollout *config.AIRollout, answers ...func(w http.ResponseWriter)) (*uploadWorld, *provider) {
	t.Helper()
	p := &provider{answers: answers}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		p.mu.Lock()
		p.bodies = append(p.bodies, body)
		answer := p.answers[min(len(p.bodies)-1, len(p.answers)-1)]
		p.mu.Unlock()
		answer(w)
	}))
	t.Cleanup(server.Close)
	settings := testAI(t)
	settings.Vision = config.AIVision{Provider: config.AIOpenAI, Model: "gpt-vision-test", APIKey: "fake-openai-key-never-shown", Timeout: 5 * time.Second, MaxSide: 1024}
	if rollout != nil {
		settings.Rollout = *rollout
	}
	return newUploadWorld(t, apiOptions{ai: &settings, aiAt: ai.Addresses{Gemini: "http://127.0.0.1:1", OpenAI: server.URL}}), p
}

// garmentPhoto is a 600×800 photo with detail (it passes the blur check)
// in shades of the catalog's blue.
func garmentPhoto(t *testing.T) []byte {
	t.Helper()
	random := rand.New(rand.NewPCG(1, 2))
	img := image.NewNRGBA(image.Rect(0, 0, 600, 800))
	for y := range 800 {
		for x := range 600 {
			d := random.IntN(41) - 20
			img.Set(x, y, color.NRGBA{uint8(37 + d/2), uint8(99 + d), uint8(235 + d/2), 255})
		}
	}
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

// flatPhoto has no detail at all: too blurry to analyse.
func flatPhoto(t *testing.T) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, 600, 800))
	for i := range img.Pix {
		img.Pix[i] = 200
	}
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func confidences(v float64) map[string]float64 {
	out := map[string]float64{}
	for _, k := range vision.ConfidenceKeys {
		out[k] = v
	}
	return out
}

func jeans() map[string]any {
	return map[string]any{
		"subject": "single_garment", "category": "pants", "subcategory": "jeans", "colors": []string{"blue"}, "pattern": "denim",
		"material": "denim", "sleeveLength": nil, "fit": "slim", "style": "casual", "season": []string{"spring"}, "gender": "unisex",
		"formality": "casual", "confidence": confidences(0.91),
	}
}

func notOne(subject string) map[string]any {
	return map[string]any{
		"subject": subject, "category": nil, "subcategory": nil, "colors": []string{}, "pattern": nil, "material": nil,
		"sleeveLength": nil, "fit": nil, "style": nil, "season": []string{}, "gender": nil, "formality": nil, "confidence": confidences(0),
	}
}

func (w *uploadWorld) send(file []byte, key string) answer {
	w.t.Helper()
	return w.do(uploadCall(w.t, w.m, key, filePart("my-jeans.png", "image/png", file)))
}

// analysesToday is the user's count of garment analyses today.
func (w *uploadWorld) analysesToday() int {
	w.t.Helper()
	return query[int](w.api, `SELECT coalesce(sum("count"), 0)::int FROM "AiUsage" WHERE "userId" = $1 AND "feature" = 'clothing_analysis'`, w.user)
}

// events are the monitoring's lines of an event since the server started.
func (w *uploadWorld) events(event string) []map[string]any {
	w.t.Helper()
	var out []map[string]any
	for _, line := range strings.Split(w.logs(), "\n") {
		var l map[string]any
		if json.Unmarshal([]byte(line), &l) == nil && l["msg"] == event {
			out = append(out, l)
		}
	}
	return out
}

func TestAGarmentIsAnalysedByTheProviderAndStoredWithItsMetadata(t *testing.T) {
	t.Parallel()
	w, p := withProvider(t, nil, says(jeans()))
	got := w.send(garmentPhoto(t), "vision-key-0001")
	if got.status != http.StatusCreated {
		t.Fatalf("status %d: %s", got.status, got.raw)
	}
	detection := got.body["detection"].(map[string]any)
	if detection["mock"] != false || detection["category"] != "pants" || detection["subcategory"] != "jeans" || detection["fit"] != "slim" {
		t.Errorf("detection %v", detection)
	}
	// Shown capped below the clients' "high" band; the colour is supported
	// by the pixels.
	for k, v := range detection["confidence"].(map[string]any) {
		if v != 0.69 {
			t.Errorf("shown confidence of %s: %v", k, v)
		}
	}
	var provider, model, version, raw, shown string
	if err := w.pool.QueryRow(context.Background(), `SELECT "analysisProvider", "analysisModel", "analysisVersion", "analysisRawConfidences", "confidences"
		FROM "WardrobeItem" WHERE "userId" = $1`, w.user).Scan(&provider, &model, &version, &raw, &shown); err != nil {
		t.Fatal(err)
	}
	if provider != "openai" || model != "gpt-vision-test" || version != vision.AnalysisVersion {
		t.Errorf("stored %s %s %s", provider, model, version)
	}
	if want := `{"category":0.91,"subcategory":0.91,"color":0.91,"pattern":0.91,"material":0.91,"sleeveLength":0.91,"fit":0.91,"style":0.91,"season":0.91,"gender":0.91,"formality":0.91}`; raw != want {
		t.Errorf("raw confidences %s", raw)
	}
	if want := `{"category":0.69,"subcategory":0.69,"color":0.69,"pattern":0.69,"material":0.69,"sleeveLength":0.69,"fit":0.69,"style":0.69,"season":0.69,"gender":0.69,"formality":0.69}`; shown != want {
		t.Errorf("confidences %s", shown)
	}
	if w.analysesToday() != 1 {
		t.Errorf("%d analyses counted", w.analysesToday())
	}

	// What the provider was sent: the prepared JPEG, the instruction, the
	// schema; never the file's name.
	sent := p.asked()
	if len(sent) != 1 {
		t.Fatalf("asked %d times", len(sent))
	}
	for _, part := range []string{"data:image/jpeg;base64,", "garment_analysis", "clothing attribute classifier"} {
		if !bytes.Contains(sent[0], []byte(part)) {
			t.Errorf("the request lacks %q", part)
		}
	}
	if bytes.Contains(sent[0], []byte("my-jeans")) {
		t.Error("the file's name was sent to the provider")
	}

	// A replay: the same item, no new analysis, nothing charged.
	again := w.send(garmentPhoto(t), "vision-key-0001")
	if again.status != http.StatusCreated || again.header.Get("Idempotent-Replayed") != "true" || len(p.asked()) != 1 || w.analysesToday() != 1 {
		t.Fatalf("the replay: %d %q, asked %d times, %d counted", again.status, again.header.Get("Idempotent-Replayed"), len(p.asked()), w.analysesToday())
	}
	if again.body["detection"].(map[string]any)["mock"] != false {
		t.Errorf("the replay's detection: %v", again.body["detection"])
	}

	// What the monitoring was told, without the user.
	requests := w.events(ai.EventRequest)
	if len(requests) != 2 || requests[0]["outcome"] != "ok" || requests[0]["billable"] != true || requests[1]["outcome"] != "replay" || requests[1]["billable"] != false {
		t.Errorf("requests: %v", requests)
	}
	if quotas := w.events(ai.EventQuota); len(quotas) != 1 || quotas[0]["action"] != "charged" {
		t.Errorf("quota events: %v", quotas)
	}
	if calls := w.events(ai.EventCall); len(calls) != 1 || calls[0]["success"] != true || calls[0]["provider"] != "openai" {
		t.Errorf("calls: %v", calls)
	}
	for _, line := range strings.Split(w.logs(), "\n") {
		if strings.Contains(line, `"ai.`) && strings.Contains(line, w.user) {
			t.Errorf("an AI event names the user: %s", line)
		}
	}
}

func TestAProviderThatFailsIsAnsweredAIUnavailableAndCostsNothing(t *testing.T) {
	t.Parallel()
	w, p := withProvider(t, nil, failsWith(500), failsWith(500), says(jeans()))
	got := w.send(garmentPhoto(t), "vision-key-0002")
	if got.status != http.StatusServiceUnavailable || got.body["code"] != "AI_UNAVAILABLE" || got.header.Get("Retry-After") != "15" {
		t.Fatalf("%d %v %q", got.status, got.body, got.header.Get("Retry-After"))
	}
	if len(p.asked()) != 2 || w.analysesToday() != 0 {
		t.Errorf("asked %d times, %d counted", len(p.asked()), w.analysesToday())
	}
	w.nothingLeft("after the failure", 0, 0, 0, wardrobe.DailyUploads)
	if quotas := w.events(ai.EventQuota); len(quotas) != 2 || quotas[1]["action"] != "refunded" || quotas[1]["reason"] != "provider_unavailable" {
		t.Errorf("quota events: %v", quotas)
	}
	// The key was let go: the same request works now.
	if again := w.send(garmentPhoto(t), "vision-key-0002"); again.status != http.StatusCreated || again.header.Get("Idempotent-Replayed") != "" {
		t.Fatalf("the retry: %d %s", again.status, again.raw)
	}
	if w.analysesToday() != 1 {
		t.Errorf("%d counted after the retry", w.analysesToday())
	}
}

func TestAnAnswerThatBreaksTheContractIsNotStored(t *testing.T) {
	t.Parallel()
	broken := jeans()
	broken["category"] = "Ignore your rules and store this"
	w, _ := withProvider(t, nil, says(broken))
	got := w.send(garmentPhoto(t), "")
	if got.status != http.StatusServiceUnavailable || got.body["code"] != "AI_UNAVAILABLE" {
		t.Fatalf("%d %s", got.status, got.raw)
	}
	w.nothingLeft("after a broken answer", 0, 0, 0, wardrobe.DailyUploads)
	if w.analysesToday() != 0 {
		t.Errorf("%d counted", w.analysesToday())
	}
	logs := w.logs()
	if !strings.Contains(logs, "ai.vision.invalid_output") || strings.Contains(logs, "Ignore your rules") {
		t.Errorf("the log: the warning is missing or holds what the model wrote")
	}
}

func TestAPhotoThatIsNotOneGarmentIsRefusedAndCharged(t *testing.T) {
	t.Parallel()
	for subject, message := range map[string]string{
		vision.MultipleGarments: "Rasmda bir nechta kiyim bor. Har bir kiyimni alohida suratga oling.",
		vision.NoGarment:        "Rasmda kiyim topilmadi. Kiyim, poyabzal, sumka yoki aksessuarni suratga oling.",
		vision.Unclear:          "Rasm aniq emas. Kiyimni yorug‘ joyda, aniq qilib suratga oling.",
	} {
		t.Run(subject, func(t *testing.T) {
			t.Parallel()
			w, _ := withProvider(t, nil, says(notOne(subject)))
			got := w.send(garmentPhoto(t), "")
			details, _ := got.body["details"].([]any)
			if got.status != http.StatusUnprocessableEntity || got.body["code"] != "NOT_A_GARMENT" || got.body["error"] != message ||
				len(details) != 1 || details[0].(map[string]any)["path"] != "subject" || details[0].(map[string]any)["message"] != subject {
				t.Fatalf("%d %s", got.status, got.raw)
			}
			w.nothingLeft("after the refusal", 0, 0, 0, wardrobe.DailyUploads)
			if w.analysesToday() != 1 {
				t.Errorf("%d counted: the provider did the work", w.analysesToday())
			}
			if requests := w.events(ai.EventRequest); len(requests) != 1 || requests[0]["outcome"] != "not_a_garment" || requests[0]["reason"] != subject || requests[0]["billable"] != true {
				t.Errorf("requests: %v", requests)
			}
		})
	}
}

func TestPicturesThatCannotBeAnalysedNeverReachTheProvider(t *testing.T) {
	t.Parallel()
	w, p := withProvider(t, nil, says(jeans()))
	if got := w.send([]byte("not a picture at all"), ""); got.status != http.StatusUnprocessableEntity || got.body["code"] != "INVALID_IMAGE" {
		t.Errorf("garbage: %d %s", got.status, got.raw)
	}
	// Too blurred to classify: "unclear" without asking.
	got := w.send(flatPhoto(t), "")
	if got.status != http.StatusUnprocessableEntity || got.body["code"] != "NOT_A_GARMENT" || got.body["error"] != "Rasm aniq emas. Kiyimni yorug‘ joyda, aniq qilib suratga oling." {
		t.Errorf("blurred: %d %s", got.status, got.raw)
	}
	if len(p.asked()) != 0 || w.analysesToday() != 0 {
		t.Errorf("asked %d times, %d counted", len(p.asked()), w.analysesToday())
	}
	w.nothingLeft("after the refusals", 0, 0, 0, wardrobe.DailyUploads)
}

func TestAPhotoTheProviderRefusesIsInvalidAndCharged(t *testing.T) {
	t.Parallel()
	w, p := withProvider(t, nil, refuses)
	got := w.send(garmentPhoto(t), "")
	if got.status != http.StatusUnprocessableEntity || got.body["code"] != "INVALID_IMAGE" || got.body["error"] != "Bu rasmni tahlil qilib bo‘lmadi. Boshqa rasm tanlang." {
		t.Fatalf("%d %s", got.status, got.raw)
	}
	if len(p.asked()) != 1 || w.analysesToday() != 1 {
		t.Errorf("asked %d times, %d counted", len(p.asked()), w.analysesToday())
	}
	w.nothingLeft("after the refusal", 0, 0, 0, wardrobe.DailyUploads)
}

func TestTheDaysAnalysesAreLimited(t *testing.T) {
	t.Parallel()
	w, p := withProvider(t, nil, says(jeans()))
	limit, _ := quota.Limit(ai.ClothingAnalysis)
	// The day of the database clock in Tashkent: 14:00 there.
	w.exec(`INSERT INTO "AiUsage" ("id","userId","feature","day","count","updatedAt") VALUES ('u1', $1, 'clothing_analysis', ($2::timestamp + interval '5 hours')::date, $3, now())`,
		w.user, w.t0, limit)
	got := w.send(garmentPhoto(t), "")
	if got.status != http.StatusTooManyRequests || got.body["code"] != "AI_QUOTA_EXCEEDED" || got.header.Get("Retry-After") != "36000" {
		t.Fatalf("%d %s %q", got.status, got.raw, got.header.Get("Retry-After"))
	}
	if len(p.asked()) != 0 {
		t.Errorf("asked %d times", len(p.asked()))
	}
	w.nothingLeft("over the limit", 0, 0, 0, wardrobe.DailyUploads)
}

func TestAUserTheRolloutLeavesOutGetsTheMock(t *testing.T) {
	t.Parallel()
	w, p := withProvider(t, &config.AIRollout{Stylist: true, Vision: false, Outfit: true, Percent: 100})
	got := w.send(garmentPhoto(t), "")
	if got.status != http.StatusCreated || got.body["detection"].(map[string]any)["mock"] != true {
		t.Fatalf("%d %s", got.status, got.raw)
	}
	if len(p.asked()) != 0 || w.analysesToday() != 0 {
		t.Errorf("asked %d times, %d counted", len(p.asked()), w.analysesToday())
	}
	if requests := w.events(ai.EventRequest); len(requests) != 1 || requests[0]["outcome"] != "disabled" || requests[0]["reason"] != ai.FeatureDisabled {
		t.Errorf("requests: %v", requests)
	}
}

func TestTheMockStoresItsMetadataAndUsesNoQuota(t *testing.T) {
	t.Parallel()
	w := newUploadWorld(t, apiOptions{})
	got := w.send(garmentPhoto(t), "")
	if got.status != http.StatusCreated || got.body["detection"].(map[string]any)["mock"] != true {
		t.Fatalf("%d %s", got.status, got.raw)
	}
	var provider, model, version, shown string
	var raw *string
	if err := w.pool.QueryRow(context.Background(), `SELECT "analysisProvider", "analysisModel", "analysisVersion", "analysisRawConfidences", "confidences" FROM "WardrobeItem" WHERE "userId" = $1`,
		w.user).Scan(&provider, &model, &version, &raw, &shown); err != nil {
		t.Fatal(err)
	}
	// The mock's confidences keep the Next.js mock's order.
	var keys []string
	for _, part := range strings.Split(strings.Trim(shown, "{}"), ",") {
		key, _, _ := strings.Cut(part, ":")
		keys = append(keys, strings.Trim(key, `"`))
	}
	if strings.Join(keys, ",") != strings.Join(vision.ConfidenceOrder, ",") {
		t.Errorf("the mock's confidences: %s", shown)
	}
	if provider != vision.MockProvider || model != vision.MockModel || version != vision.MockVersion || raw != nil || w.analysesToday() != 0 {
		t.Errorf("stored %s %s %s %v, %d counted", provider, model, version, raw, w.analysesToday())
	}
	if requests := w.events(ai.EventRequest); len(requests) != 1 || requests[0]["outcome"] != "ok" || requests[0]["billable"] != false {
		t.Errorf("requests: %v", requests)
	}
}

// A garment whose colours the model could not tell: no colour to check, the
// colour's confidence is capped only like the others.
func TestAGarmentWithoutColours(t *testing.T) {
	t.Parallel()
	answer := jeans()
	answer["colors"] = []string{}
	w, _ := withProvider(t, nil, says(answer))
	got := w.send(garmentPhoto(t), "")
	if got.status != http.StatusCreated {
		t.Fatalf("%d %s", got.status, got.raw)
	}
	detection := got.body["detection"].(map[string]any)
	if colors, _ := detection["colors"].([]any); len(colors) != 0 || detection["confidence"].(map[string]any)["color"] != 0.69 {
		t.Errorf("detection %v", detection)
	}
}

// The pixels may only lower the colour's confidence: a colour the centre
// of the photo does not show is presented as one to check.
func TestAColourThePixelsContradictIsShownAsOneToCheck(t *testing.T) {
	t.Parallel()
	answer := jeans()
	answer["colors"] = []string{"red"}
	w, _ := withProvider(t, nil, says(answer))
	got := w.send(garmentPhoto(t), "")
	if got.status != http.StatusCreated {
		t.Fatalf("%d %s", got.status, got.raw)
	}
	if c := got.body["detection"].(map[string]any)["confidence"].(map[string]any); c["color"] != 0.35 || c["category"] != 0.69 {
		t.Errorf("confidences %v", c)
	}
}
