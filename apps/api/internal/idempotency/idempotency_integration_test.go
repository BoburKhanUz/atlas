//go:build integration

package idempotency_test

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"lookly/internal/dbtest"
	"lookly/internal/idempotency"
	"lookly/internal/store"
	"lookly/migrations"
)

const route = "POST /api/v1/wardrobe/items"

type world struct {
	t    *testing.T
	pool *pgxpool.Pool
	keys *idempotency.Service
	t0   time.Time
}

func newWorld(t *testing.T) *world {
	t.Helper()
	pool := dbtest.Empty(t)
	if err := migrations.Apply(context.Background(), pool); err != nil {
		t.Fatal(err)
	}
	dbtest.InstallTestClock(t, pool)
	w := &world{t: t, pool: pool, keys: idempotency.New(pool), t0: time.Date(2026, 11, 26, 9, 0, 0, 0, time.UTC)}
	w.clock(0)
	for _, user := range []string{"u_one", "u_two"} {
		if _, err := pool.Exec(context.Background(), `INSERT INTO "User" ("id","email","passwordHash","updatedAt") VALUES ($1, $1 || '@test.local', 'x', now())`, user); err != nil {
			t.Fatal(err)
		}
	}
	return w
}

func (w *world) clock(d time.Duration) { dbtest.SetClock(w.t, w.pool, w.t0.Add(d)) }

func request(key, hash string) idempotency.Request {
	return idempotency.Request{UserID: "u_one", Route: route, Key: key, Hash: hash}
}

// claim begins a request that must be let through.
func (w *world) claim(r idempotency.Request) idempotency.Claim {
	w.t.Helper()
	c, replay, err := w.keys.Begin(context.Background(), r)
	if err != nil || replay != nil || c == nil {
		w.t.Fatalf("begin: claim %v, replay %v, err %v", c, replay, err)
	}
	return *c
}

// refused begins a request that must be refused and returns the refusal.
func (w *world) refused(r idempotency.Request) error {
	w.t.Helper()
	c, replay, err := w.keys.Begin(context.Background(), r)
	if err == nil || c != nil || replay != nil {
		w.t.Fatalf("begin: claim %v, replay %v, err %v; want a refusal", c, replay, err)
	}
	return err
}

func (w *world) complete(c idempotency.Claim, resource string) error {
	w.t.Helper()
	return pgx.BeginFunc(context.Background(), w.pool, func(tx pgx.Tx) error {
		return idempotency.Complete(context.Background(), store.New(tx), c, resource, 201)
	})
}

type row struct {
	ID, Status string
	Resource   *string
	Response   *int32
	CreatedAt  time.Time
	ExpiresAt  time.Time
}

func (w *world) row(user, key string) *row {
	w.t.Helper()
	var r row
	err := w.pool.QueryRow(context.Background(), `SELECT "id","status","resourceId","responseStatus","createdAt","expiresAt" FROM "IdempotencyKey" WHERE "userId"=$1 AND "route"=$2 AND "key"=$3`,
		user, route, key).Scan(&r.ID, &r.Status, &r.Resource, &r.Response, &r.CreatedAt, &r.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		w.t.Fatal(err)
	}
	return &r
}

func wantInProgress(t *testing.T, err error, retryAfter time.Duration) {
	t.Helper()
	var busy *idempotency.InProgressError
	if !errors.As(err, &busy) || busy.RetryAfter != retryAfter {
		t.Fatalf("err %v, want in progress with a retry after %s", err, retryAfter)
	}
}

