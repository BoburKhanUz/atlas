package outfits

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"lookly/internal/ai"
	"lookly/internal/config"
	"lookly/internal/engine"
	"lookly/internal/quota"
)

// The optional AI step after the engine, as the Next.js server does it
// (apps/web/src/lib/ai/outfit-intelligence.ts): the engine's candidates are
// the only outfits that can be returned; the model may only reorder them
// and explain the one it selects. Any failure (the mock, the rollout, the
// quota, the provider, an invalid answer after one correction) falls back
// to the engine's order and its own explanations: generation never fails
// because of this step.

// TextClient asks a text model (*ai.Client).
type TextClient interface {
	TextProviderOf(feature ai.Feature) (provider, model string)
	GenerateText(ctx context.Context, feature ai.Feature, request ai.TextRequest) (ai.TextResult, error)
}

// Quotas charge and refund the day's rankings (*quota.Service).
type Quotas interface {
	Charge(ctx context.Context, userID string, feature ai.Feature, provider string) (quota.Charge, error)
	Refund(ctx context.Context, charge quota.Charge, reason string)
}

// RequestMonitor is told what each ranking request gave (*ai.Monitor).
type RequestMonitor interface {
	RecordRequest(ctx context.Context, record ai.RequestRecord)
}

// RankerConfig is what a Ranker works with.
type RankerConfig struct {
	Client  TextClient
	Quotas  Quotas
	Monitor RequestMonitor
	// Route is the outfit explanation's settings (its time limit).
	Route   config.AIRoute
	Rollout config.AIRollout
	Log     *slog.Logger
	// Budget bounds both attempts together, and Attempt one (zero: the
	// Next.js server's 25 s and 15 s).
	Budget, Attempt time.Duration
	// Now is the clock (nil: the real one).
	Now func() time.Time
}

// Ranker ranks and explains generated outfits.
type Ranker struct{ c RankerConfig }

// NewRanker returns the ranker.
func NewRanker(c RankerConfig) *Ranker {
	if c.Budget == 0 {
		c.Budget = engine.RankingBudgetMs * time.Millisecond
	}
	if c.Attempt == 0 {
		c.Attempt = engine.RankingTimeoutMs * time.Millisecond
	}
	if c.Now == nil {
		c.Now = time.Now
	}
	return &Ranker{c: c}
}

// minimumAttempt: an attempt with less time left is not made.
const minimumAttempt = time.Second

// Ranked is an outfit in its place, with its explanation.
type Ranked struct {
	Candidate   engine.Candidate
	Explanation string
}

