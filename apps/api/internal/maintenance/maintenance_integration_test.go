//go:build integration

package maintenance_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"lookly/internal/dbtest"
	"lookly/internal/maintenance"
	"lookly/migrations"
)

const day = 24 * time.Hour

type db struct {
	t    *testing.T
	pool *pgxpool.Pool
}

func newDB(t *testing.T) db {
	t.Helper()
	pool := dbtest.Empty(t)
	if err := migrations.Apply(context.Background(), pool); err != nil {
		t.Fatal(err)
	}
	dbtest.InstallTestClock(t, pool)
	d := db{t, pool}
	d.exec(`INSERT INTO "User" ("id","email","passwordHash","updatedAt") VALUES ('mu','mu@test.local','x', now())`)
	return d
}

func (d db) exec(sql string, args ...any) {
	d.t.Helper()
	if _, err := d.pool.Exec(context.Background(), sql, args...); err != nil {
		d.t.Fatalf("%v\n%s", err, sql)
	}
}

func (d db) ids(sql string) string {
	d.t.Helper()
	var s *string
	if err := d.pool.QueryRow(context.Background(), sql).Scan(&s); err != nil {
		d.t.Fatalf("%v\n%s", err, sql)
	}
	if s == nil {
		return ""
	}
	return *s
}

func (d db) family(id string, created, absoluteExpires time.Time, revoked *time.Time) {
	d.t.Helper()
	d.exec(`INSERT INTO "SessionFamily" ("id","userId","createdAt","absoluteExpiresAt","revokedAt") VALUES ($1,'mu',$2,$3,$4)`,
		id, created, absoluteExpires, revoked)
}

// session inserts a row; rotated (with its successor and a ciphertext) or
// revoked (logout) when those are given.
func (d db) session(id, family string, created time.Time, revoked *time.Time, successor string) {
	d.t.Helper()
	var replacedBy, enc *string
	var rotated *time.Time
	if successor != "" {
		replacedBy, rotated = &successor, revoked
		c := "ciphertext-of-" + successor
		enc = &c
	}
	d.exec(`INSERT INTO "Session" ("id","userId","tokenHash","expiresAt","createdAt","revokedAt","replacedById","familyId","rotatedAt","successorTokenEnc")
		VALUES ($1,'mu',$1 || '-hash',$2,$3,$4,$5,$6,$7,$8)`,
		id, created.Add(30*day), created, revoked, replacedBy, family, rotated, enc)
}

// waitUntilBlockedOrDone returns once another session of this database
// waits for a lock, or done reports true. False after 10 s of neither.
func (d db) waitUntilBlockedOrDone(done func() bool) bool {
	d.t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if done() {
			return true
		}
		var waiting int
		if err := d.pool.QueryRow(context.Background(),
			`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`).Scan(&waiting); err != nil {
			d.t.Fatal(err)
		}
		if waiting > 0 {
			return true
		}
		time.Sleep(20 * time.Millisecond)
	}
	return false
}

func ptr(t time.Time) *time.Time { return &t }

func service(d db) *maintenance.Service { return maintenance.New(d.pool) }

