//go:build integration

package app_test

import (
	"bytes"
	"context"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"lookly/internal/app"
	"lookly/internal/config/configtest"
	"lookly/internal/dbtest"
	"lookly/migrations"
)

// schemaDB is a fresh database with the Go baseline (what the shared
// database looks like) and, optionally, River's tables.
func schemaDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	pool := dbtest.Empty(t)
	if err := migrations.Apply(context.Background(), pool); err != nil {
		t.Fatal(err)
	}
	return pool
}

func appEnv(pool *pgxpool.Pool, extra map[string]string) func(string) (string, bool) {
	vars := configtest.Env(map[string]string{
		"DATABASE_URL":          dbtest.URL(pool),
		"LOOKLY_SHUTDOWN_GRACE": "5s",
		// A directory that exists (the worker checks); tests that store
		// files give their own.
		"STORAGE_LOCAL_DIR": os.TempDir(),
	})
	for k, v := range extra {
		vars[k] = v
	}
	return env(vars)
}

func TestMigrateRiverCreatesItsOwnSchemaOnlyAndIsIdempotent(t *testing.T) {
	t.Parallel()
	pool := schemaDB(t)
	before := dbtest.Catalog(t, pool)
	for i := range 2 {
		var stdout, stderr bytes.Buffer
		if code := app.Run(context.Background(), []string{"migrate", "river"}, appEnv(pool, nil), &stdout, &stderr); code != 0 {
			t.Fatalf("run %d: exit %d: %s", i+1, code, stderr.String())
		}
		if i == 0 && !strings.Contains(stdout.String(), "river migrations applied") {
			t.Errorf("first run does not report what it applied: %s", stdout.String())
		}
	}
	var tables int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM pg_tables WHERE schemaname = 'river' AND tablename IN ('river_job', 'river_migration', 'river_leader')`).Scan(&tables); err != nil {
		t.Fatal(err)
	}
	if tables != 3 {
		t.Errorf("river tables in schema river: %d", tables)
	}
	// Prisma's schema (public) is untouched: no drift for the Node API.
	if diff := dbtest.Diff(before, dbtest.Catalog(t, pool)); diff != "" {
		t.Errorf("public changed:\n%s", diff)
	}
}

func TestWorkerRefusesToStartWithoutRiversTables(t *testing.T) {
	t.Parallel()
	pool := schemaDB(t)
	var stderr bytes.Buffer
	code := app.Run(context.Background(), []string{"worker"}, appEnv(pool, nil), &bytes.Buffer{}, &stderr)
	if code != 1 || !strings.Contains(stderr.String(), "lookly migrate river") {
		t.Fatalf("exit %d, stderr %q", code, stderr.String())
	}
}

type runningWorker struct {
	stdout *syncBuffer
	stop   context.CancelFunc
	done   chan int
}

func startWorker(t *testing.T, pool *pgxpool.Pool, extra map[string]string) runningWorker {
	t.Helper()
	ctx, stop := context.WithCancel(context.Background())
	t.Cleanup(stop)
	w := runningWorker{stdout: &syncBuffer{}, stop: stop, done: make(chan int, 1)}
	go func() { w.done <- app.Run(ctx, []string{"worker"}, appEnv(pool, extra), w.stdout, &syncBuffer{}) }()
	return w
}

// stopAndWait sends the stop signal and returns the exit code and how long
// the worker took to exit.
func (w runningWorker) stopAndWait(t *testing.T) (int, time.Duration) {
	t.Helper()
	started := time.Now()
	w.stop()
	select {
	case code := <-w.done:
		return code, time.Since(started)
	case <-time.After(20 * time.Second):
		t.Fatalf("the worker did not stop:\n%s", w.stdout.String())
		return 0, 0
	}
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func count(t *testing.T, pool *pgxpool.Pool, sql string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), sql).Scan(&n); err != nil {
		t.Fatalf("%v\n%s", err, sql)
	}
	return n
}

func expiredResetLink(t *testing.T, pool *pgxpool.Pool, id string) {
	t.Helper()
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `INSERT INTO "User" ("id","email","passwordHash","updatedAt") VALUES ('u','u@test.local','x',now()) ON CONFLICT DO NOTHING`); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO "PasswordResetToken" ("id","userId","tokenHash","expiresAt") VALUES ($1,'u',$1, now() AT TIME ZONE 'UTC' - interval '1 hour')`, id); err != nil {
		t.Fatal(err)
	}
}

