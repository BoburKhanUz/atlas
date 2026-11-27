// Package quota holds the daily limits of the AI features: how many calls
// of a feature a user may make in a day. The counters live in PostgreSQL
// (the "AiUsage" table, one row per user, feature and day), where the
// Next.js server keeps them too: until the cutover both servers count on
// the same rows.
//
// The day is the calendar day in Uzbekistan (UTC+5), on the database's
// clock. A caller charges before it asks a provider and refunds when the
// provider did no work for the user.
package quota

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"lookly/internal/ai"
	"lookly/internal/platform"
	"lookly/internal/store"
)

// limits are a user's calls per day. The numbers are the owner's decision.
var limits = map[ai.Feature]int32{
	ai.StylistChat:      50,
	ai.ClothingAnalysis: 50,
	ai.ColorAnalysis:    10,
	// One call per generation of outfits.
	ai.OutfitExplanation: 30,
}

// Limit is a feature's calls per user and day; ok is false for a feature
// that has no limit, which is never charged.
func Limit(feature ai.Feature) (limit int, ok bool) {
	l, ok := limits[feature]
	return int(l), ok
}

// refundTimeout bounds a refund, which does not end with its request.
const refundTimeout = 5 * time.Second

// Recorder is told every quota decision (the monitoring's "ai.quota").
type Recorder interface {
	// action: charged, rejected, refunded or store_error.
	RecordQuota(ctx context.Context, feature ai.Feature, provider, action, reason string)
}

// Service charges and refunds.
type Service struct {
	pool    *pgxpool.Pool
	queries *store.Queries
	events  Recorder
	log     *slog.Logger
}

// New returns the service.
func New(pool *pgxpool.Pool, events Recorder, log *slog.Logger) *Service {
	return &Service{pool: pool, queries: store.New(pool), events: events, log: log}
}

// Charge is the answer to a charge. The zero value took nothing.
type Charge struct {
	// Allowed: the call was counted. Otherwise the day's limit is reached
	// and nothing was counted.
	Allowed bool
	// Used is the day's count, with this call when it was allowed.
	Used  int
	Limit int
	// RetryAfter is the time until the next day begins, when the counts
	// start again: at least a second.
	RetryAfter time.Duration

	userID   string
	feature  ai.Feature
	provider string
	day      pgtype.Date
}

// Charge counts one call of the feature for the user, or refuses when the
// user's limit for the day is reached. provider names who will be asked
// (for the monitoring).
func (s *Service) Charge(ctx context.Context, userID string, feature ai.Feature, provider string) (Charge, error) {
	limit, ok := limits[feature]
	if !ok {
		return Charge{}, fmt.Errorf("quota: no limit for feature %q", feature)
	}
	row, err := s.queries.ChargeAIUsage(ctx, store.ChargeAIUsageParams{ID: platform.NewID(), UserID: userID, Feature: string(feature), DayLimit: limit})
	if err != nil {
		s.events.RecordQuota(ctx, feature, provider, "store_error", "consume_failed")
		return Charge{}, fmt.Errorf("quota: charge %s: %w", feature, err)
	}
	charge := Charge{
		Allowed: row.Count > 0, Used: int(row.Count), Limit: int(limit), RetryAfter: time.Duration(row.SecondsUntilNextDay) * time.Second,
		userID: userID, feature: feature, provider: provider, day: row.Day,
	}
	if !charge.Allowed {
		charge.Used = charge.Limit
		s.events.RecordQuota(ctx, feature, provider, "rejected", "")
		return charge, nil
	}
	s.events.RecordQuota(ctx, feature, provider, "charged", "")
	return charge, nil
}

// Refund gives an allowed charge back, to the day it was taken from; reason
// is a code for the monitoring. It never fails and does not end with the
// request: a unit that could not be given back is logged. A charge is
// refunded at most once by its caller; the count never goes below zero.
func (s *Service) Refund(ctx context.Context, charge Charge, reason string) {
	if !charge.Allowed {
		return
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), refundTimeout)
	defer cancel()
	err := s.queries.RefundAIUsage(ctx, store.RefundAIUsageParams{UserId: charge.userID, Feature: string(charge.feature), Day: charge.day})
	if err != nil {
		s.log.ErrorContext(ctx, "ai quota refund failed", "feature", string(charge.feature), "err", err.Error())
		s.events.RecordQuota(ctx, charge.feature, charge.provider, "store_error", "refund_failed")
		return
	}
	s.events.RecordQuota(ctx, charge.feature, charge.provider, "refunded", reason)
}
