// Package evaluation is what `lookly eval` runs: one case of the AI
// evaluation harness (apps/web/scripts/ai-eval) through this server's
// pipeline, without a database or a quota. The harness keeps its cases, its
// scoring and its reports; it sends each case here and scores what comes
// back, so the pipeline it scores is this one (docs/plan/B6.md,
// "Evaluation").
//
// Protocol: one JSON request per line on the input,
//
//	{"feature": "stylist" | "outfit" | "vision", "case": {...}}
//
// and one JSON result per line on the output: the outcome as the harness's
// runners record it (stylist-eval.ts runStylistCase, outfit-eval.ts
// runOutfitCase, vision-eval.ts runOne), with the provider attempts
// ("calls"), the logical requests (the first and the correction), the
// tokens and the latency. A request that cannot be read is answered
// {"refused": reason}; the run goes on.
package evaluation

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"slices"
	"sync"
	"time"

	"lookly/internal/ai"
	"lookly/internal/engine"
	"lookly/internal/imaging"
	"lookly/internal/stylist"
	"lookly/internal/vision"
)

// CallCap is the error kind of a request refused because it could pass the
// run's cap on provider calls; no provider was asked.
const CallCap = "call_cap"

// The text features' settings in the harness's runners.
const (
	stylistTemperature = 0.7
	outfitTemperature  = 0.3
	outfitMaxTokens    = 400
	// outfitTimeout is the Next.js OUTFIT_AI_TIMEOUT_MS.
	outfitTimeout = 15 * time.Second
)

// TextClient asks a text model (*ai.Client).
type TextClient interface {
	TextProviderOf(feature ai.Feature) (provider, model string)
	GenerateText(ctx context.Context, feature ai.Feature, request ai.TextRequest) (ai.TextResult, error)
}

// VisionClient asks the vision model (*ai.Client).
type VisionClient interface {
	VisionProvider() (provider, model string)
	AnalyzeImage(ctx context.Context, feature ai.Feature, request ai.VisionRequest) (ai.VisionResult, error)
}

// Pictures prepare a picture for a vision model (*imaging.Processor).
type Pictures interface {
	PrepareVision(ctx context.Context, data []byte, maxSide int) (imaging.VisionInput, error)
}

// Counter counts the provider attempts of a run (the client's Recorder).
type Counter struct {
	mu    sync.Mutex
	calls int
}

// RecordCall counts one call's attempts.
func (c *Counter) RecordCall(_ context.Context, record ai.CallRecord) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.calls += record.Attempts
}

// Calls are the attempts so far.
func (c *Counter) Calls() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.calls
}

// Runner runs cases.
type Runner struct {
	Text     TextClient
	Images   VisionClient
	Pictures Pictures
	Counter  *Counter
	// MaxCalls caps the run's provider attempts (0: no cap). A request is
	// made only when even its retry stays within the cap.
	MaxCalls int
	// TextTimeout is one attempt's time limit for the stylist (the
	// harness's AI_LLM_TIMEOUT_MS).
	TextTimeout time.Duration
	// VisionDefaults apply where a vision case says nothing.
	VisionDefaults VisionSettings
}

// VisionSettings are a vision case's defaults.
type VisionSettings struct {
	MaxSide int
	Timeout time.Duration
}

// Result is one case's result.
type Result struct {
	Outcome      any      `json:"outcome"`
	Provider     string   `json:"provider"`
	Model        string   `json:"model"`
	Calls        int      `json:"calls"`
	Requests     int      `json:"requests"`
	InputTokens  *float64 `json:"inputTokens,omitempty"`
	OutputTokens *float64 `json:"outputTokens,omitempty"`
	LatencyMs    int64    `json:"latencyMs"`
	// Candidates is how many outfits the engine gave (outfit cases).
	Candidates *int `json:"candidates,omitempty"`
}

type request struct {
	Feature string          `json:"feature"`
	Case    json.RawMessage `json:"case"`
}

