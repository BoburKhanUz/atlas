//go:build integration

package httpapi_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"lookly/internal/ai"
	"lookly/internal/config"
	"lookly/internal/engine"
	"lookly/internal/quota"
)

// rankingWorld is a server whose outfit ranking asks a stand-in of OpenAI,
// with a user and the closet stored.
type rankingWorld struct {
	*api
	m        mobileSession
	user     string
	provider *provider
	wardrobe []engine.Item
}

type rankingOptions struct {
	rollout *config.AIRollout
	// delay holds every answer of the stand-in this long.
	delay           time.Duration
	budget, attempt time.Duration
}

func newRankingWorld(t *testing.T, o rankingOptions, answers ...func(w http.ResponseWriter)) *rankingWorld {
	t.Helper()
	p := &provider{answers: answers}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body := new(bytes.Buffer)
		_, _ = body.ReadFrom(r.Body)
		p.mu.Lock()
		p.bodies = append(p.bodies, body.Bytes())
		answer := p.answers[min(len(p.bodies)-1, len(p.answers)-1)]
		p.mu.Unlock()
		if o.delay > 0 {
			time.Sleep(o.delay)
		}
		answer(w)
	}))
	t.Cleanup(server.Close)
	settings := testAI(t)
	settings.Outfit = config.AIRoute{Provider: config.AIOpenAI, Model: "gpt-outfit-test", APIKey: "fake-openai-key-never-shown", Timeout: 5 * time.Second, Source: "AI_OUTFIT"}
	if o.rollout != nil {
		settings.Rollout = *o.rollout
	}
	a := newAPI(t, apiOptions{ai: &settings, aiAt: ai.Addresses{Gemini: "http://127.0.0.1:1", OpenAI: server.URL}, rankingBudget: o.budget, rankingAttempt: o.attempt})
	m := a.mobileRegister(nil)
	w := &rankingWorld{api: a, m: m, user: a.userID(m.email), provider: p}
	for _, row := range closet() {
		a.insertItem(w.user, row)
	}
	w.wardrobe = itemsOf(t, closet())
	return w
}

// engineAnswer is the answer the engine alone gives for a date (three
// outfits of the closet).
func (w *rankingWorld) engineAnswer() map[string]any {
	w.t.Helper()
	return expectation(w.t, engine.Input{Wardrobe: w.wardrobe, Occasion: "date"}, "date", nil, nil)
}

func (w *rankingWorld) generate() answer {
	w.t.Helper()
	got := w.do(generateCall(w.m, map[string]any{"occasion": "date"}))
	if got.status != http.StatusOK {
		w.t.Fatalf("generate: %d %s", got.status, got.raw)
	}
	return got
}

func (w *rankingWorld) rankingsToday() int {
	w.t.Helper()
	return query[int](w.api, `SELECT coalesce(sum("count"), 0)::int FROM "AiUsage" WHERE "userId" = $1 AND "feature" = 'outfit_explanation'`, w.user)
}

func (w *rankingWorld) events(event string) []map[string]any {
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

// ranks answers with a ranking and an explanation.
func ranks(ranking []string, explanation string) func(w http.ResponseWriter) {
	return says(map[string]any{"selectedCandidate": ranking[0], "ranking": ranking, "explanation": explanation, "needsMoreInfo": false})
}

// saysText answers with the model's text as it is.
func saysText(text string) func(w http.ResponseWriter) {
	body, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"content": text}}}})
	return func(w http.ResponseWriter) { _, _ = w.Write(body) }
}

// reordered is the engine's answer in the model's order, the first
// explained by the model.
func reordered(want map[string]any, order []int, explanation string) map[string]any {
	outfits := want["outfits"].([]any)
	var out []any
	for _, i := range order {
		o := map[string]any{}
		for k, v := range outfits[i].(map[string]any) {
			o[k] = v
		}
		out = append(out, o)
	}
	if explanation != "" {
		out[0].(map[string]any)["explanation"] = explanation
	}
	want["outfits"], want["fallback"] = out, false
	return want
}

func (w *rankingWorld) answered(got answer, want map[string]any) {
	w.t.Helper()
	encoded, _ := json.Marshal(want)
	var expected map[string]any
	_ = json.Unmarshal(encoded, &expected)
	if !jsonEqual(got.body, expected) {
		w.t.Fatalf("generate:\n got %s\nwant %s", got.raw, encoded)
	}
}

