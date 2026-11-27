//go:build integration

package quota_test

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"lookly/internal/ai"
	"lookly/internal/dbtest"
	"lookly/internal/golden"
	"lookly/internal/quota"
	"lookly/migrations"
)

// The monitor of the AI events is what the service tells its decisions to.
var _ quota.Recorder = (*ai.Monitor)(nil)

// event is a quota decision as the service reported it.
type event struct{ feature, provider, action, reason string }

type events struct {
	mu  sync.Mutex
	all []event
}

func (e *events) RecordQuota(_ context.Context, feature ai.Feature, provider, action, reason string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.all = append(e.all, event{string(feature), provider, action, reason})
}

// take returns the events since the last take.
func (e *events) take() []event {
	e.mu.Lock()
	defer e.mu.Unlock()
	taken := e.all
	e.all = nil
	return taken
}

type world struct {
	t      *testing.T
	pool   *pgxpool.Pool
	quotas *quota.Service
	events *events
	log    *bytes.Buffer
}

// A moment in the middle of a Tashkent day: 2026-10-07 13:00 there.
var noon = time.Date(2026, 10, 7, 8, 0, 0, 0, time.UTC)

func newWorld(t *testing.T) *world {
	t.Helper()
	pool := dbtest.Empty(t)
	if err := migrations.Apply(context.Background(), pool); err != nil {
		t.Fatal(err)
	}
	dbtest.InstallTestClock(t, pool)
	dbtest.SetClock(t, pool, noon)
	w := &world{t: t, pool: pool, events: &events{}, log: &bytes.Buffer{}}
	w.quotas = quota.New(pool, w.events, slog.New(slog.NewJSONHandler(w.log, nil)))
	return w
}

func (w *world) user(id string) string {
	w.t.Helper()
	if _, err := w.pool.Exec(context.Background(),
		`INSERT INTO "User" ("id","email","passwordHash","updatedAt") VALUES ($1, $1 || '@test.local', 'x', now())`, id); err != nil {
		w.t.Fatal(err)
	}
	return id
}

func (w *world) charge(user string, feature ai.Feature) quota.Charge {
	w.t.Helper()
	charge, err := w.quotas.Charge(context.Background(), user, feature, "gemini")
	if err != nil {
		w.t.Fatalf("charge: %v", err)
	}
	return charge
}

// row is a stored counter.
type row struct {
	Feature, Day string
	Count        int
}

func (w *world) rows(user string) []row {
	w.t.Helper()
	found, err := w.pool.Query(context.Background(),
		`SELECT "feature", to_char("day", 'YYYY-MM-DD'), "count" FROM "AiUsage" WHERE "userId" = $1 ORDER BY "day", "feature"`, user)
	if err != nil {
		w.t.Fatal(err)
	}
	defer found.Close()
	var rows []row
	for found.Next() {
		var r row
		if err := found.Scan(&r.Feature, &r.Day, &r.Count); err != nil {
			w.t.Fatal(err)
		}
		rows = append(rows, r)
	}
	if err := found.Err(); err != nil {
		w.t.Fatal(err)
	}
	return rows
}

func equal[T comparable](t *testing.T, what string, got, want []T) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("%s: got %v, want %v", what, got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("%s: got %v, want %v", what, got, want)
		}
	}
}

func TestTheLimitsAreTheApprovedOnes(t *testing.T) {
	t.Parallel()
	approved := golden.LoadAIMonitoring(t).Limits
	features := []ai.Feature{ai.StylistChat, ai.ClothingAnalysis, ai.ColorAnalysis, ai.OutfitExplanation}
	if len(approved) != len(features) {
		t.Fatalf("the Next.js server limits %d features: %v", len(approved), approved)
	}
	for _, feature := range features {
		limit, ok := quota.Limit(feature)
		if !ok || limit != approved[string(feature)] {
			t.Errorf("%s: %d (%t), approved %d", feature, limit, ok, approved[string(feature)])
		}
	}
	// By hand as well: a changed limit is the owner's decision.
	for feature, want := range map[ai.Feature]int{ai.StylistChat: 50, ai.ClothingAnalysis: 50, ai.ColorAnalysis: 10, ai.OutfitExplanation: 30} {
		if limit, _ := quota.Limit(feature); limit != want {
			t.Errorf("%s: %d, want %d", feature, limit, want)
		}
	}
}