// Run answers each request of in on out, in order.
func (r *Runner) Run(ctx context.Context, in io.Reader, out io.Writer) error {
	scanner := bufio.NewScanner(in)
	scanner.Buffer(make([]byte, 0, 1<<20), 64<<20) // a vision case holds its picture
	encoder := json.NewEncoder(out)
	encoder.SetEscapeHTML(false)
	for scanner.Scan() {
		if len(scanner.Bytes()) == 0 {
			continue
		}
		var answer any
		result, err := r.one(ctx, scanner.Bytes())
		if err != nil {
			answer = map[string]string{"refused": err.Error()}
		} else {
			answer = result
		}
		if err := encoder.Encode(answer); err != nil {
			return fmt.Errorf("evaluation: write a result: %w", err)
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("evaluation: read the requests: %w", err)
	}
	return nil
}

func (r *Runner) one(ctx context.Context, line []byte) (Result, error) {
	var req request
	if err := json.Unmarshal(line, &req); err != nil {
		return Result{}, errors.New("not a JSON request")
	}
	switch req.Feature {
	case "stylist":
		var c StylistCase
		if err := json.Unmarshal(req.Case, &c); err != nil {
			return Result{}, fmt.Errorf("not a stylist case: %w", err)
		}
		return r.stylist(ctx, c), nil
	case "outfit":
		var c OutfitCase
		if err := json.Unmarshal(req.Case, &c); err != nil {
			return Result{}, fmt.Errorf("not an outfit case: %w", err)
		}
		return r.outfit(ctx, c), nil
	case "vision":
		var c VisionCase
		if err := json.Unmarshal(req.Case, &c); err != nil {
			return Result{}, fmt.Errorf("not a vision case: %w", err)
		}
		return r.vision(ctx, c)
	}
	return Result{}, fmt.Errorf("unknown feature %q", req.Feature)
}

// errorOutcome is a failure as the runners record it: the provider's error
// kind, else "unexpected".
func errorOutcome(err error) map[string]any {
	var providerErr *ai.Error
	if errors.As(err, &providerErr) {
		return map[string]any{"kind": "error", "error": string(providerErr.Kind)}
	}
	if errors.Is(err, errCallCap) {
		return map[string]any{"kind": "error", "error": CallCap}
	}
	return map[string]any{"kind": "error", "error": "unexpected"}
}

var errCallCap = errors.New("evaluation: the call cap would be passed")

// textCalls asks a text model for a case, counting its requests and tokens.
type textCalls struct {
	r                         *Runner
	feature                   ai.Feature
	request                   ai.TextRequest
	requests                  int
	inputTokens, outputTokens *float64
}

func add(sum *float64, v *float64) *float64 {
	if v == nil {
		return sum
	}
	total := *v
	if sum != nil {
		total += *sum
	}
	return &total
}

func (t *textCalls) call(ctx context.Context, messages []ai.Message) (string, error) {
	t.requests++
	if t.r.MaxCalls > 0 && t.r.Counter.Calls()+2 > t.r.MaxCalls {
		return "", errCallCap
	}
	req := t.request
	req.Messages = messages
	result, err := t.r.Text.GenerateText(ctx, t.feature, req)
	if err != nil {
		return "", err
	}
	t.inputTokens, t.outputTokens = add(t.inputTokens, result.Metadata.Usage.InputTokens), add(t.outputTokens, result.Metadata.Usage.OutputTokens)
	return result.Text, nil
}

func messagesOf(in []stylist.Message) []ai.Message {
	out := make([]ai.Message, len(in))
	for i, m := range in {
		out[i] = ai.Message{Role: m.Role, Content: m.Content}
	}
	return out
}

// ─── Stylist ────────────────────────────────────────────────────────────────

// StylistCase is a stylist case as the harness writes one (stylist-cases.ts).
type StylistCase struct {
	Wardrobe     []stylist.WardrobeRow `json:"wardrobe"`
	Occasion     string                `json:"occasion"`
	Weather      *stylist.Weather      `json:"weather"`
	Preferences  *stylist.Preferences  `json:"preferences"`
	ColorProfile *stylist.ColorProfile `json:"colorProfile"`
	Message      string                `json:"message"`
	OccasionText *string               `json:"occasionText"`
}

func weatherOf(w *stylist.Weather) *engine.Weather {
	if w == nil {
		return nil
	}
	return &engine.Weather{
		Temperature: &w.Temperature, FeelsLike: &w.FeelsLike, Condition: &w.Condition,
		PrecipitationProbability: &w.PrecipitationProbability, Humidity: &w.Humidity, WindSpeed: &w.WindSpeed, UVIndex: &w.UVIndex,
	}
}

// stylist runs a case as runStylistCase: the engine's candidates (no
// profile), the context, the request without history, the provider, the
// answer validated with one correction for unknown references, the
// references resolved.
func (r *Runner) stylist(ctx context.Context, c StylistCase) Result {
	started := time.Now()
	items := make([]engine.Item, len(c.Wardrobe))
	for i, row := range c.Wardrobe {
		items[i] = row.Item
	}
	top := float64(stylist.OutfitCandidates)
	candidates := engine.Generate(engine.Input{Wardrobe: items, Occasion: c.Occasion, Weather: weatherOf(c.Weather), TopN: &top}).Outfits
	built := stylist.Build(stylist.BuildInput{
		Items: c.Wardrobe, Candidates: candidates, Occasion: c.Occasion, Weather: c.Weather, Preferences: c.Preferences, ColorProfile: c.ColorProfile,
	})
	messages := messagesOf(stylist.Messages(built.Data, nil, c.Message, c.OccasionText))
	temperature, tokens := stylistTemperature, stylist.MaxOutputTokens
	calls := textCalls{r: r, feature: ai.StylistChat, request: ai.TextRequest{
		Temperature: &temperature, MaxOutputTokens: &tokens, Timeout: r.TextTimeout,
		JSONSchema: &ai.Schema{Name: "stylist_answer", Schema: stylist.Schema(built.Refs)},
	}}
	provider, model := r.Text.TextProviderOf(ai.StylistChat)
	before := r.Counter.Calls()

	outcome := func() any {
		first, err := calls.call(ctx, messages)
		if err != nil {
			return errorOutcome(err)
		}
		var firstError any
		answer, err := stylist.Interpret(first, built.Refs)
		if err != nil {
			var invalid *stylist.InvalidOutputError
			if !errors.As(err, &invalid) {
				return errorOutcome(err)
			}
			firstError = invalid.Reason
			if invalid.Reason != stylist.InvalidReference {
				return map[string]any{"kind": "invalid", "firstError": invalid.Reason}
			}
			second, err := calls.call(ctx, append(slices.Clone(messages),
				ai.Message{Role: "assistant", Content: first},
				ai.Message{Role: "system", Content: stylist.Correction(invalid.InvalidRefs, built.Refs)}))
			if err != nil {
				return errorOutcome(err)
			}
			if answer, err = stylist.Interpret(second, built.Refs); err != nil {
				// The runner records the first answer's reason.
				return map[string]any{"kind": "invalid", "firstError": invalid.Reason}
			}
		}
		shown, err := stylist.Resolve(answer.Answer, built.Items)
		if err != nil {
			return errorOutcome(err)
		}
		return map[string]any{
			"kind": "answer", "firstError": firstError, "raw": answer.Answer, "shown": shown,
			"refs": answer.ReferencedItems, "needsMoreInfo": answer.NeedsMoreInfo,
		}
	}()
	return Result{
		Outcome: outcome, Provider: provider, Model: model, Calls: r.Counter.Calls() - before, Requests: calls.requests,
		InputTokens: calls.inputTokens, OutputTokens: calls.outputTokens, LatencyMs: time.Since(started).Milliseconds(),
	}
}

// ─── Outfit ─────────────────────────────────────────────────────────────────

// OutfitCase is an outfit case as the harness writes one (outfit-cases.ts).
type OutfitCase struct {
	Wardrobe     []engine.Item        `json:"wardrobe"`
	Occasion     string               `json:"occasion"`
	Weather      *engine.Weather      `json:"weather"`
	ColorProfile *engine.ColorProfile `json:"colorProfile"`
	TopN         *float64             `json:"topN"`
}

// outfit runs a case as runOutfitCase: the engine's outfits (with the
// colour profile), the ranking request, the provider, one correction for
// any invalid answer.
func (r *Runner) outfit(ctx context.Context, c OutfitCase) Result {
	started := time.Now()
	result := engine.Generate(engine.Input{Wardrobe: c.Wardrobe, Occasion: c.Occasion, Weather: c.Weather, ColorProfile: c.ColorProfile, TopN: c.TopN})
	candidates := result.Outfits
	refs := engine.RankingRefs(len(candidates))
	messages := []ai.Message{
		{Role: "system", Content: engine.RankingSystemPrompt},
		{Role: "system", Content: engine.RankingContext(candidates, c.Occasion, result.Weather, c.ColorProfile)},
		{Role: "user", Content: engine.RankingUserMessage},
	}
	temperature, tokens := outfitTemperature, outfitMaxTokens
	calls := textCalls{r: r, feature: ai.OutfitExplanation, request: ai.TextRequest{
		Temperature: &temperature, MaxOutputTokens: &tokens, Timeout: outfitTimeout,
		JSONSchema: &ai.Schema{Name: "outfit_ranking", Schema: engine.RankingSchema(len(candidates))},
	}}
	provider, model := r.Text.TextProviderOf(ai.OutfitExplanation)
	before := r.Counter.Calls()

	outcome := func() any {
		first, err := calls.call(ctx, messages)
		if err != nil {
			return errorOutcome(err)
		}
		ranking, explanation, err := engine.InterpretRanking(first, refs)
		if err == nil {
			return map[string]any{"kind": "ranked", "firstError": nil, "ranking": ranking, "explanation": explanation}
		}
		var invalid *engine.InvalidRankingError
		if !errors.As(err, &invalid) {
			return errorOutcome(err)
		}
		second, err := calls.call(ctx, append(slices.Clone(messages),
			ai.Message{Role: "assistant", Content: first},
			ai.Message{Role: "system", Content: engine.RankingCorrection(invalid.Reason, refs)}))
		if err != nil {
			return errorOutcome(err)
		}
		ranking, explanation, err = engine.InterpretRanking(second, refs)
		var again *engine.InvalidRankingError
		if errors.As(err, &again) {
			return map[string]any{"kind": "invalid", "firstError": invalid.Reason, "finalError": again.Reason}
		}
		return map[string]any{"kind": "ranked", "firstError": invalid.Reason, "ranking": ranking, "explanation": explanation}
	}()
	n := len(candidates)
	return Result{
		Outcome: outcome, Provider: provider, Model: model, Calls: r.Counter.Calls() - before, Requests: calls.requests,
		InputTokens: calls.inputTokens, OutputTokens: calls.outputTokens, LatencyMs: time.Since(started).Milliseconds(), Candidates: &n,
	}
}

// ─── Vision ─────────────────────────────────────────────────────────────────

// VisionCase is a picture of the vision dataset with the configuration's
// settings (vision-eval.ts runOne).
type VisionCase struct {
	// Image is the picture's bytes, in base64.
	Image                 string `json:"image"`
	MaxSide               int    `json:"maxSide"`
	GeminiMediaResolution string `json:"geminiMediaResolution"`
	GeminiThinkingLevel   string `json:"geminiThinkingLevel"`
	OpenAIDetail          string `json:"openaiDetail"`
	TimeoutMs             int    `json:"timeoutMs"`
}

// attributesBody are a garment's attributes as the harness records them.
type attributesBody struct {
	Category     string   `json:"category"`
	Subcategory  *string  `json:"subcategory"`
	Colors       []string `json:"colors"`
	Pattern      *string  `json:"pattern"`
	Material     *string  `json:"material"`
	SleeveLength *string  `json:"sleeveLength"`
	Fit          *string  `json:"fit"`
	Style        *string  `json:"style"`
	Season       []string `json:"season"`
	Gender       *string  `json:"gender"`
	Formality    *string  `json:"formality"`
}

func (r *Runner) vision(ctx context.Context, c VisionCase) (Result, error) {
	image, err := base64.StdEncoding.DecodeString(c.Image)
	if err != nil {
		return Result{}, errors.New("the picture is not base64")
	}
	maxSide := c.MaxSide
	if maxSide == 0 {
		maxSide = r.VisionDefaults.MaxSide
	}
	timeout := r.VisionDefaults.Timeout
	if c.TimeoutMs > 0 {
		timeout = time.Duration(c.TimeoutMs) * time.Millisecond
	}
	provider, model := r.Images.VisionProvider()
	started := time.Now()
	before := r.Counter.Calls()
	var usage ai.Usage
	outcome := func() any {
		picture, err := r.Pictures.PrepareVision(ctx, image, maxSide)
		if err != nil {
			return errorOutcome(err)
		}
		if r.MaxCalls > 0 && r.Counter.Calls()+2 > r.MaxCalls {
			return errorOutcome(errCallCap)
		}
		// The server's own request; no blur pre-check, as in the harness's
		// runner: the evaluation scores what the model makes of the picture.
		request := vision.GarmentRequest(picture, maxSide, ai.VisionOptions{GeminiMediaResolution: c.GeminiMediaResolution, GeminiThinkingLevel: c.GeminiThinkingLevel, OpenAIDetail: c.OpenAIDetail})
		request.Timeout = timeout
		result, err := r.Images.AnalyzeImage(ctx, ai.ClothingAnalysis, request)
		if err != nil {
			return errorOutcome(err)
		}
		usage = result.Metadata.Usage
		interpretation, err := vision.Interpret(result.Output)
		if err != nil {
			return map[string]any{"kind": "invalid"}
		}
		if !interpretation.Garment {
			return map[string]any{"kind": "rejected", "subject": interpretation.Subject}
		}
		a := interpretation.Attributes
		return map[string]any{
			"kind": "garment",
			"attributes": attributesBody{
				Category: a.Category, Subcategory: a.Subcategory, Colors: a.Colors, Pattern: a.Pattern, Material: a.Material,
				SleeveLength: a.SleeveLength, Fit: a.Fit, Style: a.Style, Season: a.Season, Gender: a.Gender, Formality: a.Formality,
			},
			"rawConfidence": interpretation.RawConfidence,
			"colorVerdict":  vision.CheckColor(picture, a.Colors).Verdict,
		}
	}()
	return Result{
		Outcome: outcome, Provider: provider, Model: model, Calls: r.Counter.Calls() - before, Requests: 1,
		InputTokens: usage.InputTokens, OutputTokens: usage.OutputTokens, LatencyMs: time.Since(started).Milliseconds(),
	}, nil
}
