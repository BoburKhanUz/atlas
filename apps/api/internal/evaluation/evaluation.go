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
// runners record it, with the provider attempts ("calls", and each one's
// outcome in "attempts"), the logical requests (the first and the
// correction), the tokens, the latency, and the case's "setup": what the
// pipeline made of it before asking a model (the context's references, the
// messages and schema of the first request, the engine's candidates, the
// prepared picture's size), which the harness scores with. "dryRun": true
// makes the setup only, with no call. Two more requests: {"feature":
// "versions"} names the versions of the prompts, the engine and the
// analyses; {"feature": "color", "case": {"image": ...}} analyses a selfie.
// A case with a member this server does not know is refused, as is a request
// that cannot be read ({"refused": reason}); the run goes on.
package evaluation

import (
	"bufio"
	"bytes"
	"cmp"
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
	"lookly/internal/color"
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

// Pictures prepare a picture for a vision model, or a selfie's canvas
// (*imaging.Processor).
type Pictures interface {
	PrepareVision(ctx context.Context, data []byte, maxSide int) (imaging.VisionInput, error)
	Canvas(ctx context.Context, data []byte) (rgb []byte, width, height int, err error)
}

// Counter counts the provider attempts of a run and keeps each one's
// outcome (the client's Recorder).
type Counter struct {
	mu       sync.Mutex
	calls    int
	outcomes []string
}

// RecordCall counts one call's attempts.
func (c *Counter) RecordCall(_ context.Context, record ai.CallRecord) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.calls += record.Attempts
	c.outcomes = append(c.outcomes, record.AttemptOutcomes...)
}

// mark is where a case's attempts start.
func (c *Counter) mark() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.outcomes)
}

// since are the attempts' outcomes after a mark.
func (c *Counter) since(mark int) []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return slices.Clone(c.outcomes[mark:])
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
	// OutfitTimeout is the outfit ranking's (0: OUTFIT_AI_TIMEOUT_MS).
	OutfitTimeout time.Duration
	// VisionDefaults apply where a vision case says nothing.
	VisionDefaults VisionSettings
	// Gate, when set, is the clients' AttemptGate: it speaks on this run's
	// own streams (Run connects it).
	Gate *LineGate
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
	// Attempts are each provider attempt's outcome, in order: "ok" or an
	// error kind.
	Attempts []string `json:"attempts,omitempty"`
	// Setup is what the pipeline made of the case before asking a model.
	Setup any `json:"setup,omitempty"`
}

type request struct {
	Feature string          `json:"feature"`
	Case    json.RawMessage `json:"case"`
	// DryRun makes the case's setup only: no model is asked.
	DryRun bool `json:"dryRun"`
}

// message is a request message as the setup shows it.
type message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// schema is a request's response schema as the setup shows it.
type schema struct {
	Name   string          `json:"name"`
	Schema json.RawMessage `json:"schema"`
}

func messagesOut(in []ai.Message) []message {
	out := make([]message, len(in))
	for i, m := range in {
		out[i] = message{Role: m.Role, Content: m.Content}
	}
	return out
}

// decodeCase reads a case strictly: a member this server does not know is
// refused, so a case the harness changed cannot be read half.
func decodeCase(raw json.RawMessage, into any) error {
	// raw is one JSON value (the request was read whole).
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	return d.Decode(into)
}