func migrateRiver(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	if code := app.Run(context.Background(), []string{"migrate", "river"}, appEnv(pool, nil), &bytes.Buffer{}, &bytes.Buffer{}); code != 0 {
		t.Fatal("migrate river failed")
	}
}

func TestWorkerRunsTheCleanupAtEveryStartAndStopsOnASignal(t *testing.T) {
	t.Parallel()
	pool := schemaDB(t)
	migrateRiver(t, pool)
	resetLinks := `SELECT count(*) FROM "PasswordResetToken"`

	expiredResetLink(t, pool, "first")
	w := startWorker(t, pool, nil)
	waitFor(t, "the cleanup at start", func() bool {
		return count(t, pool, resetLinks) == 0 && strings.Contains(w.stdout.String(), `"msg":"cleanup done"`)
	})
	if !strings.Contains(w.stdout.String(), `"expiredResetLinksDeleted":1`) {
		t.Errorf("the counts are not logged: %s", w.stdout.String())
	}
	if code, _ := w.stopAndWait(t); code != 0 {
		t.Fatalf("exit %d:\n%s", code, w.stdout.String())
	}
	if strings.Contains(w.stdout.String(), dbtest.URL(pool)) {
		t.Error("the log shows the database URL")
	}

	// A restart within the same hour runs it again (not only once per hour).
	expiredResetLink(t, pool, "second")
	again := startWorker(t, pool, nil)
	waitFor(t, "the cleanup at the second start", func() bool {
		return count(t, pool, resetLinks) == 0 && strings.Contains(again.stdout.String(), `"msg":"cleanup done"`)
	})
	if code, _ := again.stopAndWait(t); code != 0 {
		t.Fatalf("second exit %d", code)
	}
}

// A worker killed mid-job (SIGKILL, out of memory) leaves its job "running"
// until River rescues it. That must not stop the next worker's cleanup.
func TestWorkerRunsTheCleanupAfterAnotherWorkerWasKilledMidJob(t *testing.T) {
	t.Parallel()
	pool := schemaDB(t)
	migrateRiver(t, pool)
	first := startWorker(t, pool, nil)
	waitFor(t, "the first cleanup", func() bool { return strings.Contains(first.stdout.String(), `"msg":"cleanup done"`) })
	if code, _ := first.stopAndWait(t); code != 0 {
		t.Fatalf("exit %d", code)
	}
	// What a killed worker leaves behind: its job still marked as running.
	if _, err := pool.Exec(context.Background(),
		`UPDATE river.river_job SET state = 'running', finalized_at = NULL WHERE kind = 'maintenance_cleanup'`); err != nil {
		t.Fatal(err)
	}

	expiredResetLink(t, pool, "after-kill")
	next := startWorker(t, pool, nil)
	waitFor(t, "the cleanup after a killed worker", func() bool {
		return count(t, pool, `SELECT count(*) FROM "PasswordResetToken"`) == 0
	})
	if code, _ := next.stopAndWait(t); code != 0 {
		t.Fatalf("exit %d", code)
	}
}

