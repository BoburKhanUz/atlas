package ai

import (
	"context"
	"errors"
	"fmt"
	"math"
	"time"

	"lookly/internal/config"
	"lookly/internal/platform"
)

// CallRecord is one provider call as the monitoring is told of it: who was
// asked for which feature, how it ended, how long it took. No content.
type CallRecord struct {
	Feature  Feature
	Provider string
	Model    string
	// Outcome is "ok", an error Kind, or "error" for a failure that is not
	// a provider's.
	Outcome  string
	Latency  time.Duration
	Attempts int
	Usage    Usage
	Price    *config.AIPrice
	// HTTPStatus is the status of the failure (0: none).
	HTTPStatus int
}

// CallFields are the fields of the monitoring's "ai.call" event.
type CallFields struct {
	Feature   Feature  `json:"feature"`
	Provider  string   `json:"provider"`
	Model     string   `json:"model"`
	Outcome   string   `json:"outcome"`
	LatencyMs int64    `json:"latencyMs"`
	Attempts  int      `json:"attempts"`
	Retried   bool     `json:"retried"`
	Retry     string   `json:"retry"` // none | succeeded | failed
	Success   bool     `json:"success"`
	ErrorCode string   `json:"errorCode,omitempty"`
	Status    int      `json:"httpStatus,omitempty"`
	Input     *float64 `json:"usageInput,omitempty"`
	Output    *float64 `json:"usageOutput,omitempty"`
	Total     *float64 `json:"usageTotal,omitempty"`
	CostUSD   *float64 `json:"costUsd,omitempty"`
}

// EstimateCostUSD is what a call cost, to a millionth of a dollar; nil
// when the price or either count is not known (never guessed).
func EstimateCostUSD(usage Usage, price *config.AIPrice) *float64 {
	if price == nil || usage.InputTokens == nil || usage.OutputTokens == nil {
		return nil
	}
	// Each product is rounded as a double before the sum, as in JavaScript.
	usd := (float64(*usage.InputTokens*price.InputUSDPerMTok) + float64(*usage.OutputTokens*price.OutputUSDPerMTok)) / 1_000_000
	cost := platform.RoundHalfUp(usd*1e6) / 1e6
	return &cost
}

// Fields are the event's fields for a call.
func (r CallRecord) Fields() CallFields {
	fields := CallFields{
		Feature: r.Feature, Provider: r.Provider, Model: r.Model, Outcome: r.Outcome,
		LatencyMs: int64(math.Max(0, platform.RoundHalfUp(float64(r.Latency)/float64(time.Millisecond)))),
		Attempts:  r.Attempts, Retried: r.Attempts > 1, Retry: "none", Success: r.Outcome == "ok",
		Status: r.HTTPStatus, Input: r.Usage.InputTokens, Output: r.Usage.OutputTokens, Total: r.Usage.TotalTokens,
		CostUSD: EstimateCostUSD(r.Usage, r.Price),
	}
	if r.Attempts > 1 {
		fields.Retry = "failed"
		if fields.Success {
			fields.Retry = "succeeded"
		}
	}
	if !fields.Success {
		fields.ErrorCode = r.Outcome
	}
	return fields
}

// Recorder is told of every provider call (the monitoring).
type Recorder interface {
	RecordCall(ctx context.Context, record CallRecord)
}

// Client asks the configured providers: the route of each text feature,
// the vision provider. Every call has its attempt's time limit, at most one
// retry, and is told to the recorder.
type Client struct {
	text     map[Feature]TextProvider
	routes   map[Feature]config.AIRoute
	vision   VisionProvider
	settings config.AIVision
	recorder Recorder
	retrier  retrier
	now      func() time.Time
}

// Addresses are where the providers are reached.
type Addresses struct{ Gemini, OpenAI string }

// DefaultAddresses are the providers' own.
var DefaultAddresses = Addresses{Gemini: GeminiURL, OpenAI: OpenAIURL}

