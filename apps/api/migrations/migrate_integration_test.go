//go:build integration

package migrations_test

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"lookly/internal/dbtest"
	"lookly/migrations"
)

// withPrismaHistory is a database as `prisma migrate deploy` leaves it: the
// schema and Prisma's own table, with these migrations recorded (finished,
// or not, as named).
func withPrismaHistory(t *testing.T, names []string, unfinished string) *pgxpool.Pool {
	t.Helper()
	pool := prismaDatabase(t)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `CREATE TABLE "_prisma_migrations" (
		"id" varchar(36) PRIMARY KEY, "checksum" varchar(64) NOT NULL, "finished_at" timestamptz, "migration_name" varchar(255) NOT NULL,
		"logs" text, "rolled_back_at" timestamptz, "started_at" timestamptz NOT NULL DEFAULT now(), "applied_steps_count" integer NOT NULL DEFAULT 0)`); err != nil {
		t.Fatal(err)
	}
	for i, name := range names {
		finished := "now()"
		if name == unfinished {
			finished = "NULL"
		}
		if _, err := pool.Exec(ctx, fmt.Sprintf(`INSERT INTO "_prisma_migrations" ("id","checksum","finished_at","migration_name","applied_steps_count") VALUES ($1,'x',%s,$2,1)`, finished),
			fmt.Sprintf("m%02d", i), name); err != nil {
			t.Fatal(err)
		}
	}
	return pool
}

func gooseVersions(t *testing.T, pool *pgxpool.Pool) []int64 {
	t.Helper()
	rows, err := pool.Query(context.Background(), `SELECT version_id FROM goose_db_version WHERE is_applied ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []int64
	for rows.Next() {
		var v int64
		if err := rows.Scan(&v); err != nil {
			t.Fatal(err)
		}
		out = append(out, v)
	}
	return out
}

func TestAnEmptyDatabaseGetsEveryMigration(t *testing.T) {
	t.Parallel()
	pool := dbtest.Empty(t)
	out, err := migrations.Migrate(context.Background(), pool)
	if err != nil || out.RecordedBaseline || len(out.Applied) == 0 || out.Applied[0] != 1 {
		t.Fatalf("%+v %v", out, err)
	}
	if diff := dbtest.Diff(dbtest.Catalog(t, goDatabase(t)), dbtest.Catalog(t, pool)); diff != "" {
		t.Fatalf("not the Go schema:\n%s", diff)
	}
	// Again: nothing to do, nothing changed.
	before := dbtest.Catalog(t, pool)
	if again, err := migrations.Migrate(context.Background(), pool); err != nil || len(again.Applied) != 0 || again.RecordedBaseline {
		t.Fatalf("again: %+v %v", again, err)
	}
	if diff := dbtest.Diff(before, dbtest.Catalog(t, pool)); diff != "" {
		t.Fatalf("the second run changed the schema:\n%s", diff)
	}
}

func TestADatabasePrismaMadeKeepsItsSchemaAndDataAndContinuesInGo(t *testing.T) {
	t.Parallel()
	pool := withPrismaHistory(t, migrations.PrismaHistory, "")
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `INSERT INTO "User" ("id","email","passwordHash","updatedAt") VALUES ('u1','kept@example.test','x',now())`); err != nil {
		t.Fatal(err)
	}
	before := dbtest.Catalog(t, pool)
	out, err := migrations.Migrate(ctx, pool)
	if err != nil || !out.RecordedBaseline {
		t.Fatalf("%+v %v", out, err)
	}
	for _, v := range out.Applied {
		if v == 1 {
			t.Fatal("the baseline was run on a database that has it")
		}
	}
	if got := gooseVersions(t, pool); len(got) < 2 || got[0] != 0 || got[1] != 1 {
		t.Fatalf("versions %v", got)
	}
	after := dbtest.Catalog(t, pool)
	for k := range after {
		if k == `table public.goose_db_version` || k == `column public.goose_db_version.id` {
			delete(after, k)
		}
	}
	if diff := dbtest.Diff(before, after); diff != "" && len(out.Applied) == 0 {
		t.Fatalf("recording the baseline changed the schema:\n%s", diff)
	}
	var email string
	if err := pool.QueryRow(ctx, `SELECT "email" FROM "User" WHERE "id" = 'u1'`).Scan(&email); err != nil || email != "kept@example.test" {
		t.Fatalf("the data: %q %v", email, err)
	}
	if again, err := migrations.Migrate(ctx, pool); err != nil || again.RecordedBaseline || len(again.Applied) != 0 {
		t.Fatalf("again: %+v %v", again, err)
	}
}

func TestADatabaseItCannotContinueFromIsLeftAlone(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	partial := migrations.PrismaHistory[:len(migrations.PrismaHistory)-1]
	extra := append(append([]string{}, migrations.PrismaHistory...), "20270101000000_unknown")
	for name, pool := range map[string]*pgxpool.Pool{
		"a Prisma migration missing":    withPrismaHistory(t, partial, ""),
		"a Prisma migration unknown":    withPrismaHistory(t, extra, ""),
		"a Prisma migration unfinished": withPrismaHistory(t, migrations.PrismaHistory, migrations.PrismaHistory[3]),
		"tables without a history at all": func() *pgxpool.Pool {
			p := dbtest.Empty(t)
			if _, err := p.Exec(ctx, `CREATE TABLE "Other" ("id" text)`); err != nil {
				t.Fatal(err)
			}
			return p
		}(),
	} {
		before := dbtest.Catalog(t, pool)
		out, err := migrations.Migrate(ctx, pool)
		if !errors.Is(err, migrations.ErrUnknownDatabase) || out.RecordedBaseline || len(out.Applied) != 0 {
			t.Errorf("%s: %+v %v", name, out, err)
		}
		if diff := dbtest.Diff(before, dbtest.Catalog(t, pool)); diff != "" {
			t.Errorf("%s: the database was changed:\n%s", name, diff)
		}
	}
}

func TestRunsAtTheSameTimeWaitForEachOther(t *testing.T) {
	t.Parallel()
	for name, pool := range map[string]*pgxpool.Pool{
		"an empty database": dbtest.Empty(t),
		"one Prisma made":   withPrismaHistory(t, migrations.PrismaHistory, ""),
	} {
		const runs = 8
		var wg sync.WaitGroup
		start := make(chan struct{})
		errs := make([]error, runs)
		outs := make([]migrations.Outcome, runs)
		for i := range runs {
			wg.Add(1)
			go func() {
				defer wg.Done()
				<-start
				outs[i], errs[i] = migrations.Migrate(context.Background(), pool)
			}()
		}
		close(start)
		wg.Wait()
		did := 0
		for i, err := range errs {
			if err != nil {
				t.Fatalf("%s: run %d: %v", name, i, err)
			}
			if len(outs[i].Applied) > 0 || outs[i].RecordedBaseline {
				did++
			}
		}
		if did != 1 {
			t.Fatalf("%s: %d runs changed the database", name, did)
		}
		if got := gooseVersions(t, pool); len(got) != 2 {
			t.Fatalf("%s: versions %v", name, got)
		}
	}
}
