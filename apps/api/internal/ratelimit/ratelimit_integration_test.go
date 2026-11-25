//go:build integration

package ratelimit_test

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"lookly/internal/dbtest"
	"lookly/internal/ratelimit"
	"lookly/migrations"
)

var (
	perAccount = ratelimit.Rule{Name: "login:account", Limit: 10, Window: 15 * time.Minute}
	perIP      = ratelimit.Rule{Name: "login:ip", Limit: 50, Window: 15 * time.Minute}
)

type world struct {
	t       *testing.T
	pool    *pgxpool.Pool
	limiter *ratelimit.Limiter
	t0      time.Time
}

func newWorld(t *testing.T) *world {
	t.Helper()
	pool := dbtest.Empty(t)
	if err := migrations.Apply(context.Background(), pool); err != nil {
		t.Fatal(err)
	}
	dbtest.InstallTestClock(t, pool)
	w := &world{t: t, pool: pool, t0: time.Date(2026, 11, 25, 9, 0, 0, 0, time.UTC)}
	w.clock(0)
	w.limiter = ratelimit.New(pool, []byte("rate-limit-test-secret-rate-limit-test-secret"))
	return w
}

func (w *world) clock(d time.Duration) { dbtest.SetClock(w.t, w.pool, w.t0.Add(d)) }

func (w *world) take(hits ...ratelimit.Hit) ratelimit.Decision {
	w.t.Helper()
	d, err := w.limiter.Take(context.Background(), hits...)
	if err != nil {
		w.t.Fatalf("take: %v", err)
	}
	return d
}

func (w *world) refund(hits ...ratelimit.Hit) {
	w.t.Helper()
	if err := w.limiter.Refund(context.Background(), hits...); err != nil {
		w.t.Fatalf("refund: %v", err)
	}
}

// counts are the stored counters, in no particular order.
func (w *world) counts() []int {
	w.t.Helper()
	rows, err := w.pool.Query(context.Background(), `SELECT "count" FROM "RateLimitBucket" ORDER BY "count"`)
	if err != nil {
		w.t.Fatal(err)
	}
	out, err := pgx.CollectRows(rows, pgx.RowTo[int])
	if err != nil {
		w.t.Fatal(err)
	}
	return out
}

func TestTheTenthAttemptPassesAndTheEleventhIsRefusedUntilTheWindowEnds(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	aziza := perAccount.For("aziza@example.uz")
	for i := 1; i <= 10; i++ {
		// Later attempts do not move the window: it starts at the first one.
		w.clock(time.Duration(i-1) * 30 * time.Second)
		if d := w.take(aziza); !d.Allowed || d.RetryAfter != 0 {
			t.Fatalf("attempt %d: %+v", i, d)
		}
	}
	w.clock(5 * time.Minute)
	d := w.take(aziza)
	if d.Allowed || d.RetryAfter != 10*time.Minute {
		t.Fatalf("attempt 11: %+v, want refused for the 10 minutes left", d)
	}
	// A refused attempt is not counted.
	if got := w.counts(); len(got) != 1 || got[0] != 10 {
		t.Errorf("stored counts %v, want one bucket at 10", got)
	}
	// The window ends on the database clock, at its last millisecond's end.
	w.clock(15*time.Minute - time.Millisecond)
	if d := w.take(aziza); d.Allowed || d.RetryAfter != time.Millisecond {
		t.Fatalf("one millisecond before the end: %+v", d)
	}
	w.clock(15 * time.Minute)
	if d := w.take(aziza); !d.Allowed {
		t.Fatalf("at the end of the window: %+v", d)
	}
	if got := w.counts(); len(got) != 1 || got[0] != 1 {
		t.Errorf("stored counts %v, want a fresh window at 1", got)
	}
	// The new window runs from that attempt.
	for range 9 {
		w.take(aziza)
	}
	w.clock(29 * time.Minute)
	if d := w.take(aziza); d.Allowed || d.RetryAfter != time.Minute {
		t.Fatalf("second window: %+v", d)
	}
}

func TestARefundedAttemptIsNotCounted(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	aziza := perAccount.For("aziza@example.uz")
	// Fifty successful sign-ins: each is counted, then given back.
	for i := range 50 {
		if d := w.take(aziza); !d.Allowed {
			t.Fatalf("successful sign-in %d refused", i)
		}
		w.refund(aziza)
	}
	if got := w.counts(); len(got) != 1 || got[0] != 0 {
		t.Fatalf("stored counts %v", got)
	}
	// A success does not clear earlier failures.
	for range 9 {
		w.take(aziza)
	}
	w.take(aziza)
	w.refund(aziza)
	if got := w.counts(); got[0] != 9 {
		t.Fatalf("after 9 failures and a success: %v", got)
	}
	w.take(aziza) // the tenth failure
	if d := w.take(aziza); d.Allowed {
		t.Fatal("the eleventh attempt passed")
	}
	// A refund never goes below zero, and never touches a window that ended
	// (a new one would lose a count it never had).
	bobur := perAccount.For("bobur@example.uz")
	w.refund(bobur) // no bucket at all
	w.take(bobur)
	w.refund(bobur)
	w.refund(bobur)
	w.clock(15 * time.Minute)
	w.refund(aziza)
	var azizaCount, boburCount int
	if err := w.pool.QueryRow(context.Background(), `SELECT max("count"), min("count") FROM "RateLimitBucket"`).Scan(&azizaCount, &boburCount); err != nil {
		t.Fatal(err)
	}
	if azizaCount != 10 || boburCount != 0 {
		t.Errorf("counts %d and %d, want 10 (ended window untouched) and 0", azizaCount, boburCount)
	}
}