// Run answers each request of in on out, in order.
func (r *Runner) Run(ctx context.Context, in io.Reader, out io.Writer) error {
	scanner := bufio.NewScanner(in)
	scanner.Buffer(make([]byte, 0, 1<<20), 64<<20) // a vision case holds its picture
	encoder := json.NewEncoder(out)
	encoder.SetEscapeHTML(false)
	if r.Gate != nil {
		r.Gate.in, r.Gate.out = scanner, encoder
	}
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
		if r.Gate != nil && r.Gate.err != nil {
			return r.Gate.err
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
		if err := decodeCase(req.Case, &c); err != nil {
			return Result{}, fmt.Errorf("not a stylist case: %w", err)
		}
		return r.stylist(ctx, c, req.DryRun), nil
	case "outfit":
		var c OutfitCase
		if err := decodeCase(req.Case, &c); err != nil {
			return Result{}, fmt.Errorf("not an outfit case: %w", err)
		}
		return r.outfit(ctx, c, req.DryRun), nil
	case "vision":
		var c VisionCase
		if err := decodeCase(req.Case, &c); err != nil {
			return Result{}, fmt.Errorf("not a vision case: %w", err)
		}
		return r.vision(ctx, c, req.DryRun)
	case "color":
		var c ColorCase
		if err := decodeCase(req.Case, &c); err != nil {
			return Result{}, fmt.Errorf("not a colour case: %w", err)
		}
		return r.color(ctx, c)
	case "versions":
		return Result{Outcome: Versions{
			Kind: "versions", VisionAnalysis: vision.AnalysisVersion, StylistPrompt: stylist.PromptVersion,
			RankingPrompt: engine.RankingVersion, Engine: engine.Version, ColorAnalysis: color.Version,
		}}, nil
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

// StylistSetup is a stylist case's setup.
type StylistSetup struct {
	// Refs are the context's item references.
	Refs []string `json:"refs"`
	// Messages are the first request's.
	Messages []message `json:"messages"`
	Schema   schema    `json:"schema"`
}

// stylist runs a case as runStylistCase: the engine's candidates (no
// profile), the context, the request without history, the provider, the
// answer validated with one correction for unknown references, the
// references resolved.
func (r *Runner) stylist(ctx context.Context, c StylistCase, dryRun bool) Result {
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
	setup := StylistSetup{Refs: built.Refs, Messages: messagesOut(messages), Schema: schema{Name: calls.request.JSONSchema.Name, Schema: calls.request.JSONSchema.Schema}}
	if dryRun {
		return Result{Provider: provider, Model: model, Setup: setup}
	}
	before, mark := r.Counter.Calls(), r.Counter.mark()

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
		Attempts: r.Counter.since(mark), Setup: setup,
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

// OutfitSetup is an outfit case's setup.
type OutfitSetup struct {
	// Candidates are the engine's outfits, best first (O1, O2, ...).
	Candidates []candidate `json:"candidates"`
	// WeatherProvided: the engine had a weather; ProfileSent: the colour
	// profile was shown to the model; ProfileStrength: how strongly the
	// engine used it (nil: not at all).
	WeatherProvided bool     `json:"weatherProvided"`
	ProfileSent     bool     `json:"profileSent"`
	ProfileStrength *float64 `json:"profileStrength"`
	// Problem says why there are no outfits ("" when there are).
	Problem string `json:"problem"`
	// FallbackExplanation is what the user is shown without the model (the
	// best outfit's deterministic explanation; nil without outfits).
	FallbackExplanation *string   `json:"fallbackExplanation"`
	Messages            []message `json:"messages"`
	Schema              schema    `json:"schema"`
}

// candidate is an engine outfit as the setup shows it: its reference in the
// request (O1, O2, ...), the engine's key, score and signals, its items.
type candidate struct {
	Ref     string             `json:"ref"`
	Key     string             `json:"key"`
	Score   float64            `json:"score"`
	Signals map[string]float64 `json:"signals"`
	Items   []piece            `json:"items"`
}

type piece struct {
	Item item   `json:"item"`
	Role string `json:"role"`
}

// item is a wardrobe item as the case gave it.
type item struct {
	ID           string   `json:"id"`
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

// outfit runs a case as runOutfitCase: the engine's outfits (with the
// colour profile), the ranking request, the provider, one correction for
// any invalid answer.
func (r *Runner) outfit(ctx context.Context, c OutfitCase, dryRun bool) Result {
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
		Temperature: &temperature, MaxOutputTokens: &tokens, Timeout: cmp.Or(r.OutfitTimeout, outfitTimeout),
		JSONSchema: &ai.Schema{Name: "outfit_ranking", Schema: engine.RankingSchema(len(candidates))},
	}}
	provider, model := r.Text.TextProviderOf(ai.OutfitExplanation)
	setup := OutfitSetup{
		Candidates: make([]candidate, len(candidates)), WeatherProvided: result.Weather != nil, ProfileSent: engine.ProfileShown(c.ColorProfile),
		ProfileStrength: engine.ProfileStrength(c.ColorProfile), Problem: string(result.Problem),
		Messages: messagesOut(messages), Schema: schema{Name: calls.request.JSONSchema.Name, Schema: calls.request.JSONSchema.Schema},
	}
	for i, o := range candidates {
		setup.Candidates[i] = candidate{Ref: refs[i], Key: o.Key, Score: o.Score, Signals: o.Signals, Items: make([]piece, len(o.Items))}
		for j, p := range o.Items {
			it := p.Item
			setup.Candidates[i].Items[j] = piece{Role: p.Role, Item: item{
				ID: it.ID, Category: it.Category, Subcategory: it.Subcategory, Colors: it.Colors, Pattern: it.Pattern, Material: it.Material,
				SleeveLength: it.SleeveLength, Fit: it.Fit, Style: it.Style, Season: it.Season, Gender: it.Gender, Formality: it.Formality,
			}}
		}
	}
	if len(candidates) > 0 {
		explanation := engine.Explanation(candidates[0], c.Occasion, result.Weather)
		setup.FallbackExplanation = &explanation
	}
	n := len(candidates)
	if dryRun {
		return Result{Provider: provider, Model: model, Candidates: &n, Setup: setup}
	}
	before, mark := r.Counter.Calls(), r.Counter.mark()

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
	return Result{
		Outcome: outcome, Provider: provider, Model: model, Calls: r.Counter.Calls() - before, Requests: calls.requests,
		InputTokens: calls.inputTokens, OutputTokens: calls.outputTokens, LatencyMs: time.Since(started).Milliseconds(), Candidates: &n,
		Attempts: r.Counter.since(mark), Setup: setup,
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

// VisionSetup is a vision case's setup: the prepared picture (nil when it
// could not be prepared) and the response schema.
type VisionSetup struct {
	Picture *preparedPicture `json:"picture"`
	Schema  schema           `json:"schema"`
}

type preparedPicture struct {
	MimeType string `json:"mimeType"`
	Width    int    `json:"width"`
	Height   int    `json:"height"`
}

func (r *Runner) vision(ctx context.Context, c VisionCase, dryRun bool) (Result, error) {
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
	before, mark := r.Counter.Calls(), r.Counter.mark()
	options := ai.VisionOptions{GeminiMediaResolution: c.GeminiMediaResolution, GeminiThinkingLevel: c.GeminiThinkingLevel, OpenAIDetail: c.OpenAIDetail}
	setup := VisionSetup{Schema: schema{Name: "garment_analysis", Schema: vision.Schema}}
	picture, prepareErr := r.Pictures.PrepareVision(ctx, image, maxSide)
	if prepareErr == nil {
		setup.Picture = &preparedPicture{MimeType: "image/jpeg", Width: picture.Width, Height: picture.Height}
	}
	if dryRun {
		return Result{Provider: provider, Model: model, Setup: setup}, nil
	}
	var usage ai.Usage
	outcome := func() any {
		if prepareErr != nil {
			return errorOutcome(prepareErr)
		}
		if r.MaxCalls > 0 && r.Counter.Calls()+2 > r.MaxCalls {
			return errorOutcome(errCallCap)
		}
		// The server's own request; no blur pre-check, as in the harness's
		// runner: the evaluation scores what the model makes of the picture.
		request := vision.GarmentRequest(picture, maxSide, options)
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
		Attempts: r.Counter.since(mark), Setup: setup,
	}, nil
}

// ─── Versions and the colour analysis ──────────────────────────────────────

// Versions name what produced a result: the prompts', the engine's and the
// analyses' versions.
type Versions struct {
	Kind           string `json:"kind"`
	VisionAnalysis string `json:"visionAnalysis"`
	StylistPrompt  string `json:"stylistPrompt"`
	RankingPrompt  string `json:"rankingPrompt"`
	Engine         string `json:"engine"`
	ColorAnalysis  string `json:"colorAnalysis"`
}

// ColorCase is a selfie, in base64.
type ColorCase struct {
	Image string `json:"image"`
}

// color analyses a selfie as the colour profile does: the canvas, then the
// analysis (no model, no call). Outcomes: "profile" with the analysis,
// "rejected_quality" with the reason, "rejected_skin", or an error
// ("picture_size" for a picture the upload refuses by its size,
// "unreadable_picture" for one it cannot read).
func (r *Runner) color(ctx context.Context, c ColorCase) (Result, error) {
	image, err := base64.StdEncoding.DecodeString(c.Image)
	if err != nil {
		return Result{}, errors.New("the picture is not base64")
	}
	started := time.Now()
	outcome := func() any {
		rgb, width, height, err := r.Pictures.Canvas(ctx, image)
		switch {
		case errors.Is(err, imaging.ErrDimensions):
			return map[string]any{"kind": "error", "error": "picture_size"}
		case err != nil:
			return map[string]any{"kind": "error", "error": "unreadable_picture"}
		}
		result, err := color.AnalyzeCanvas(color.Canvas{Width: width, Height: height, RGB: rgb})
		var quality *color.PhotoQualityError
		switch {
		case errors.As(err, &quality):
			return map[string]any{"kind": "rejected_quality", "reason": quality.Reason}
		case errors.Is(err, color.ErrSkinNotVisible):
			return map[string]any{"kind": "rejected_skin"}
		case err != nil:
			return map[string]any{"kind": "error", "error": "unexpected"}
		}
		return map[string]any{"kind": "profile", "profile": result}
	}()
	return Result{Outcome: outcome, Provider: color.Provider, Model: color.Version, LatencyMs: time.Since(started).Milliseconds()}, nil
}