// NewClient builds the providers the configuration names. It never
// substitutes one provider for another.
func NewClient(cfg config.AI, addresses Addresses, recorder Recorder) (*Client, error) {
	text := func(role string, route config.AIRoute) (TextProvider, error) {
		switch route.Provider {
		case config.AIMock:
			return Mock{}, nil
		case config.AIGemini:
			return NewGemini(route.APIKey, route.Model, addresses.Gemini)
		case config.AIOpenAI:
			return NewOpenAI(route.APIKey, route.Model, addresses.OpenAI)
		}
		return nil, fmt.Errorf("ai: %s: unknown provider %q", role, route.Provider)
	}
	stylist, err := text("the stylist", cfg.Stylist)
	if err != nil {
		return nil, err
	}
	outfit, err := text("the outfit explanation", cfg.Outfit)
	if err != nil {
		return nil, err
	}
	var vision VisionProvider
	switch cfg.Vision.Provider {
	case config.AIMock:
		vision = Mock{}
	case config.AIGemini:
		vision, err = NewGemini(cfg.Vision.APIKey, cfg.Vision.Model, addresses.Gemini)
	case config.AIOpenAI:
		vision, err = NewOpenAI(cfg.Vision.APIKey, cfg.Vision.Model, addresses.OpenAI)
	default:
		err = fmt.Errorf("ai: the garment analysis: unknown provider %q", cfg.Vision.Provider)
	}
	if err != nil {
		return nil, err
	}
	return &Client{
		text:   map[Feature]TextProvider{StylistChat: stylist, OutfitExplanation: outfit},
		routes: map[Feature]config.AIRoute{StylistChat: cfg.Stylist, OutfitExplanation: cfg.Outfit},
		vision: vision, settings: cfg.Vision, recorder: recorder, retrier: defaultRetrier(), now: time.Now,
	}, nil
}

// TextProviderOf says who answers a text feature (its name and model).
func (c *Client) TextProviderOf(feature Feature) (provider, model string) {
	p := c.text[feature]
	return p.Name(), p.Model()
}

// VisionProvider says who analyses pictures (its name and model).
func (c *Client) VisionProvider() (provider, model string) { return c.vision.Name(), c.vision.Model() }

// GenerateText asks the provider of a text feature (StylistChat or
// OutfitExplanation). The error is an *Error, the last attempt's.
func (c *Client) GenerateText(ctx context.Context, feature Feature, request TextRequest) (TextResult, error) {
	provider, ok := c.text[feature]
	if !ok {
		return TextResult{}, fmt.Errorf("ai: %s is not a text feature", feature)
	}
	route := c.routes[feature]
	if request.Timeout == 0 {
		request.Timeout = route.Timeout
	}
	var result TextResult
	err := c.run(ctx, feature, provider.Name(), provider.Model(), route.Price, func() (Usage, error) {
		var err error
		result, err = provider.Generate(ctx, request)
		return result.Metadata.Usage, err
	})
	return result, err
}

// AnalyzeImage asks the vision provider for a feature.
func (c *Client) AnalyzeImage(ctx context.Context, feature Feature, request VisionRequest) (VisionResult, error) {
	if request.Timeout == 0 {
		request.Timeout = c.settings.Timeout
	}
	var result VisionResult
	err := c.run(ctx, feature, c.vision.Name(), c.vision.Model(), c.settings.Price, func() (Usage, error) {
		var err error
		result, err = c.vision.AnalyzeImage(ctx, request)
		return result.Metadata.Usage, err
	})
	return result, err
}

// run makes the attempts and records the call.
func (c *Client) run(ctx context.Context, feature Feature, provider, model string, price *config.AIPrice, attempt func() (Usage, error)) error {
	started := c.now()
	var usage Usage
	attempts, err := c.retrier.do(ctx, func() (err error) {
		usage, err = attempt()
		return err
	})
	record := CallRecord{Feature: feature, Provider: provider, Model: model, Outcome: "ok", Latency: c.now().Sub(started), Attempts: attempts}
	if err != nil {
		record.Outcome = "error"
		var failure *Error
		if errors.As(err, &failure) {
			record.Outcome, record.HTTPStatus = string(failure.Kind), failure.Status
		}
	} else {
		record.Usage, record.Price = usage, price
	}
	c.recorder.RecordCall(ctx, record)
	return err
}