func TestOtherSubjectsAndOtherRulesAreUnaffected(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	for range 10 {
		w.take(perAccount.For("aziza@example.uz"))
	}
	if d := w.take(perAccount.For("aziza@example.uz")); d.Allowed {
		t.Fatal("not limited")
	}
	for _, hit := range []ratelimit.Hit{
		perAccount.For("bobur@example.uz"),
		perAccount.For("AZIZA@example.uz"), // the caller normalises; here it is another subject
		perIP.For("aziza@example.uz"),      // the same text under another rule
		ratelimit.Rule{Name: "register:ip", Limit: 10, Window: time.Hour}.For("aziza@example.uz"),
	} {
		if d := w.take(hit); !d.Allowed {
			t.Errorf("%s / %s is limited by another bucket", hit.Rule.Name, hit.Subject)
		}
	}
	// A rule name and a subject never run together into another pair's bucket.
	once := func(name string) ratelimit.Rule { return ratelimit.Rule{Name: name, Limit: 1, Window: time.Hour} }
	w.take(once("ab").For("c"))
	for _, hit := range []ratelimit.Hit{once("a").For("bc"), once("abc").For(""), once("").For("abc")} {
		if d := w.take(hit); !d.Allowed {
			t.Errorf("%q / %q shares a bucket with \"ab\" / \"c\"", hit.Rule.Name, hit.Subject)
		}
	}
}

func TestSeveralLimitsAreTakenTogetherOrNotAtAll(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	account, ip := perAccount.For("aziza@example.uz"), perIP.For("203.0.113.7")
	for range 10 {
		if d := w.take(account, ip); !d.Allowed {
			t.Fatal("refused within both limits")
		}
	}
	// The account is at its limit: the attempt is refused and the address's
	// counter does not move.
	w.clock(time.Minute)
	if d := w.take(account, ip); d.Allowed || d.RetryAfter != 14*time.Minute {
		t.Fatalf("%+v", d)
	}
	if got := w.counts(); len(got) != 2 || got[0] != 10 || got[1] != 10 {
		t.Fatalf("counts %v, want both at 10", got)
	}
	// Other accounts from the same address go on until the address's limit.
	for i := range 40 {
		if d := w.take(perAccount.For(fmt.Sprintf("user%d@example.uz", i)), ip); !d.Allowed {
			t.Fatalf("attempt %d from the address refused", i)
		}
	}
	other := perAccount.For("someone@example.uz")
	if d := w.take(other, ip); d.Allowed {
		t.Fatal("the 51st attempt from the address passed")
	}
	// Refused by the address: that account's own counter did not move.
	if d := w.take(other); !d.Allowed {
		t.Fatal("the account was charged for an attempt the address limit refused")
	}
	// Both limits reached, with different windows: wait for the longer one,
	// whichever bucket comes first (several subjects: both orders occur).
	w.clock(2 * time.Minute)
	for i := range 8 {
		late := ratelimit.Rule{Name: "late", Limit: 1, Window: 30 * time.Minute}.For(fmt.Sprint(i))
		w.take(late)
		if d := w.take(ip, late); d.Allowed || d.RetryAfter != 30*time.Minute {
			t.Fatalf("subject %d: %+v, want the longer wait (30 minutes)", i, d)
		}
		early := ratelimit.Rule{Name: "early", Limit: 1, Window: time.Minute}.For(fmt.Sprint(i))
		w.take(early)
		if d := w.take(early, ip); d.Allowed || d.RetryAfter != 13*time.Minute {
			t.Fatalf("subject %d: %+v, want the longer wait (the address's 13 minutes)", i, d)
		}
	}
	// A refund gives back every hit of the attempt.
	once := ratelimit.Rule{Name: "once", Limit: 1, Window: time.Hour}
	x, y := once.For("x"), once.For("y")
	if d := w.take(x, y); !d.Allowed {
		t.Fatal("first attempt refused")
	}
	if d := w.take(x, y); d.Allowed {
		t.Fatal("second attempt passed")
	}
	w.refund(x, y)
	if d := w.take(y, x); !d.Allowed {
		t.Fatal("the refund did not give both hits back")
	}
}