// The scenario of the Node test CLEANUP-01 (session-maintenance.itest.ts),
// with the rows written directly: the expected counts are the same.
func TestCleanupRemovesOnlyWhatIsDead(t *testing.T) {
	t.Parallel()
	d := newDB(t)
	t0 := time.Date(2026, 9, 1, 8, 0, 0, 0, time.UTC)
	at := func(offset time.Duration) time.Time { return t0.Add(offset) }

	// A live family rotated at Δ0, Δ25 and Δ50 days.
	d.family("f_live", at(0), at(90*day), nil)
	d.session("live", "f_live", at(0), ptr(at(0)), "l1")
	d.session("l1", "f_live", at(0), ptr(at(25*day)), "l2")
	d.session("l2", "f_live", at(25*day), ptr(at(50*day)), "l3")
	d.session("l3", "f_live", at(50*day), nil, "")
	// Logged out at Δ0 (61 days before the run) and at Δ40 (21 days before).
	d.family("f_old_out", at(0), at(90*day), ptr(at(0)))
	d.session("old_out", "f_old_out", at(0), ptr(at(0)), "")
	d.family("f_recent_out", at(40*day), at(130*day), ptr(at(40*day)))
	d.session("recent_out", "f_recent_out", at(40*day), ptr(at(40*day)), "")

	now := at(61 * day)
	dbtest.SetClock(t, d.pool, now)
	// Reset links: one expired a minute ago, one valid for 30 more minutes.
	d.exec(`INSERT INTO "PasswordResetToken" ("id","userId","tokenHash","expiresAt") VALUES
		('rt_old','mu','old',$1), ('rt_new','mu','new',$2)`, now.Add(-time.Minute), now.Add(30*time.Minute))
	// Idempotency keys and weather rows: expired exactly now, and 1 ms later.
	d.exec(`INSERT INTO "IdempotencyKey" ("id","userId","route","key","requestHash","status","expiresAt") VALUES
		('ik_old','mu','POST /wardrobe/items','k1','h','completed',$1), ('ik_new','mu','POST /wardrobe/items','k2','h','completed',$2)`,
		now, now.Add(time.Millisecond))
	d.exec(`INSERT INTO "WeatherCache" ("id","cacheKey","dataJson","expiresAt") VALUES
		('w_old','41.30,69.28','{}',$1), ('w_new','39.65,66.96','{}',$2)`, now, now.Add(time.Millisecond))
	// Proof of consent and quota history, however old, are not cleanup's business.
	d.exec(`INSERT INTO "LegalConsent" ("id","userId","version","ageConfirmed","acceptedAt") VALUES ('lc','mu','2026-01-01',true,$1)`, at(-400*day))
	d.exec(`INSERT INTO "AiUsage" ("id","userId","feature","day","count","updatedAt") VALUES ('au','mu','stylist','2025-01-01',3,$1)`, at(-400*day))

	report, err := service(d).Cleanup(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	want := maintenance.Report{
		SuccessorCiphertextsCleared: 3, // all three rotations are more than 60 s old
		RotatedSessionsDeleted:      2, // the rows rotated at Δ0 and Δ25
		FamiliesDeleted:             1, // f_old_out; f_recent_out was revoked 21 days ago
		FamilySessionsDeleted:       1,
		ExpiredResetLinksDeleted:    1,
		ExpiredIdempotencyKeys:      1,
		ExpiredWeatherRows:          1,
	}
	if report != want {
		t.Fatalf("report %+v\nwant   %+v", report, want)
	}

	if got := d.ids(`SELECT string_agg("id", ',' ORDER BY "id") FROM "SessionFamily"`); got != "f_live,f_recent_out" {
		t.Errorf("families left: %s", got)
	}
	if got := d.ids(`SELECT string_agg("id", ',' ORDER BY "id") FROM "Session"`); got != "l2,l3,recent_out" {
		t.Errorf("sessions left: %s", got)
	}
	if got := d.ids(`SELECT string_agg("id", ',') FROM "Session" WHERE "successorTokenEnc" IS NOT NULL`); got != "" {
		t.Errorf("ciphertexts left on %s", got)
	}
	for table, want := range map[string]string{"PasswordResetToken": "rt_new", "IdempotencyKey": "ik_new", "WeatherCache": "w_new"} {
		if got := d.ids(`SELECT string_agg("id", ',') FROM "` + table + `"`); got != want {
			t.Errorf("%s left: %q, want %q", table, got, want)
		}
	}
	for table, want := range map[string]string{"LegalConsent": "lc", "AiUsage": "au"} {
		if got := d.ids(`SELECT string_agg("id", ',') FROM "` + table + `"`); got != want {
			t.Errorf("%s: %q left, want %q", table, got, want)
		}
	}
	again, err := service(d).Cleanup(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if again != (maintenance.Report{}) {
		t.Errorf("a second run changed %+v", again)
	}
}

func TestBoundaries(t *testing.T) {
	t.Parallel()
	d := newDB(t)
	now := time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)
	ms := time.Millisecond

	// Ciphertexts: rotated exactly 60 s ago stays, 60 s + 1 ms ago is cleared.
	d.family("f_live", now.Add(-10*day), now.Add(80*day), nil)
	d.session("keep_cipher", "f_live", now.Add(-10*day), ptr(now.Add(-60*time.Second)), "tail")
	d.session("clear_cipher", "f_live", now.Add(-10*day), ptr(now.Add(-60*time.Second-ms)), "keep_cipher")
	d.session("tail", "f_live", now.Add(-time.Minute), nil, "")
	// Families: revoked exactly 30 days ago stays, 30 days + 1 ms is deleted;
	// past the absolute limit by 30 days + 1 ms is deleted too.
	d.family("f_revoked_30d", now.Add(-40*day), now.Add(50*day), ptr(now.Add(-30*day)))
	d.family("f_revoked_30d1ms", now.Add(-40*day), now.Add(50*day), ptr(now.Add(-30*day-ms)))
	d.family("f_expired_30d", now.Add(-120*day), now.Add(-30*day), nil)
	d.family("f_expired_30d1ms", now.Add(-120*day), now.Add(-30*day-ms), nil)
	// Rotated sessions of a live family: exactly 30 days ago stays.
	d.family("f_old_live", now.Add(-60*day), now.Add(30*day), nil)
	d.session("rot_30d", "f_old_live", now.Add(-60*day), ptr(now.Add(-30*day)), "rot_tail")
	d.session("rot_30d1ms", "f_old_live", now.Add(-60*day), ptr(now.Add(-30*day-ms)), "rot_30d")
	d.session("rot_tail", "f_old_live", now.Add(-30*day), nil, "")
	// Revoked 40 days ago but never rotated (no successor): not a rotated row, stays.
	d.session("revoked_not_rotated", "f_old_live", now.Add(-60*day), ptr(now.Add(-40*day)), "")
	// A dead family's rotated rows go with the family, counted once.
	d.session("dead_rotated", "f_revoked_30d1ms", now.Add(-40*day), ptr(now.Add(-39*day)), "dead_tail")
	d.session("dead_tail", "f_revoked_30d1ms", now.Add(-39*day), ptr(now.Add(-30*day-ms)), "")
	// Reset links: expired exactly now is deleted, 1 ms later is kept.
	d.exec(`INSERT INTO "PasswordResetToken" ("id","userId","tokenHash","expiresAt") VALUES
		('rt_now','mu','a',$1), ('rt_later','mu','b',$2)`, now, now.Add(ms))
	dbtest.SetClock(t, d.pool, now)

	report, err := service(d).Cleanup(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if report.FamiliesDeleted != 2 || report.RotatedSessionsDeleted != 1 || report.FamilySessionsDeleted != 2 ||
		report.ExpiredResetLinksDeleted != 1 {
		t.Errorf("report %+v", report)
	}
	if got := d.ids(`SELECT string_agg("id", ',') FROM "PasswordResetToken"`); got != "rt_later" {
		t.Errorf("reset links left: %s", got)
	}
	if got := d.ids(`SELECT string_agg("id", ',' ORDER BY "id") FROM "SessionFamily"`); got != "f_expired_30d,f_live,f_old_live,f_revoked_30d" {
		t.Errorf("families left: %s", got)
	}
	if got := d.ids(`SELECT string_agg("id", ',' ORDER BY "id") FROM "Session" WHERE "successorTokenEnc" IS NOT NULL`); got != "keep_cipher" {
		t.Errorf("ciphertexts left on: %s", got)
	}
	if got := d.ids(`SELECT string_agg("id", ',' ORDER BY "id") FROM "Session" WHERE "familyId" = 'f_old_live'`); got != "revoked_not_rotated,rot_30d,rot_tail" {
		t.Errorf("sessions left in f_old_live: %s", got)
	}
}

// A table held by someone else makes the run give up within its lock
// timeout, and the whole run is undone (one transaction).
func TestALockedTableMakesTheRunGiveUpAndChangeNothing(t *testing.T) {
	t.Parallel()
	d := newDB(t)
	now := time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)
	d.family("f", now.Add(-day), now.Add(89*day), nil)
	d.session("old", "f", now.Add(-day), ptr(now.Add(-time.Hour)), "tail")
	d.session("tail", "f", now.Add(-time.Hour), nil, "")
	d.exec(`INSERT INTO "PasswordResetToken" ("id","userId","tokenHash","expiresAt") VALUES ('rt','mu','h',$1)`, now.Add(-time.Hour))
	dbtest.SetClock(t, d.pool, now)

	ctx := context.Background()
	holder, err := d.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	// Released below; this only covers an early t.Fatal (an error then is moot).
	defer func() { _ = holder.Rollback(ctx) }()
	if _, err := holder.Exec(ctx, `LOCK TABLE "PasswordResetToken" IN ACCESS EXCLUSIVE MODE`); err != nil {
		t.Fatal(err)
	}

	s := maintenance.New(d.pool, maintenance.WithLockTimeout(300*time.Millisecond))
	started := time.Now()
	_, err = s.Cleanup(ctx)
	if err == nil || !strings.Contains(err.Error(), "lock timeout") {
		t.Fatalf("err %v, want a lock timeout", err)
	}
	if took := time.Since(started); took > 3*time.Second {
		t.Errorf("gave up after %s; the lock timeout is 300ms", took)
	}
	if err := holder.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	if got := d.ids(`SELECT string_agg("id", ',') FROM "Session" WHERE "successorTokenEnc" IS NOT NULL`); got != "old" {
		t.Errorf("the earlier step was not undone: ciphertexts on %q", got)
	}
}

// The session protocol locks a family first, then its sessions. A refresh
// presenting an old token of a dead family (past its absolute limit, not yet
// revoked, with a stale ciphertext) while the cleanup runs must not deadlock:
// the cleanup takes the family locks before any session lock.
func TestCleanupAndARefreshOnTheSameFamilyDoNotDeadlock(t *testing.T) {
	t.Parallel()
	d := newDB(t)
	now := time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)
	d.family("f_dead", now.Add(-130*day), now.Add(-31*day), nil)
	d.session("rotated", "f_dead", now.Add(-130*day), ptr(now.Add(-125*day)), "tail")
	d.session("tail", "f_dead", now.Add(-125*day), nil, "")
	dbtest.SetClock(t, d.pool, now)

	ctx := context.Background()
	refresh, err := d.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = refresh.Rollback(ctx) }() // moot once committed
	if _, err := refresh.Exec(ctx, `SELECT "id" FROM "SessionFamily" WHERE "id" = 'f_dead' FOR UPDATE`); err != nil {
		t.Fatal(err)
	}

	type result struct {
		report maintenance.Report
		err    error
	}
	cleanup := make(chan result, 1)
	go func() {
		r, err := service(d).Cleanup(ctx)
		cleanup <- result{r, err}
	}()
	// The cleanup runs into the family lock (seen in PostgreSQL, not guessed
	// from a sleep).
	if !d.waitUntilBlockedOrDone(func() bool { return len(cleanup) > 0 }) {
		t.Fatal("the cleanup neither finished nor waited for a lock")
	}

	// The refresh presents the old (rotated) token: family first, then that
	// session (sessions.md), then it revokes the family's sessions.
	if _, err := refresh.Exec(ctx, `SELECT "id" FROM "Session" WHERE "id" = 'rotated' FOR UPDATE`); err != nil {
		t.Fatalf("the refresh failed: %v", err)
	}
	if _, err := refresh.Exec(ctx, `UPDATE "Session" SET "revokedAt" = $1 WHERE "familyId" = 'f_dead' AND "revokedAt" IS NULL`, now); err != nil {
		t.Fatalf("the refresh failed: %v", err)
	}
	if err := refresh.Commit(ctx); err != nil {
		t.Fatalf("the refresh failed: %v", err)
	}
	select {
	case r := <-cleanup:
		if r.err != nil {
			t.Fatalf("the cleanup failed: %v", r.err)
		}
		if r.report.FamiliesDeleted != 1 || r.report.FamilySessionsDeleted != 2 {
			t.Errorf("report %+v", r.report)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the cleanup did not finish")
	}
}