// A job still running when the grace period ends is cancelled: the worker
// exits 1 soon after the grace period, not when the job would have ended.
func TestWorkerCancelsAJobStillRunningAfterTheGracePeriod(t *testing.T) {
	t.Parallel()
	pool := schemaDB(t)
	migrateRiver(t, pool)
	expiredResetLink(t, pool, "blocked")

	// Someone holds the table: the cleanup waits (up to its 5 s lock timeout).
	ctx := context.Background()
	holder, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = holder.Rollback(ctx) }() // moot after the test ends
	if _, err := holder.Exec(ctx, `LOCK TABLE "PasswordResetToken" IN ACCESS EXCLUSIVE MODE`); err != nil {
		t.Fatal(err)
	}

	w := startWorker(t, pool, map[string]string{"LOOKLY_SHUTDOWN_GRACE": "1s"})
	waitFor(t, "the cleanup to be running", func() bool {
		return count(t, pool, `SELECT count(*) FROM river.river_job WHERE state = 'running'`) == 1
	})
	code, took := w.stopAndWait(t)
	if code != 1 {
		t.Errorf("exit %d, want 1 (a job was cut off)", code)
	}
	if took > 4*time.Second {
		t.Errorf("stopping took %s: the job was not cancelled after the 1 s grace period", took)
	}
	if !strings.Contains(w.stdout.String(), "cancelling them") {
		t.Errorf("not logged:\n%s", w.stdout.String())
	}
	if err := holder.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	if count(t, pool, `SELECT count(*) FROM "PasswordResetToken"`) != 1 {
		t.Error("the cancelled cleanup changed data")
	}
}

// The server answers but refuses (here: no such database). The reason is
// given as its SQLSTATE; the database name, user and host are not printed.
func TestWorkerSaysWhyTheDatabaseRefusedWithoutConnectionDetails(t *testing.T) {
	t.Parallel()
	u, err := url.Parse(dbtest.AdminURL(t))
	if err != nil {
		t.Fatal(err)
	}
	u.Path = "/lookly_no_such_database"
	var stderr bytes.Buffer
	code := app.Run(context.Background(), []string{"worker"},
		configtest.Getenv(map[string]string{"DATABASE_URL": u.String()}), &bytes.Buffer{}, &stderr)
	msg := stderr.String()
	if code != 1 || !strings.Contains(msg, "cannot reach the database") || !strings.Contains(msg, "SQLSTATE 3D000") {
		t.Fatalf("exit %d, stderr %q", code, msg)
	}
	for _, leak := range []string{"lookly_no_such_database", u.Hostname(), u.User.Username()} {
		if leak != "" && strings.Contains(msg, leak) {
			t.Errorf("stderr shows %q: %s", leak, msg)
		}
	}
}

// The worker's storage sweep runs at start with the operator's limit
// (STORAGE_SWEEP_MAX_REMOVALS): over it the sweep removes nothing and its
// job fails; within it the orphaned files go.
func TestWorkerSweepsTheStorageWithTheOperatorsLimit(t *testing.T) {
	t.Parallel()
	pool := schemaDB(t)
	migrateRiver(t, pool)
	uploads := t.TempDir()
	const kept = "users/u/00000001-4e5f-4a6b-8c7d-9e0f1a2b3c4d.jpg"
	ctx := context.Background()
	for _, sql := range []string{
		`INSERT INTO "User" ("id","email","passwordHash","updatedAt") VALUES ('u','u@test.local','x',now())`,
		`INSERT INTO "WardrobeItem" ("id","userId","category","updatedAt") VALUES ('item1','u','shirt',now())`,
		`INSERT INTO "WardrobeImage" ("id","wardrobeItemId","storageKey") VALUES ('img1','item1','` + kept + `')`,
	} {
		if _, err := pool.Exec(ctx, sql); err != nil {
			t.Fatal(err)
		}
	}
	old := time.Now().Add(-2 * time.Hour)
	orphans := []string{"users/u/00000002-4e5f-4a6b-8c7d-9e0f1a2b3c4d.jpg", "users/u/00000003-4e5f-4a6b-8c7d-9e0f1a2b3c4d.jpg", "users/v/00000004-4e5f-4a6b-8c7d-9e0f1a2b3c4d.jpg"}
	for _, key := range append([]string{kept}, orphans...) {
		path := filepath.Join(uploads, filepath.FromSlash(key))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("image"), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(path, old, old); err != nil {
			t.Fatal(err)
		}
	}
	stored := func() int {
		n := 0
		for _, key := range append([]string{kept}, orphans...) {
			if _, err := os.Stat(filepath.Join(uploads, filepath.FromSlash(key))); err == nil {
				n++
			}
		}
		return n
	}

	strict := startWorker(t, pool, map[string]string{"STORAGE_LOCAL_DIR": uploads, "STORAGE_SWEEP_MAX_REMOVALS": "2"})
	waitFor(t, "the refused sweep", func() bool { return strings.Contains(strict.stdout.String(), `"msg":"storage sweep failed"`) })
	if stored() != 4 || !strings.Contains(strict.stdout.String(), "3 orphans") {
		t.Fatalf("%d files left; log:\n%s", stored(), strict.stdout.String())
	}
	if code, _ := strict.stopAndWait(t); code != 0 {
		t.Fatalf("exit %d", code)
	}

	enough := startWorker(t, pool, map[string]string{"STORAGE_LOCAL_DIR": uploads, "STORAGE_SWEEP_MAX_REMOVALS": "3"})
	waitFor(t, "the sweep", func() bool { return strings.Contains(enough.stdout.String(), `"msg":"storage sweep done"`) })
	if _, err := os.Stat(filepath.Join(uploads, filepath.FromSlash(kept))); err != nil || stored() != 1 {
		t.Fatalf("%d files left (the named one: %v); log:\n%s", stored(), err, enough.stdout.String())
	}
	if code, _ := enough.stopAndWait(t); code != 0 {
		t.Fatalf("exit %d", code)
	}
}