// Rank orders the engine's candidates (at least one) and explains them.
// fallback is true when the model was not used: the engine's order and
// explanations.
func (r *Ranker) Rank(ctx context.Context, userID string, candidates []engine.Candidate, occasion string, wx *engine.WeatherContext, profile *engine.ColorProfile) (outfits []Ranked, fallback bool) {
	deterministic := func() ([]Ranked, bool) {
		out := make([]Ranked, len(candidates))
		for i, c := range candidates {
			out[i] = Ranked{Candidate: c, Explanation: engine.Explanation(c, occasion, wx)}
		}
		return out, true
	}
	provider, model := r.c.Client.TextProviderOf(ai.OutfitExplanation)
	started := r.c.Now()
	corrected := false
	request := func(outcome, reason string, billable bool) {
		latency := r.c.Now().Sub(started)
		r.c.Monitor.RecordRequest(ctx, ai.RequestRecord{
			Feature: ai.OutfitExplanation, Provider: provider, Model: model, Outcome: outcome, Reason: reason,
			Corrected: &corrected, Billable: billable, Latency: &latency,
		})
	}
	// The rollout: not eligible, the engine stays the authority; no call.
	if eligible, reason := ai.Eligible(ai.OutfitExplanation, userID, r.c.Rollout); !eligible {
		request("disabled", reason, false)
		return deterministic()
	}
	if provider == config.AIMock {
		request("fallback", "mock_provider", false)
		return deterministic()
	}

	charge, err := r.c.Quotas.Charge(ctx, userID, ai.OutfitExplanation, provider)
	if err != nil || !charge.Allowed {
		reason := "quota_exceeded"
		if err != nil {
			reason = "quota_error"
			r.c.Log.ErrorContext(ctx, "outfit quota check failed", "err", err.Error())
		}
		r.c.Log.InfoContext(ctx, "ai.outfit.fallback", "reason", reason)
		request("fallback", reason, false)
		return deterministic()
	}
	fail := func(reason string) ([]Ranked, bool) {
		r.c.Quotas.Refund(ctx, charge, reason)
		r.c.Log.WarnContext(ctx, "ai.outfit.fallback", "reason", reason, "provider", provider, "model", model, "version", engine.RankingVersion)
		request("fallback", reason, false)
		return deterministic()
	}

	refs := engine.RankingRefs(len(candidates))
	schema := &ai.Schema{Name: "outfit_ranking", Schema: engine.RankingSchema(len(candidates))}
	deadline := started.Add(r.c.Budget)
	budget, cancel := context.WithTimeout(ctx, r.c.Budget)
	defer cancel()
	attempt := min(r.c.Attempt, r.c.Route.Timeout)
	temperature, tokens := 0.3, 400
	messages := []ai.Message{
		{Role: "system", Content: engine.RankingSystemPrompt},
		{Role: "system", Content: engine.RankingContext(candidates, occasion, wx, profile)},
		{Role: "user", Content: engine.RankingUserMessage},
	}
	// call asks the model; ok is false when too little time is left.
	call := func(msgs []ai.Message) (text string, ok bool, err error) {
		remaining := deadline.Sub(r.c.Now()).Truncate(time.Millisecond)
		if remaining < minimumAttempt {
			return "", false, nil
		}
		result, err := r.c.Client.GenerateText(budget, ai.OutfitExplanation, ai.TextRequest{
			Messages: msgs, Temperature: &temperature, MaxOutputTokens: &tokens, JSONSchema: schema, Timeout: min(attempt, remaining),
		})
		return result.Text, true, err
	}
	failure := func(err error) ([]Ranked, bool) {
		var providerErr *ai.Error
		if errors.As(err, &providerErr) {
			return fail("provider_" + string(providerErr.Kind))
		}
		return fail("error")
	}

	text, ok, err := call(messages)
	if err != nil {
		return failure(err)
	}
	if !ok {
		return fail("deadline")
	}
	ranking, explanation, err := engine.InterpretRanking(text, refs)
	if err != nil {
		// One correction attempt, with the same provider.
		corrected = true
		var invalid *engine.InvalidRankingError
		errors.As(err, &invalid)
		correction := append(append([]ai.Message{}, messages...),
			ai.Message{Role: "assistant", Content: text},
			ai.Message{Role: "system", Content: engine.RankingCorrection(invalid.Reason, refs)})
		second, ok, err := call(correction)
		if err != nil {
			return failure(err)
		}
		if !ok {
			return fail("deadline")
		}
		ranking, explanation, err = engine.InterpretRanking(second, refs)
		if err != nil {
			errors.As(err, &invalid)
			return fail("invalid_after_correction_" + invalid.Reason)
		}
	}

	// The order is the model's; its wording reaches the user only when it
	// follows the Uzbek output policy, else the engine's explanation is shown.
	wordingOK := len(engine.ExposedCatalogTerms(explanation)) == 0 && !engine.HasCyrillic(explanation)
	if !wordingOK {
		r.c.Log.InfoContext(ctx, "ai.outfit.explanation_replaced", "reason", "wording_policy", "provider", provider, "model", model)
	}
	request("ok", "", true)
	outfits = make([]Ranked, len(ranking))
	for i, ref := range ranking {
		candidate := candidates[indexOf(refs, ref)]
		explained := engine.Explanation(candidate, occasion, wx)
		if i == 0 && wordingOK {
			explained = explanation
		}
		outfits[i] = Ranked{Candidate: candidate, Explanation: explained}
	}
	return outfits, false
}

func indexOf(refs []string, ref string) int {
	for i, r := range refs {
		if r == ref {
			return i
		}
	}
	return -1 // InterpretRanking let no unknown reference through
}
