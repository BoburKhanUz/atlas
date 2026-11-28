package vision

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"lookly/internal/ai"
	"lookly/internal/config"
	"lookly/internal/imaging"
	"lookly/internal/quota"
)

// Garment analysis of an upload, as the Next.js server does it
// (apps/web/src/lib/ai/vision-service.ts): the development mock for a user
// the rollout leaves out or when the vision provider is the mock; else the
// prepared picture, the blur check, the day's quota, the provider, the
// validation of its answer and the colour check. A failure never invents
// attributes: it is a *Failure, and the upload stores nothing.

// The kinds of Failure.
const (
	// AIUnavailable: the provider failed or broke the contract; the quota
	// unit was given back. Try again later.
	AIUnavailable = "ai_unavailable"
	// QuotaExceeded: today's analyses are used up.
	QuotaExceeded = "quota_exceeded"
	// NotAGarment: the photo is not one clearly visible garment (Subject
	// says what it is).
	NotAGarment = "not_a_garment"
	// ImageRejected: the picture could not be prepared, or the provider
	// refused it.
	ImageRejected = "image_rejected"
)

// Failure is an analysis that gave no attributes.
type Failure struct {
	Kind string
	// Subject: for NotAGarment, multiple_garments, no_garment or unclear.
	Subject string
	// RetryAfter: for QuotaExceeded, the time until the next day.
	RetryAfter time.Duration
}

func (f *Failure) Error() string {
	if f.Subject != "" {
		return "vision: garment analysis failed: " + f.Kind + " (" + f.Subject + ")"
	}
	return "vision: garment analysis failed: " + f.Kind
}

// VisionClient asks the vision provider (*ai.Client).
type VisionClient interface {
	VisionProvider() (provider, model string)
	AnalyzeImage(ctx context.Context, feature ai.Feature, request ai.VisionRequest) (ai.VisionResult, error)
}

// Quotas charge and refund the day's analyses (*quota.Service).
type Quotas interface {
	Charge(ctx context.Context, userID string, feature ai.Feature, provider string) (quota.Charge, error)
	Refund(ctx context.Context, charge quota.Charge, reason string)
}

// Pictures prepares a picture for a model (*imaging.Processor).
type Pictures interface {
	PrepareVision(ctx context.Context, data []byte, maxSide int) (imaging.VisionInput, error)
}

// Monitor is told every call and every request (*ai.Monitor).
type Monitor interface {
	RecordCall(ctx context.Context, record ai.CallRecord)
	RecordRequest(ctx context.Context, record ai.RequestRecord)
}

// AnalyzerConfig is what an Analyzer works with.
type AnalyzerConfig struct {
	Client   VisionClient
	Quotas   Quotas
	Pictures Pictures
	Monitor  Monitor
	Settings config.AIVision
	Rollout  config.AIRollout
	Log      *slog.Logger
}

// Analyzer analyses uploaded garments.
type Analyzer struct {
	c AnalyzerConfig
}

// NewAnalyzer returns the analyzer.
func NewAnalyzer(c AnalyzerConfig) *Analyzer { return &Analyzer{c: c} }

// Request is one picture to analyse.
type Request struct {
	UserID string
	// File is the upload as it was sent.
	File []byte
	// Sample and HintName are what the mock reads (imaging.Variants.Sample,
	// the file's name). A provider is never sent the name.
	Sample   []byte
	HintName string
}

// Analysis is what is stored with the item.
type Analysis struct {
	Detection                Detection
	Provider, Model, Version string
	// RawConfidences are the model's own confidences, unchanged (nil for
	// the mock).
	RawConfidences map[string]float64
}

// Analyze analyses a picture. The refusals are *Failure; imaging.ErrBusy
// when no processing slot came free in time; any other error is the
// server's (a quota that could not be counted, an unexpected failure).
func (a *Analyzer) Analyze(ctx context.Context, r Request) (Analysis, error) {
	provider, _ := a.c.Client.VisionProvider()
	if eligible, reason := ai.Eligible(ai.ClothingAnalysis, r.UserID, a.c.Rollout); !eligible {
		return a.mock(ctx, r, reason), nil
	}
	if provider == config.AIMock {
		return a.mock(ctx, r, ""), nil
	}
	return a.withProvider(ctx, r, provider)
}

// Replayed tells the monitoring that a request was answered from an
// earlier one: no analysis, no charge.
func (a *Analyzer) Replayed(ctx context.Context) {
	provider, _ := a.c.Client.VisionProvider()
	a.c.Monitor.RecordRequest(ctx, ai.RequestRecord{Feature: ai.ClothingAnalysis, Provider: provider, Outcome: "replay"})
}

// mock is the development mock's analysis; disabled is why the rollout
// left the user out ("" when it did not).
func (a *Analyzer) mock(ctx context.Context, r Request, disabled string) Analysis {
	started := time.Now()
	detection := Mock(r.Sample, r.HintName)
	latency := time.Since(started)
	a.c.Monitor.RecordCall(ctx, ai.CallRecord{
		Feature: ai.ClothingAnalysis, Provider: MockProvider, Model: MockModel, Outcome: "ok", Latency: latency, Attempts: 1,
	})
	outcome := "ok"
	if disabled != "" {
		outcome = "disabled"
	}
	a.c.Monitor.RecordRequest(ctx, ai.RequestRecord{
		Feature: ai.ClothingAnalysis, Provider: MockProvider, Model: MockModel, Outcome: outcome, Reason: disabled, Latency: &latency,
	})
	return Analysis{Detection: detection, Provider: MockProvider, Model: MockModel, Version: MockVersion}
}

