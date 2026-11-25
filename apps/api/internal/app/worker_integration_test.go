//go:build integration

package app_test

import (
	"bytes"
	"context"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"lookly/internal/app"
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
	vars := map[string]string{
		"LOOKLY_ENV":            "test",
		"DATABASE_URL":          dbtest.URL(pool),
		"LOOKLY_SHUTDOWN_GRACE": "5s",
	}
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

func TestWorkerRunsTheCleanupAtStartAndStopsOnASignal(t *testing.T) {
	t.Parallel()
	pool := schemaDB(t)
	if code := app.Run(context.Background(), []string{"migrate", "river"}, appEnv(pool, nil), &bytes.Buffer{}, &bytes.Buffer{}); code != 0 {
		t.Fatal("migrate river failed")
	}
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `INSERT INTO "User" ("id","email","passwordHash","updatedAt") VALUES ('u','u@test.local','x',now());
		INSERT INTO "PasswordResetToken" ("id","userId","tokenHash","expiresAt") VALUES ('expired','u','h', now() AT TIME ZONE 'UTC' - interval '1 hour')`); err != nil {
		t.Fatal(err)
	}

	runCtx, stop := context.WithCancel(ctx)
	defer stop()
	stdout := &syncBuffer{}
	done := make(chan int, 1)
	go func() { done <- app.Run(runCtx, []string{"worker"}, appEnv(pool, nil), stdout, &syncBuffer{}) }()

	deadline := time.Now().Add(15 * time.Second)
	for {
		var left int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM "PasswordResetToken"`).Scan(&left); err != nil {
			t.Fatal(err)
		}
		if left == 0 && strings.Contains(stdout.String(), `"msg":"cleanup done"`) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("the cleanup did not run at start: %d reset links left\n%s", left, stdout.String())
		}
		time.Sleep(100 * time.Millisecond)
	}
	if !strings.Contains(stdout.String(), `"expiredResetLinksDeleted":1`) {
		t.Errorf("the counts are not logged: %s", stdout.String())
	}

	stop()
	select {
	case code := <-done:
		if code != 0 {
			t.Fatalf("exit %d:\n%s", code, stdout.String())
		}
	case <-time.After(15 * time.Second):
		t.Fatal("the worker did not stop")
	}
	if strings.Contains(stdout.String(), dbtest.URL(pool)) {
		t.Error("the log shows the database URL")
	}
}