func TestAKeyIsClaimedCompletedAndReplayed(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	c := w.claim(request("key-one-1", "hash-a"))
	r := w.row("u_one", "key-one-1")
	if r == nil || r.ID != c.ID || r.Status != "in_progress" || r.Resource != nil || !r.CreatedAt.Equal(w.t0) || !c.ClaimedAt.Equal(w.t0) || !r.ExpiresAt.Equal(w.t0.Add(24*time.Hour)) {
		t.Fatalf("claimed row %+v for claim %+v", r, c)
	}

	// While it runs: the same request waits, another request is a mismatch.
	w.clock(time.Minute)
	wantInProgress(t, w.refused(request("key-one-1", "hash-a")), 5*time.Second)
	if err := w.refused(request("key-one-1", "hash-b")); !errors.Is(err, idempotency.ErrMismatch) {
		t.Fatalf("another request: %v", err)
	}
	if again := w.row("u_one", "key-one-1"); *again != *r {
		t.Fatalf("a refused request changed the row: %+v", again)
	}

	if err := w.complete(c, "item-1"); err != nil {
		t.Fatal(err)
	}
	done := w.row("u_one", "key-one-1")
	if done.Status != "completed" || done.Resource == nil || *done.Resource != "item-1" || *done.Response != 201 || !done.CreatedAt.Equal(w.t0) {
		t.Fatalf("completed row %+v", done)
	}

	// Afterwards: a replay with the resource, for a day; never a new claim.
	for _, later := range []time.Duration{2 * time.Minute, 10 * time.Minute, 24*time.Hour - time.Millisecond} {
		w.clock(later)
		claim, replay, err := w.keys.Begin(context.Background(), request("key-one-1", "hash-a"))
		if err != nil || claim != nil || replay == nil || *replay.ResourceID != "item-1" || *replay.ResponseStatus != 201 {
			t.Fatalf("after %s: claim %v, replay %+v, err %v", later, claim, replay, err)
		}
		if err := w.refused(request("key-one-1", "hash-b")); !errors.Is(err, idempotency.ErrMismatch) {
			t.Fatalf("another request after completion: %v", err)
		}
	}
	// A completed key cannot be completed again, nor released.
	if err := w.complete(c, "item-2"); !errors.Is(err, idempotency.ErrClaimLost) {
		t.Fatalf("completing twice: %v", err)
	}
	if err := w.keys.Release(context.Background(), c); err != nil || w.row("u_one", "key-one-1") == nil {
		t.Fatalf("releasing a completed key: err %v, row %v", err, w.row("u_one", "key-one-1"))
	}

	// After 24 hours the key is forgotten: it starts fresh, for any request.
	w.clock(24 * time.Hour)
	fresh := w.claim(request("key-one-1", "hash-b"))
	if fresh.ID == c.ID || w.row("u_one", "key-one-1").Status != "in_progress" {
		t.Fatalf("after expiry: %+v", w.row("u_one", "key-one-1"))
	}
}

func TestAFailedAttemptReleasesItsKey(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	c := w.claim(request("key-one-1", "hash-a"))
	if err := w.keys.Release(context.Background(), c); err != nil {
		t.Fatal(err)
	}
	if w.row("u_one", "key-one-1") != nil {
		t.Fatal("the released key is still there")
	}
	// The retry runs, even with other content.
	again := w.claim(request("key-one-1", "hash-b"))
	if again.ID == c.ID {
		t.Fatal("the retry got the old claim")
	}
	// The first attempt's claim is gone: it can neither complete nor release
	// what the retry now holds...
	if err := w.complete(c, "item-1"); !errors.Is(err, idempotency.ErrClaimLost) {
		t.Fatalf("completing a released claim: %v", err)
	}
	if err := w.keys.Release(context.Background(), c); err != nil || w.row("u_one", "key-one-1") == nil {
		t.Fatalf("the old claim released the retry's key (err %v)", err)
	}
}

// A request that never finished (the server crashed) does not block its
// key for a day: after five minutes the next request takes it over.
func TestAStaleClaimIsTakenOver(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	old := w.claim(request("key-one-1", "hash-a"))

	w.clock(5*time.Minute - time.Millisecond)
	wantInProgress(t, w.refused(request("key-one-1", "hash-a")), 5*time.Second)

	w.clock(5 * time.Minute)
	// Never by another request.
	if err := w.refused(request("key-one-1", "hash-b")); !errors.Is(err, idempotency.ErrMismatch) {
		t.Fatalf("another request on a stale claim: %v", err)
	}
	taken := w.claim(request("key-one-1", "hash-a"))
	r := w.row("u_one", "key-one-1")
	if taken.ID != old.ID || !taken.ClaimedAt.Equal(w.t0.Add(5*time.Minute)) || !r.CreatedAt.Equal(taken.ClaimedAt) || !r.ExpiresAt.Equal(w.t0.Add(5*time.Minute+24*time.Hour)) || r.Status != "in_progress" {
		t.Fatalf("taken over: claim %+v, row %+v", taken, r)
	}
	// The new claim is fresh: a third request waits again.
	wantInProgress(t, w.refused(request("key-one-1", "hash-a")), 5*time.Second)

	// The old request wakes up: it can neither complete (its transaction
	// rolls back, no second resource) nor release the new holder's claim.
	if err := w.complete(old, "item-old"); !errors.Is(err, idempotency.ErrClaimLost) {
		t.Fatalf("the old holder completing: %v", err)
	}
	if err := w.keys.Release(context.Background(), old); err != nil {
		t.Fatal(err)
	}
	if r := w.row("u_one", "key-one-1"); r == nil || r.Status != "in_progress" || r.Resource != nil {
		t.Fatalf("after the old holder's attempts: %+v", r)
	}
	if err := w.complete(taken, "item-new"); err != nil {
		t.Fatal(err)
	}
	if r := w.row("u_one", "key-one-1"); r.Status != "completed" || *r.Resource != "item-new" {
		t.Fatalf("completed by the new holder: %+v", r)
	}
}