func (a *Analyzer) withProvider(ctx context.Context, r Request, provider string) (Analysis, error) {
	started := time.Now()
	settings := a.c.Settings
	request := func(outcome, reason string, billable bool) {
		latency := time.Since(started)
		a.c.Monitor.RecordRequest(ctx, ai.RequestRecord{
			Feature: ai.ClothingAnalysis, Provider: provider, Model: settings.Model, Outcome: outcome, Reason: reason,
			Billable: billable, Latency: &latency,
		})
	}

	// 1. Only the prepared picture leaves the server: upright, without
	// metadata, bounded.
	picture, err := a.c.Pictures.PrepareVision(ctx, r.File, settings.MaxSide)
	if errors.Is(err, imaging.ErrBusy) {
		return Analysis{}, err
	}
	if err != nil {
		request(ImageRejected, "unprocessable_image", false)
		return Analysis{}, &Failure{Kind: ImageRejected}
	}

	// 2. A strongly blurred photo is unclear without asking the model.
	if Sharpness(Canvas{Width: picture.CanvasWidth, Height: picture.CanvasHeight, RGB: picture.Canvas}) < MinSharpness {
		request(NotAGarment, "blurry_precheck", false)
		return Analysis{}, &Failure{Kind: NotAGarment, Subject: Unclear}
	}

	// 3. The day's quota, just before the provider. A refund goes to the
	// day that was charged.
	charge, err := a.c.Quotas.Charge(ctx, r.UserID, ai.ClothingAnalysis, provider)
	if err != nil {
		return Analysis{}, err
	}
	if !charge.Allowed {
		request(QuotaExceeded, "", false)
		return Analysis{}, &Failure{Kind: QuotaExceeded, RetryAfter: charge.RetryAfter}
	}

	// 4. The provider (its time limit and the one safe retry are the
	// client's).
	tokens := MaxOutputTokens
	result, err := a.c.Client.AnalyzeImage(ctx, ai.ClothingAnalysis, ai.VisionRequest{
		Image: picture.JPEG, MimeType: "image/jpeg", MaxSide: settings.MaxSide, Instruction: Instruction,
		JSONSchema: &ai.Schema{Name: "garment_analysis", Schema: Schema}, MaxOutputTokens: &tokens,
		Options: ai.VisionOptions{
			GeminiMediaResolution: settings.GeminiMediaResolution, GeminiThinkingLevel: settings.GeminiThinkingLevel,
			OpenAIDetail: settings.OpenAIDetail,
		},
	})
	if err != nil {
		var providerErr *ai.Error
		if !errors.As(err, &providerErr) {
			a.c.Quotas.Refund(ctx, charge, "internal_error")
			request("internal_error", "internal_error", false)
			return Analysis{}, fmt.Errorf("vision: analyse the picture: %w", err)
		}
		if providerErr.Kind == ai.ContentFiltered {
			// The provider looked at the photo and refused it: charged, as
			// a rejection is.
			request(ImageRejected, "content_filtered", true)
			return Analysis{}, &Failure{Kind: ImageRejected}
		}
		reason := "provider_" + string(providerErr.Kind)
		a.c.Quotas.Refund(ctx, charge, reason)
		request(AIUnavailable, reason, false)
		return Analysis{}, &Failure{Kind: AIUnavailable}
	}
	model := result.Metadata.Model

	// 5. The validation: the only way a model's answer reaches the database.
	interpretation, err := Interpret(result.Output)
	if err != nil {
		a.c.Quotas.Refund(ctx, charge, "invalid_output")
		request(AIUnavailable, "invalid_output", false)
		a.c.Log.WarnContext(ctx, "ai.vision.invalid_output", "provider", provider, "model", model, "version", AnalysisVersion, "reason", err.Error())
		return Analysis{}, &Failure{Kind: AIUnavailable}
	}
	if !interpretation.Garment {
		request(NotAGarment, interpretation.Subject, true)
		return Analysis{}, &Failure{Kind: NotAGarment, Subject: interpretation.Subject}
	}

	// 6. The colour check: the pixels may only lower the colour's confidence.
	attributes := interpretation.Attributes
	check := a.checkColor(picture, attributes.Colors)
	a.c.Log.InfoContext(ctx, "ai.vision.result", "provider", provider, "model", model, "version", AnalysisVersion, "colorVerdict", check.Verdict)
	request("ok", "", true)

	return Analysis{
		Detection: Detection{
			Category: attributes.Category, Subcategory: attributes.Subcategory, Colors: attributes.Colors, Pattern: attributes.Pattern,
			Material: attributes.Material, SleeveLength: attributes.SleeveLength, Fit: attributes.Fit, Style: attributes.Style,
			Season: attributes.Season, Gender: attributes.Gender, Formality: attributes.Formality,
			Confidence: PresentConfidences(interpretation.RawConfidence, check.ConfidenceCap),
		},
		Provider: provider, Model: model, Version: AnalysisVersion, RawConfidences: interpretation.RawConfidence,
	}, nil
}

// checkColor checks the primary colour against the prepared picture's
// centre; a centre that cannot be read is weak support.
func (a *Analyzer) checkColor(picture imaging.VisionInput, colors []string) ColorCheck {
	return CheckColor(picture, colors)
}

// CheckColor is the colour check of a prepared picture: the primary colour
// against the picture's centre (the Next.js crossCheckPrimaryColor).
func CheckColor(picture imaging.VisionInput, colors []string) ColorCheck {
	if len(colors) == 0 {
		return JudgeColor("", nil)
	}
	sample, err := imaging.CentreSample(picture.JPEG, CentreOf(picture.Width, picture.Height), CentreSampleSide, CentreSampleSide)
	if err != nil {
		limit := weakMaxConfidence
		return ColorCheck{Verdict: ColorWeak, ConfidenceCap: &limit}
	}
	return JudgeColor(colors[0], ColorShares(sample))
}