func jsonEqual(a, b any) bool {
	x, _ := json.Marshal(a)
	y, _ := json.Marshal(b)
	return bytes.Equal(x, y)
}

const modelExplanation = "Oq futbolka va bej shim uchrashuvga tinch va toza ko‘rinish beradi."

func TestAProviderReordersAndExplainsTheOutfitsOnceCharged(t *testing.T) {
	t.Parallel()
	w := newRankingWorld(t, rankingOptions{}, ranks([]string{"O3", "O1", "O2"}, "  "+modelExplanation+"\n"))
	if n := len(w.engineAnswer()["outfits"].([]any)); n != 3 {
		t.Fatalf("the closet gives %d outfits", n)
	}
	w.answered(w.generate(), reordered(w.engineAnswer(), []int{2, 0, 1}, modelExplanation))
	if w.rankingsToday() != 1 {
		t.Errorf("%d rankings counted", w.rankingsToday())
	}
	sent := w.provider.asked()
	if len(sent) != 1 {
		t.Fatalf("asked %d times", len(sent))
	}
	var request struct {
		Messages       []struct{ Role, Content string } `json:"messages"`
		Temperature    float64                          `json:"temperature"`
		ResponseFormat struct {
			JSONSchema struct {
				Name string `json:"name"`
			} `json:"json_schema"`
		} `json:"response_format"`
	}
	if err := json.Unmarshal(sent[0], &request); err != nil {
		t.Fatal(err)
	}
	if len(request.Messages) != 3 || request.Messages[0].Content != engine.RankingSystemPrompt || request.Messages[2].Content != engine.RankingUserMessage ||
		!strings.HasPrefix(request.Messages[1].Content, "CONTEXT (") || request.Temperature != 0.3 || request.ResponseFormat.JSONSchema.Name != "outfit_ranking" {
		t.Errorf("the request: %s", sent[0])
	}
	// The model sees references, never the items' ids.
	for _, id := range []string{"c-tee", "c-jeans", "c-sneakers", w.user} {
		if bytes.Contains(sent[0], []byte(id)) {
			t.Errorf("the request names %s", id)
		}
	}
	if requests := w.events(ai.EventRequest); len(requests) != 1 || requests[0]["outcome"] != "ok" || requests[0]["billable"] != true || requests[0]["corrected"] != false {
		t.Errorf("requests: %v", requests)
	}
}

func TestAnInvalidAnswerGetsOneCorrection(t *testing.T) {
	t.Parallel()
	w := newRankingWorld(t, rankingOptions{}, ranks([]string{"O2", "O3", "O1"}, "O2 eng yaxshisi."), ranks([]string{"O2", "O3", "O1"}, modelExplanation))
	w.answered(w.generate(), reordered(w.engineAnswer(), []int{1, 2, 0}, modelExplanation))
	sent := w.provider.asked()
	// The model's answer is sent back as the assistant's, with the reason.
	if len(sent) != 2 || !bytes.Contains(sent[1], []byte(`{"role":"assistant","content":"{\"explanation\":\"O2 eng yaxshisi.\"`)) ||
		!bytes.Contains(sent[1], []byte("Your previous answer was invalid (reference_in_explanation). Valid references: O1, O2, O3.")) {
		t.Fatalf("asked %d times; the correction: %s", len(sent), sent[len(sent)-1])
	}
	if requests := w.events(ai.EventRequest); len(requests) != 1 || requests[0]["outcome"] != "ok" || requests[0]["corrected"] != true {
		t.Errorf("requests: %v", requests)
	}
	if w.rankingsToday() != 1 {
		t.Errorf("%d counted", w.rankingsToday())
	}
}

