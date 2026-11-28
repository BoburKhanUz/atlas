//go:build integration

package migrations_test

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"lookly/internal/contracttest"
	"lookly/internal/dbtest"
	"lookly/migrations"
)

// prismaDatabase applies every Prisma migration, in order, each in one
// transaction (as `prisma migrate deploy` does), to a fresh database.
func prismaDatabase(t *testing.T) *pgxpool.Pool {
	t.Helper()
	pool := dbtest.Empty(t)
	dirs, err := filepath.Glob(contracttest.RepoPath("apps/api/testdata/prisma/migrations/*/migration.sql"))
	if err != nil || len(dirs) == 0 {
		t.Fatalf("no Prisma migrations found: %v", err)
	}
	slices.Sort(dirs)
	ctx := context.Background()
	for _, file := range dirs {
		sql, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := tx.Exec(ctx, string(sql)); err != nil {
			t.Fatalf("%s: %v", filepath.Base(filepath.Dir(file)), err)
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
	}
	return pool
}

func goDatabase(t *testing.T) *pgxpool.Pool {
	t.Helper()
	pool := dbtest.Empty(t)
	if err := migrations.Apply(context.Background(), pool); err != nil {
		t.Fatalf("apply Go migrations: %v", err)
	}
	return pool
}

func TestTheGoSchemaEqualsThePrismaSchema(t *testing.T) {
	t.Parallel()
	prisma := dbtest.Catalog(t, prismaDatabase(t))
	golang := dbtest.Catalog(t, goDatabase(t))
	if diff := dbtest.Diff(prisma, golang); diff != "" {
		t.Fatalf("the Go migrations differ from the Prisma schema (want = Prisma, got = Go):\n%s", diff)
	}
	// The comparison covers what matters, not an empty catalog.
	for _, want := range []string{
		`table public."Session"`,
		`column public."Session"."familyId"`,
		`index public."IdempotencyKey_userId_route_key_key"`,
		`constraint public."Session"."Session_familyId_fkey"`,
		`function public.atlas_now()`,
		`marker legacyCutoverAt`,
	} {
		if _, ok := golang[want]; !ok {
			t.Errorf("the catalog lacks %s", want)
		}
	}
}

func TestADifferenceIsCaught(t *testing.T) {
	t.Parallel()
	pool := goDatabase(t)
	before := dbtest.Catalog(t, pool)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `ALTER TABLE "User" ADD COLUMN "nickname" text;
		ALTER TABLE "Session" ALTER COLUMN "lastUsedAt" SET DEFAULT CURRENT_TIMESTAMP;
		CREATE INDEX "Outfit_name_idx" ON "Outfit" ("name");
		ALTER TABLE "Outfit" ADD CONSTRAINT "Outfit_name_check" CHECK (length("name") < 100);
		CREATE OR REPLACE FUNCTION public.atlas_now() RETURNS timestamp(3) LANGUAGE sql STABLE AS $$ SELECT now()::timestamp(3) $$;
		CREATE FUNCTION public.touch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
		CREATE TRIGGER "User_touch" BEFORE UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION public.touch();
		INSERT INTO "SystemMarker" ("key", "value") VALUES ('extra', now())`); err != nil {
		t.Fatal(err)
	}
	diff := dbtest.Diff(before, dbtest.Catalog(t, pool))
	for _, want := range []string{
		`column public."User".nickname`, `column public."Session"."lastUsedAt"`, `index public."Outfit_name_idx"`,
		`constraint public."Outfit"."Outfit_name_check"`, `function public.atlas_now()`, `function public.touch()`,
		`trigger public."User"."User_touch"`, `rows public."SystemMarker"`, `marker extra`,
	} {
		if !strings.Contains(diff, want) {
			t.Errorf("diff does not name %s:\n%s", want, diff)
		}
	}
}

func TestApplyingTwiceChangesNothing(t *testing.T) {
	t.Parallel()
	pool := goDatabase(t)
	before := dbtest.Catalog(t, pool)
	if err := migrations.Apply(context.Background(), pool); err != nil {
		t.Fatal(err)
	}
	if diff := dbtest.Diff(before, dbtest.Catalog(t, pool)); diff != "" {
		t.Fatalf("second apply changed the schema:\n%s", diff)
	}
}
