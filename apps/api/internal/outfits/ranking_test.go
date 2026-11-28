package outfits_test

import (
	"context"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"

	"lookly/internal/ai"
	"lookly/internal/config"
	"lookly/internal/engine"
	"lookly/internal/outfits"
	"lookly/internal/quota"
)

// slowModel answers every request after a delay with text no ranking reads.
type slowModel struct {
	delay time.Duration
	mu    sync.Mutex
	asked int
}

func (m *slowModel) TextProviderOf(ai.Feature) (string, string) { return config.AIOpenAI, "gpt-test" }

func (m *slowModel) GenerateText(ctx context.Context, _ ai.Feature, _ ai.TextRequest) (ai.TextResult, error) {
	m.mu.Lock()
	m.asked++
	m.mu.Unlock()
	select {
	case <-time.After(m.delay):
		return ai.TextResult{Text: "not a ranking"}, nil
	case <-ctx.Done():
		return ai.TextResult{}, &ai.Error{Kind: ai.Cancelled, Provider: config.AIOpenAI}
	}
}

type allowAll struct{}

func (allowAll) Charge(context.Context, string, ai.Feature, string) (quota.Charge, error) {
	return quota.Charge{Allowed: true}, nil
}
func (allowAll) Refund(context.Context, quota.Charge, string) {}

type records struct {
	mu   sync.Mutex
	list []ai.RequestRecord
}

func (r *records) RecordRequest(_ context.Context, record ai.RequestRecord) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.list = append(r.list, record)
}

func ranker(model *slowModel, seen *records, budget time.Duration) *outfits.Ranker {
	return outfits.NewRanker(outfits.RankerConfig{
		Client: model, Quotas: allowAll{}, Monitor: seen,
		Route:   config.AIRoute{Provider: config.AIOpenAI, Model: "gpt-test", Timeout: 15 * time.Second},
		Rollout: config.AIRollout{Outfit: true, Percent: 100},
		Log:     slog.New(slog.NewTextHandler(io.Discard, nil)),
		Budget:  budget, Attempt: 15 * time.Second,
	})
}

var candidates = []engine.Candidate{{TempID: "c1", Key: "c1", MainKey: "c1"}}

// The correction is not tried when the request's own time, shorter than the
// ranking's budget, leaves less than a second: the engine's answer, and the
// monitoring says "deadline".
func TestTheRequestsDeadlineBoundsTheCorrection(t *testing.T) {
	t.Parallel()
	model, seen := &slowModel{delay: 700 * time.Millisecond}, &records{}
	ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	defer cancel()
	_, fallback := ranker(model, seen, 25*time.Second).Rank(ctx, "u1", candidates, "casual", nil, nil)
	if !fallback || model.asked != 1 {
		t.Fatalf("fallback %v, asked %d times; want the engine's answer after one call", fallback, model.asked)
	}
	if len(seen.list) != 1 || seen.list[0].Reason != "deadline" || seen.list[0].Corrected == nil || !*seen.list[0].Corrected {
		t.Fatalf("records: %+v", seen.list)
	}
}

// The request's time running out during a call is "deadline" too, not the
// interrupted call's own outcome.
func TestTheRequestsDeadlineDuringACallIsTheReason(t *testing.T) {
	t.Parallel()
	model, seen := &slowModel{delay: 5 * time.Second}, &records{}
	ctx, cancel := context.WithTimeout(context.Background(), 1200*time.Millisecond)
	defer cancel()
	_, fallback := ranker(model, seen, 25*time.Second).Rank(ctx, "u1", candidates, "casual", nil, nil)
	if !fallback || len(seen.list) != 1 || seen.list[0].Reason != "deadline" {
		t.Fatalf("fallback %v, records %+v", fallback, seen.list)
	}
}

// A request given up by its caller (not its time) stays a cancellation.
func TestACancelledRequestIsNotADeadline(t *testing.T) {
	t.Parallel()
	model, seen := &slowModel{delay: 5 * time.Second}, &records{}
	ctx, cancel := context.WithCancel(context.Background())
	time.AfterFunc(300*time.Millisecond, cancel)
	_, fallback := ranker(model, seen, 25*time.Second).Rank(ctx, "u1", candidates, "casual", nil, nil)
	if !fallback || len(seen.list) != 1 || seen.list[0].Reason != "provider_cancelled" {
		t.Fatalf("fallback %v, records %+v", fallback, seen.list)
	}
}