func TestKeysBelongToAUserAndARoute(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	mine := w.claim(request("key-one-1", "hash-a"))
	theirs := w.claim(idempotency.Request{UserID: "u_two", Route: route, Key: "key-one-1", Hash: "hash-b"})
	other := w.claim(idempotency.Request{UserID: "u_one", Route: "POST /api/v1/stylist/chat", Key: "key-one-1", Hash: "hash-c"})
	if mine.ID == theirs.ID || mine.ID == other.ID {
		t.Fatal("one claim for two users or routes")
	}
	if err := w.complete(mine, "item-1"); err != nil {
		t.Fatal(err)
	}
	if r := w.row("u_two", "key-one-1"); r.Status != "in_progress" {
		t.Fatalf("the other user's key: %+v", r)
	}

	// Expired keys are purged for the user who asks, and only those.
	w.clock(24 * time.Hour)
	w.claim(request("key-two-2", "hash-a"))
	if w.row("u_one", "key-one-1") != nil {
		t.Error("the user's expired key is still there")
	}
	if w.row("u_two", "key-one-1") == nil {
		t.Error("another user's key was purged")
	}
}

// A completion is part of the transaction that creates the resource: when
// that rolls back, the key is still in progress.
func TestCompletionRollsBackWithItsTransaction(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	c := w.claim(request("key-one-1", "hash-a"))
	failed := errors.New("the item could not be created")
	err := pgx.BeginFunc(context.Background(), w.pool, func(tx pgx.Tx) error {
		if err := idempotency.Complete(context.Background(), store.New(tx), c, "item-1", 201); err != nil {
			return err
		}
		return failed
	})
	if !errors.Is(err, failed) {
		t.Fatal(err)
	}
	if r := w.row("u_one", "key-one-1"); r.Status != "in_progress" || r.Resource != nil {
		t.Fatalf("after the rollback: %+v", r)
	}
}

// Of several requests with a key at once, one runs.
func TestOneOfConcurrentRequestsClaimsTheKey(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	const n = 12
	var wg sync.WaitGroup
	var mu sync.Mutex
	claims, waiting := 0, 0
	for range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			c, replay, err := w.keys.Begin(context.Background(), request("key-one-1", "hash-a"))
			var busy *idempotency.InProgressError
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err == nil && c != nil && replay == nil:
				claims++
			case errors.As(err, &busy):
				waiting++
			default:
				t.Errorf("claim %v, replay %v, err %v", c, replay, err)
			}
		}()
	}
	wg.Wait()
	if claims != 1 || waiting != n-1 {
		t.Fatalf("%d claims, %d waiting", claims, waiting)
	}
}

// A claim completed between a request's read and its takeover stays
// completed: the takeover itself looks at the status.
func TestACompletedKeyIsNeverTakenOver(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	c := w.claim(request("key-one-1", "hash-a"))
	if err := w.complete(c, "item-1"); err != nil {
		t.Fatal(err)
	}
	w.clock(10 * time.Minute)
	_, err := store.New(w.pool).TakeOverIdempotencyKey(context.Background(), store.TakeOverIdempotencyKeyParams{
		ID: c.ID, TtlMs: idempotency.TTL.Milliseconds(), StaleMs: idempotency.Stale.Milliseconds(),
	})
	if !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("a completed key was taken over (err %v)", err)
	}
	if r := w.row("u_one", "key-one-1"); r.Status != "completed" || !r.CreatedAt.Equal(w.t0) {
		t.Fatalf("the row changed: %+v", r)
	}
}