func TestAFailureFallsBackToTheEngineAndCostsNothing(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		name    string
		answers []func(w http.ResponseWriter)
		reason  string
		asked   int
	}{
		{"the provider fails", []func(w http.ResponseWriter){failsWith(500)}, "provider_unavailable", 2},
		{"invalid twice", []func(w http.ResponseWriter){saysText(`{"selectedCandidate":"O1"}`)}, "invalid_after_correction_schema", 2},
		{"the provider refuses", []func(w http.ResponseWriter){refuses}, "provider_content_filtered", 1},
		// With a schema, an answer that is no JSON is the adapter's malformed answer.
		{"an answer that is no JSON", []func(w http.ResponseWriter){saysText("Menimcha O2 eng yaxshisi")}, "provider_malformed_response", 1},
		{"the selection is not first", []func(w http.ResponseWriter){says(map[string]any{"selectedCandidate": "O1", "ranking": []string{"O2", "O1", "O3"}, "explanation": "Mos.", "needsMoreInfo": false})}, "invalid_after_correction_selected_not_first", 2},
	} {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			w := newRankingWorld(t, rankingOptions{}, c.answers...)
			w.answered(w.generate(), w.engineAnswer())
			if len(w.provider.asked()) != c.asked || w.rankingsToday() != 0 {
				t.Errorf("asked %d times, %d counted", len(w.provider.asked()), w.rankingsToday())
			}
			if requests := w.events(ai.EventRequest); len(requests) != 1 || requests[0]["outcome"] != "fallback" || requests[0]["reason"] != c.reason {
				t.Errorf("requests: %v", requests)
			}
			if quotas := w.events(ai.EventQuota); len(quotas) != 2 || quotas[1]["action"] != "refunded" || quotas[1]["reason"] != c.reason {
				t.Errorf("quota events: %v", quotas)
			}
		})
	}
}

// Too little time left for the correction: the engine's answer.
func TestNoAttemptIsMadeWithTooLittleTimeLeft(t *testing.T) {
	t.Parallel()
	w := newRankingWorld(t, rankingOptions{delay: 700 * time.Millisecond, budget: 1500 * time.Millisecond}, saysText(`{"selectedCandidate":"O1"}`))
	w.answered(w.generate(), w.engineAnswer())
	if len(w.provider.asked()) != 1 || w.rankingsToday() != 0 {
		t.Errorf("asked %d times, %d counted", len(w.provider.asked()), w.rankingsToday())
	}
	if requests := w.events(ai.EventRequest); len(requests) != 1 || requests[0]["reason"] != "deadline" || requests[0]["corrected"] != true {
		t.Errorf("requests: %v", requests)
	}
}

// An explanation that does not follow the Uzbek output policy is replaced
// by the engine's; the model's order stays.
func TestWordingAgainstThePolicyIsReplaced(t *testing.T) {
	t.Parallel()
	for name, text := range map[string]string{"English catalog words": "White sneakers bilan kiying.", "Cyrillic": "Белая футболка mos."} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			w := newRankingWorld(t, rankingOptions{}, ranks([]string{"O2", "O1", "O3"}, text))
			w.answered(w.generate(), reordered(w.engineAnswer(), []int{1, 0, 2}, ""))
			if !strings.Contains(w.logs(), "ai.outfit.explanation_replaced") || w.rankingsToday() != 1 {
				t.Errorf("the replacement was not logged, or %d counted", w.rankingsToday())
			}
		})
	}
}

// The day's limit reached: the engine's answer, never a refusal.
func TestTheDaysRankingsAreLimitedWithoutARefusal(t *testing.T) {
	t.Parallel()
	w := newRankingWorld(t, rankingOptions{}, ranks([]string{"O1", "O2", "O3"}, modelExplanation))
	limit, _ := quota.Limit(ai.OutfitExplanation)
	w.exec(`INSERT INTO "AiUsage" ("id","userId","feature","day","count","updatedAt") VALUES ('u1', $1, 'outfit_explanation', (atlas_now() + interval '5 hours')::date, $2, now())`, w.user, limit)
	w.answered(w.generate(), w.engineAnswer())
	if len(w.provider.asked()) != 0 || w.rankingsToday() != limit {
		t.Errorf("asked %d times, %d counted", len(w.provider.asked()), w.rankingsToday())
	}
	if requests := w.events(ai.EventRequest); len(requests) != 1 || requests[0]["reason"] != "quota_exceeded" {
		t.Errorf("requests: %v", requests)
	}
}