func TestAChargeCountsUpToTheLimitThenRefusesWithoutCounting(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	u := w.user("u1")
	for i := 1; i <= 10; i++ {
		charge := w.charge(u, ai.ColorAnalysis)
		if !charge.Allowed || charge.Used != i || charge.Limit != 10 {
			t.Fatalf("charge %d: %+v", i, charge)
		}
	}
	equal(t, "events", w.events.take(), []event{
		{"color_analysis", "gemini", "charged", ""}, {"color_analysis", "gemini", "charged", ""}, {"color_analysis", "gemini", "charged", ""},
		{"color_analysis", "gemini", "charged", ""}, {"color_analysis", "gemini", "charged", ""}, {"color_analysis", "gemini", "charged", ""},
		{"color_analysis", "gemini", "charged", ""}, {"color_analysis", "gemini", "charged", ""}, {"color_analysis", "gemini", "charged", ""},
		{"color_analysis", "gemini", "charged", ""},
	})
	for range 2 {
		refused := w.charge(u, ai.ColorAnalysis)
		// 13:00 in Tashkent: eleven hours until the next day there.
		if refused.Allowed || refused.Used != 10 || refused.Limit != 10 || refused.RetryAfter != 11*time.Hour {
			t.Fatalf("over the limit: %+v", refused)
		}
	}
	equal(t, "events", w.events.take(), []event{{"color_analysis", "gemini", "rejected", ""}, {"color_analysis", "gemini", "rejected", ""}})
	equal(t, "rows", w.rows(u), []row{{"color_analysis", "2026-10-07", 10}})
}

func TestEightyChargesAtOnceAgainstALimitOfFiftyAllowExactlyFifty(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	u := w.user("u1")
	charges := make([]quota.Charge, 80)
	failures := make([]error, 80)
	var wg sync.WaitGroup
	for i := range charges {
		wg.Go(func() { charges[i], failures[i] = w.quotas.Charge(context.Background(), u, ai.StylistChat, "gemini") })
	}
	wg.Wait()
	used := map[int]bool{}
	refused := 0
	for i, charge := range charges {
		switch {
		case failures[i] != nil:
			t.Fatalf("charge %d: %v", i, failures[i])
		case charge.Allowed:
			used[charge.Used] = true
		default:
			refused++
		}
	}
	// 1 to 50, each once.
	if len(used) != 50 || refused != 30 {
		t.Fatalf("allowed %d different counts, refused %d", len(used), refused)
	}
	equal(t, "rows", w.rows(u), []row{{"stylist_chat", "2026-10-07", 50}})
}

func TestCountsAreSeparatePerUserFeatureAndTashkentDay(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	a, b := w.user("a"), w.user("b")
	dbtest.SetClock(t, w.pool, time.Date(2026, 10, 7, 18, 59, 59, 0, time.UTC)) // 23:59:59 in Tashkent
	w.charge(a, ai.ClothingAnalysis)
	if second := w.charge(a, ai.ClothingAnalysis); second.Used != 2 || second.RetryAfter != time.Second {
		t.Fatalf("the second charge of the day: %+v", second)
	}
	if other := w.charge(a, ai.StylistChat); other.Used != 1 {
		t.Fatalf("another feature: %+v", other)
	}
	if other := w.charge(b, ai.ClothingAnalysis); other.Used != 1 {
		t.Fatalf("another user: %+v", other)
	}
	dbtest.SetClock(t, w.pool, time.Date(2026, 10, 7, 19, 0, 0, 0, time.UTC)) // 00:00 the next day in Tashkent
	if next := w.charge(a, ai.ClothingAnalysis); next.Used != 1 || next.RetryAfter != 24*time.Hour {
		t.Fatalf("the first charge of the next day: %+v", next)
	}
	equal(t, "rows of a", w.rows(a), []row{{"clothing_analysis", "2026-10-07", 2}, {"stylist_chat", "2026-10-07", 1}, {"clothing_analysis", "2026-10-08", 1}})
	equal(t, "rows of b", w.rows(b), []row{{"clothing_analysis", "2026-10-07", 1}})
}

func TestTheQuotaDayIsTheOneOfTheNextJSServer(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	for i, moment := range golden.LoadAIMonitoring(t).Moments {
		u := w.user("m" + string(rune('a'+i)))
		dbtest.SetClock(t, w.pool, moment.At)
		charge := w.charge(u, ai.OutfitExplanation)
		if want := time.Duration(moment.SecondsUntilNextDay) * time.Second; charge.RetryAfter != want {
			t.Errorf("%s: %s until the next day, want %s", moment.At.Format(time.RFC3339Nano), charge.RetryAfter, want)
		}
		equal(t, moment.At.Format(time.RFC3339Nano), w.rows(u), []row{{"outfit_explanation", moment.Day, 1}})
	}
}