// The same race on a LIVE family: its stale ciphertexts are the cleanup's
// business, and a family revocation (reuse, logout, reset) clears every
// ciphertext in the family. The cleanup takes session rows only when nobody
// holds them (SKIP LOCKED), so it never waits for a row while holding
// another one.
func TestCleanupAndARevocationOnALiveFamilyDoNotDeadlock(t *testing.T) {
	t.Parallel()
	d := newDB(t)
	now := time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)
	d.family("f_live", now.Add(-10*day), now.Add(80*day), nil)
	d.session("s1", "f_live", now.Add(-10*day), ptr(now.Add(-2*time.Hour)), "s2")
	d.session("s2", "f_live", now.Add(-2*time.Hour), ptr(now.Add(-time.Hour)), "s3")
	d.session("s3", "f_live", now.Add(-time.Hour), nil, "")
	dbtest.SetClock(t, d.pool, now)

	ctx := context.Background()
	refresh, err := d.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = refresh.Rollback(ctx) }() // moot once committed
	// A replay of s2's token: family first, then that session.
	for _, lock := range []string{
		`SELECT "id" FROM "SessionFamily" WHERE "id" = 'f_live' FOR UPDATE`,
		`SELECT "id" FROM "Session" WHERE "id" = 's2' FOR UPDATE`,
	} {
		if _, err := refresh.Exec(ctx, lock); err != nil {
			t.Fatal(err)
		}
	}

	type result struct {
		report maintenance.Report
		err    error
	}
	cleanup := make(chan result, 1)
	go func() {
		r, err := service(d).Cleanup(ctx)
		cleanup <- result{r, err}
	}()
	if !d.waitUntilBlockedOrDone(func() bool { return len(cleanup) > 0 }) {
		t.Fatal("the cleanup neither finished nor waited for a lock")
	}

	// The refresh decides "reuse" and revokes the family: every session's
	// ciphertext is cleared, s1's included.
	if _, err := refresh.Exec(ctx, `UPDATE "Session" SET "successorTokenEnc" = NULL, "revokedAt" = coalesce("revokedAt", $1) WHERE "familyId" = 'f_live'`, now); err != nil {
		t.Fatalf("the refresh failed: %v", err)
	}
	if err := refresh.Commit(ctx); err != nil {
		t.Fatalf("the refresh failed: %v", err)
	}
	select {
	case r := <-cleanup:
		if r.err != nil {
			t.Fatalf("the cleanup failed: %v", r.err)
		}
		// s1 was free and is cleared; s2 was held by the refresh and left to it.
		if r.report.SuccessorCiphertextsCleared != 1 {
			t.Errorf("report %+v", r.report)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the cleanup did not finish")
	}
	if got := d.ids(`SELECT string_agg("id", ',') FROM "Session" WHERE "successorTokenEnc" IS NOT NULL`); got != "" {
		t.Errorf("ciphertexts left on %s", got)
	}
}