func TestTheRolloutAndTheMockKeepTheEnginesAnswer(t *testing.T) {
	t.Parallel()
	w := newRankingWorld(t, rankingOptions{rollout: &config.AIRollout{Stylist: true, Vision: true, Outfit: false, Percent: 100}}, ranks([]string{"O1", "O2", "O3"}, modelExplanation))
	w.answered(w.generate(), w.engineAnswer())
	if len(w.provider.asked()) != 0 || w.rankingsToday() != 0 {
		t.Errorf("asked %d times", len(w.provider.asked()))
	}
	if requests := w.events(ai.EventRequest); len(requests) != 1 || requests[0]["outcome"] != "disabled" || requests[0]["reason"] != ai.FeatureDisabled {
		t.Errorf("requests: %v", requests)
	}

	// The mock provider (a test environment's).
	a := newAPI(t, apiOptions{})
	m := a.mobileRegister(nil)
	for _, row := range closet() {
		a.insertItem(a.userID(m.email), row)
	}
	a.generated(generateCall(m, map[string]any{"occasion": "date"}), expectation(t, engine.Input{Wardrobe: itemsOf(t, closet()), Occasion: "date"}, "date", nil, nil))
	var mockRequests int
	for _, line := range strings.Split(a.logs(), "\n") {
		if strings.Contains(line, `"msg":"ai.request"`) && strings.Contains(line, `"reason":"mock_provider"`) && strings.Contains(line, `"outcome":"fallback"`) {
			mockRequests++
		}
	}
	if mockRequests != 1 {
		t.Errorf("%d mock fallbacks told to the monitoring", mockRequests)
	}
}

// Both attempts together stay within the budget: a retry inside an
// attempt does not outlast it.
func TestTheRankingStaysWithinItsBudget(t *testing.T) {
	t.Parallel()
	w := newRankingWorld(t, rankingOptions{delay: time.Second, budget: 1500 * time.Millisecond}, failsWith(500))
	started := time.Now()
	w.answered(w.generate(), w.engineAnswer())
	if took := time.Since(started); took > 2100*time.Millisecond {
		t.Errorf("the generation took %s with a budget of 1.5 s", took)
	}
	if w.rankingsToday() != 0 {
		t.Errorf("%d counted", w.rankingsToday())
	}
	// The budget ran out during the retry: the monitoring says so, not that
	// the provider's call was given up.
	if requests := w.events(ai.EventRequest); len(requests) != 1 || requests[0]["reason"] != "deadline" {
		t.Errorf("requests: %v", requests)
	}
}

// A colour profile the model may see is in its context.
func TestTheColourProfileIsShownToTheModel(t *testing.T) {
	t.Parallel()
	w := newRankingWorld(t, rankingOptions{}, ranks([]string{"O1", "O2", "O3"}, modelExplanation))
	w.exec(`INSERT INTO "ColorProfile" ("id","userId","undertone","season","contrastLevel","recommendedColors","neutralColors","cautionColors",
		"analysisJson","confidence","undertoneConfidence","createdAt","updatedAt")
		VALUES ('cp-1',$1,'cool','winter','high','["navy"]','["gray"]','["beige"]','{}',0.9,0.8,now(),now())`, w.user)
	w.exec(`UPDATE "UserProfile" SET "colorProfileId" = 'cp-1' WHERE "userId" = $1`, w.user)
	if got := w.generate(); got.body["fallback"] != false {
		t.Fatalf("%s", got.raw)
	}
	if sent := w.provider.asked(); len(sent) != 1 || !bytes.Contains(sent[0], []byte(`\"colorProfile\":{\"season\":\"winter\",\"undertone\":\"cool\"}`)) {
		t.Errorf("the context lacks the colour profile")
	}
}

// A quota that cannot be counted: the engine's answer, not a failure.
func TestAQuotaThatCannotBeCountedFallsBack(t *testing.T) {
	t.Parallel()
	w := newRankingWorld(t, rankingOptions{}, ranks([]string{"O1", "O2", "O3"}, modelExplanation))
	w.exec(`ALTER TABLE "AiUsage" RENAME TO "AiUsageGone"`)
	w.answered(w.generate(), w.engineAnswer())
	if len(w.provider.asked()) != 0 {
		t.Errorf("asked %d times", len(w.provider.asked()))
	}
	if requests := w.events(ai.EventRequest); len(requests) != 1 || requests[0]["reason"] != "quota_error" {
		t.Errorf("requests: %v", requests)
	}
}