// `lookly migrate` on an empty database makes the whole schema and the
// queue's; a second run changes nothing; a database it cannot continue from
// is refused with the reason and left alone.
func TestMigrateMakesTheSchemaOnceAndRefusesAnUnknownDatabase(t *testing.T) {
	t.Parallel()
	pool := dbtest.Empty(t)
	var stdout, stderr bytes.Buffer
	// The database's settings are all it needs: no secret of the server.
	onlyDatabase := func(k string) (string, bool) {
		switch k {
		case "LOOKLY_ENV":
			return "test", true
		case "DATABASE_URL":
			return dbtest.URL(pool), true
		}
		return "", false
	}
	if code := app.Run(context.Background(), []string{"migrate"}, onlyDatabase, &stdout, &stderr); code != 0 {
		t.Fatalf("exit %d: %s %s", code, stdout.String(), stderr.String())
	}
	if !strings.Contains(stdout.String(), "schema: migrations applied") || !strings.Contains(stdout.String(), "river migrations applied") {
		t.Errorf("the log: %s", stdout.String())
	}
	want := dbtest.Catalog(t, schemaDB(t))
	got := dbtest.Catalog(t, pool)
	for k := range got {
		if strings.Contains(k, "river") {
			delete(got, k)
		}
	}
	if diff := dbtest.Diff(want, got); diff != "" {
		t.Fatalf("not the Go schema:\n%s", diff)
	}
	if n := count(t, pool, `SELECT count(*) FROM information_schema.tables WHERE table_schema = 'river' AND table_name = 'river_job'`); n != 1 {
		t.Errorf("river_job: %d", n)
	}
	stdout.Reset()
	if code := app.Run(context.Background(), []string{"migrate"}, appEnv(pool, nil), &stdout, &bytes.Buffer{}); code != 0 || !strings.Contains(stdout.String(), "schema: already current") {
		t.Errorf("again: exit %d, %s", code, stdout.String())
	}

	other := dbtest.Empty(t)
	if _, err := other.Exec(context.Background(), `CREATE TABLE "Other" ("id" text)`); err != nil {
		t.Fatal(err)
	}
	stdout.Reset()
	if code := app.Run(context.Background(), []string{"migrate"}, appEnv(other, nil), &stdout, &bytes.Buffer{}); code != 1 || !strings.Contains(stdout.String(), "without a history") {
		t.Errorf("unknown database: exit %d, %s", code, stdout.String())
	}
	if n := count(t, other, `SELECT count(*) FROM information_schema.tables WHERE table_schema IN ('public', 'river')`); n != 1 {
		t.Errorf("the unknown database was changed: %d tables", n)
	}
}