// Cleanups are not serialised by the job queue: several at once must all
// succeed, and together remove each thing exactly once.
func TestConcurrentCleanupsAreSafe(t *testing.T) {
	t.Parallel()
	d := newDB(t)
	now := time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)
	for i := range 20 {
		id := string(rune('a' + i))
		d.family("dead_"+id, now.Add(-100*day), now.Add(-40*day), nil)
		d.session("dead_s_"+id, "dead_"+id, now.Add(-100*day), nil, "")
		d.family("live_"+id, now.Add(-50*day), now.Add(40*day), nil)
		d.session("rot_"+id, "live_"+id, now.Add(-50*day), ptr(now.Add(-40*day)), "tail_"+id)
		d.session("tail_"+id, "live_"+id, now.Add(-40*day), nil, "")
	}
	dbtest.SetClock(t, d.pool, now)

	const runs = 4
	reports := make(chan maintenance.Report, runs)
	errs := make(chan error, runs)
	for range runs {
		go func() {
			r, err := service(d).Cleanup(context.Background())
			reports <- r
			errs <- err
		}()
	}
	var total maintenance.Report
	for range runs {
		if err := <-errs; err != nil {
			t.Fatalf("a concurrent cleanup failed: %v", err)
		}
		r := <-reports
		total.FamiliesDeleted += r.FamiliesDeleted
		total.RotatedSessionsDeleted += r.RotatedSessionsDeleted
		total.SuccessorCiphertextsCleared += r.SuccessorCiphertextsCleared
	}
	if total.FamiliesDeleted != 20 || total.RotatedSessionsDeleted != 20 || total.SuccessorCiphertextsCleared != 20 {
		t.Errorf("together they removed %+v, want 20 of each", total)
	}
	if got := d.ids(`SELECT count(*)::text FROM "Session"`); got != "20" {
		t.Errorf("%s sessions left, want the 20 live tails", got)
	}
}