func TestTheStoredKeyRevealsNeitherTheSubjectNorItsPlainHash(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	const email, address = "aziza@example.uz", "203.0.113.7"
	w.take(perAccount.For(email), perIP.For(address))
	rows, err := w.pool.Query(context.Background(), `SELECT "key" FROM "RateLimitBucket"`)
	if err != nil {
		t.Fatal(err)
	}
	keys, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil || len(keys) != 2 {
		t.Fatalf("keys %v (%v)", keys, err)
	}
	plain := func(s string) string { sum := sha256.Sum256([]byte(s)); return hex.EncodeToString(sum[:]) }
	// Nor is the signing secret itself the hashing key: the limiter derives its own.
	keyed := func(s string) string {
		mac := hmac.New(sha256.New, []byte("rate-limit-test-secret-rate-limit-test-secret"))
		mac.Write([]byte(s))
		return hex.EncodeToString(mac.Sum(nil))
	}
	for _, key := range keys {
		if len(key) != 64 || strings.Trim(key, "0123456789abcdef") != "" {
			t.Errorf("key %q is not a 256-bit hex digest", key)
		}
		for _, guess := range []string{email, address, plain(email), plain(address), plain("login:account:" + email), plain("login:ip:" + address), plain("login:account\x00" + email),
			keyed("login:account\x00" + email), keyed("login:ip\x00" + address)} {
			if strings.Contains(key, guess) {
				t.Errorf("key %q can be computed without the server's secret", key)
			}
		}
	}
	// Another secret: other keys, so a database dump cannot be tested against guesses.
	stranger := ratelimit.New(w.pool, []byte("another-secret-another-secret-another-secret"))
	for range 10 {
		w.take(perAccount.For(email))
	}
	if d, err := stranger.Take(context.Background(), perAccount.For(email)); err != nil || !d.Allowed {
		t.Errorf("a limiter with another secret shares the bucket: %+v %v", d, err)
	}
}

func TestConcurrentAttemptsNeverPassTheLimit(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	hit := perAccount.For("aziza@example.uz")
	var wg sync.WaitGroup
	var mu sync.Mutex
	allowed := 0
	for range 40 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			d, err := w.limiter.Take(context.Background(), hit)
			if err != nil {
				t.Errorf("take: %v", err)
				return
			}
			if d.Allowed {
				mu.Lock()
				allowed++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	if allowed != 10 {
		t.Errorf("%d of 40 concurrent attempts passed, want 10", allowed)
	}
	if got := w.counts(); len(got) != 1 || got[0] != 10 {
		t.Errorf("stored counts %v", got)
	}
}

// Two attempts naming the same buckets in different orders lock them in one
// order: no deadlock.
func TestOverlappingAttemptsDoNotDeadlock(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	a := ratelimit.Rule{Name: "a", Limit: 1_000_000, Window: time.Hour}.For("x")
	b := ratelimit.Rule{Name: "b", Limit: 1_000_000, Window: time.Hour}.For("x")
	c := ratelimit.Rule{Name: "c", Limit: 1_000_000, Window: time.Hour}.For("x")
	orders := [][]ratelimit.Hit{{a, b, c}, {c, b, a}, {b, a, c}, {c, a, b}}
	var wg sync.WaitGroup
	for i := range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := range 40 {
				if _, err := w.limiter.Take(context.Background(), orders[(i+j)%len(orders)]...); err != nil {
					t.Errorf("take: %v", err)
					return
				}
				if j%3 == 0 {
					if err := w.limiter.Refund(context.Background(), orders[(i+j+1)%len(orders)]...); err != nil {
						t.Errorf("refund: %v", err)
						return
					}
				}
			}
		}()
	}
	wg.Wait()
}

// A bucket someone holds (the cleanup deleting it, say) makes the attempt
// fail within the lock timeout: an error, never "allowed".
func TestABusyBucketIsAnErrorNotAPass(t *testing.T) {
	t.Parallel()
	if ratelimit.DefaultLockTimeout != 2*time.Second {
		t.Fatalf("lock timeout %s", ratelimit.DefaultLockTimeout)
	}
	w := newWorld(t)
	hit := perAccount.For("aziza@example.uz")
	w.take(hit)
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dbtest.URL(w.pool))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(ctx)
	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `SELECT 1 FROM "RateLimitBucket" FOR UPDATE`); err != nil {
		t.Fatal(err)
	}
	impatient := ratelimit.New(w.pool, []byte("rate-limit-test-secret-rate-limit-test-secret"), ratelimit.WithLockTimeout(200*time.Millisecond))
	started := time.Now()
	bounded, cancel := context.WithTimeout(ctx, 5*time.Second) // so that a missing lock timeout fails the test instead of hanging it
	defer cancel()
	d, err := impatient.Take(bounded, hit)
	if err == nil || d.Allowed {
		t.Fatalf("a locked bucket: %+v, %v", d, err)
	}
	if waited := time.Since(started); waited > 3*time.Second {
		t.Errorf("waited %s: the lock timeout did not apply", waited)
	}
	if err := impatient.Refund(bounded, hit); err == nil {
		t.Error("a refund on a locked bucket reported success")
	}
	if err := tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	if got := w.counts(); len(got) != 1 || got[0] != 1 {
		t.Errorf("counts %v", got)
	}
}