func TestARefundGivesTheChargeBackOnceOnItsOwnDayAndNeverBelowZero(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	u := w.user("u1")
	dbtest.SetClock(t, w.pool, time.Date(2026, 10, 7, 18, 59, 59, 0, time.UTC))
	first, second := w.charge(u, ai.StylistChat), w.charge(u, ai.StylistChat)
	w.events.take()

	// The provider failed after midnight: the unit goes back to the day it
	// was taken from, not to the new day's count.
	dbtest.SetClock(t, w.pool, time.Date(2026, 10, 7, 19, 0, 1, 0, time.UTC))
	today := w.charge(u, ai.StylistChat)
	w.events.take()
	w.quotas.Refund(context.Background(), first, "provider_error")
	equal(t, "rows", w.rows(u), []row{{"stylist_chat", "2026-10-07", 1}, {"stylist_chat", "2026-10-08", 1}})
	equal(t, "events", w.events.take(), []event{{"stylist_chat", "gemini", "refunded", "provider_error"}})

	// A request the client left is refunded all the same.
	left, leave := context.WithCancel(context.Background())
	leave()
	w.quotas.Refund(left, second, "cancelled")
	equal(t, "rows", w.rows(u), []row{{"stylist_chat", "2026-10-07", 0}, {"stylist_chat", "2026-10-08", 1}})

	// Never below zero.
	w.quotas.Refund(context.Background(), second, "invalid_output")
	equal(t, "rows", w.rows(u), []row{{"stylist_chat", "2026-10-07", 0}, {"stylist_chat", "2026-10-08", 1}})
	w.quotas.Refund(context.Background(), today, "invalid_output")
	equal(t, "rows", w.rows(u), []row{{"stylist_chat", "2026-10-07", 0}, {"stylist_chat", "2026-10-08", 0}})
	w.events.take()

	// A refused charge took nothing: there is nothing to give back.
	for range 10 {
		w.charge(u, ai.ColorAnalysis)
	}
	refused := w.charge(u, ai.ColorAnalysis)
	w.events.take()
	w.quotas.Refund(context.Background(), refused, "provider_error")
	w.quotas.Refund(context.Background(), quota.Charge{}, "provider_error")
	equal(t, "rows", w.rows(u), []row{{"stylist_chat", "2026-10-07", 0}, {"color_analysis", "2026-10-08", 10}, {"stylist_chat", "2026-10-08", 0}})
	equal(t, "events", w.events.take(), nil)
}

func TestTheCountersHoldCountsOnlyAndGoWithTheAccount(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	u := w.user("u1")
	w.charge(u, ai.StylistChat)
	var id string
	var updated time.Time
	if err := w.pool.QueryRow(context.Background(), `SELECT "id", "updatedAt" FROM "AiUsage" WHERE "userId" = $1`, u).Scan(&id, &updated); err != nil {
		t.Fatal(err)
	}
	// An id of the shape the Next.js server's rows have room for; the time of
	// the database's clock.
	if len(id) != 25 || !updated.Equal(noon) {
		t.Errorf("id %q, updated %s", id, updated)
	}
	// A later charge and a refund say when the counter last changed.
	lastChange := func() time.Time {
		t.Helper()
		var at time.Time
		if err := w.pool.QueryRow(context.Background(), `SELECT "updatedAt" FROM "AiUsage" WHERE "userId" = $1`, u).Scan(&at); err != nil {
			t.Fatal(err)
		}
		return at
	}
	dbtest.SetClock(t, w.pool, noon.Add(time.Hour))
	second := w.charge(u, ai.StylistChat)
	if at := lastChange(); !at.Equal(noon.Add(time.Hour)) {
		t.Errorf("after a second charge: updated %s", at)
	}
	dbtest.SetClock(t, w.pool, noon.Add(2*time.Hour))
	w.quotas.Refund(context.Background(), second, "provider_error")
	if at := lastChange(); !at.Equal(noon.Add(2 * time.Hour)) {
		t.Errorf("after a refund: updated %s", at)
	}
	if _, err := w.pool.Exec(context.Background(), `DELETE FROM "User" WHERE "id" = $1`, u); err != nil {
		t.Fatal(err)
	}
	equal(t, "rows", w.rows(u), nil)
}

func TestAFeatureWithoutALimitIsRefusedNotUnlimited(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	u := w.user("u1")
	if charge, err := w.quotas.Charge(context.Background(), u, ai.Feature("outfit_generation"), "gemini"); err == nil || charge.Allowed {
		t.Fatalf("a feature without a limit was charged: %+v, %v", charge, err)
	}
	equal(t, "rows", w.rows(u), nil)
	equal(t, "events", w.events.take(), nil)
}

func TestAStoreFailureIsReportedAndARefundNeverFails(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	u := w.user("u1")
	charge := w.charge(u, ai.ClothingAnalysis)
	w.events.take()

	gone, leave := context.WithCancel(context.Background())
	leave()
	if refused, err := w.quotas.Charge(gone, u, ai.ClothingAnalysis, "openai"); err == nil || refused.Allowed {
		t.Fatalf("a charge that could not be stored: %+v, %v", refused, err)
	}
	equal(t, "events", w.events.take(), []event{{"clothing_analysis", "openai", "store_error", "consume_failed"}})

	w.pool.Close()
	w.quotas.Refund(context.Background(), charge, "provider_error")
	equal(t, "events", w.events.take(), []event{{"clothing_analysis", "gemini", "store_error", "refund_failed"}})
	// The lost unit is in the log, without the user's id.
	if logged := w.log.String(); strings.Count(logged, "\n") != 1 || !strings.Contains(logged, `"level":"ERROR"`) || !strings.Contains(logged, "refund") || strings.Contains(logged, u) {
		t.Errorf("log: %s", logged)
	}
}
