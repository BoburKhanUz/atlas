// Package dbtest gives integration tests throwaway PostgreSQL databases.
// LOOKLY_TEST_DATABASE_URL names a PostgreSQL 16 where the user may create
// databases; each test gets its own database, dropped when the test ends.
// Only test files import this package.
package dbtest

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/url"
	"os"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AdminURL is the test server's URL. Integration tests fail, never skip,
// without it.
func AdminURL(t testing.TB) string {
	t.Helper()
	u := os.Getenv("LOOKLY_TEST_DATABASE_URL")
	if u == "" {
		t.Fatal("LOOKLY_TEST_DATABASE_URL is not set (integration tests need a PostgreSQL 16)")
	}
	return u
}

// Empty creates a fresh, empty database and returns a pool on it, plus its
// URL through URL(pool). The database is dropped when the test ends.
func Empty(t testing.TB) *pgxpool.Pool {
	t.Helper()
	ctx := context.Background()
	admin := AdminURL(t)
	var b [6]byte
	_, _ = rand.Read(b[:]) // crypto/rand.Read never fails
	name := "lookly_t_" + hex.EncodeToString(b[:])

	conn, err := pgx.Connect(ctx, admin)
	if err != nil {
		t.Fatalf("connect to the test server: %v", err)
	}
	if _, err := conn.Exec(ctx, "CREATE DATABASE "+name); err != nil {
		conn.Close(ctx)
		t.Fatalf("create database: %v", err)
	}
	conn.Close(ctx)

	// Registered first, so the database is dropped even if the rest fails.
	var pool *pgxpool.Pool
	t.Cleanup(func() {
		if pool != nil {
			pool.Close()
		}
		conn, err := pgx.Connect(context.Background(), admin)
		if err != nil {
			t.Errorf("drop %s: %v", name, err)
			return
		}
		defer conn.Close(context.Background())
		if _, err := conn.Exec(context.Background(), "DROP DATABASE IF EXISTS "+name+" WITH (FORCE)"); err != nil {
			t.Errorf("drop %s: %v", name, err)
		}
	})
	// The admin URL must be a URL (postgresql://…), not key=value pairs.
	u, err := url.Parse(admin)
	if err != nil || u.Scheme == "" {
		t.Fatal("LOOKLY_TEST_DATABASE_URL must be a postgresql:// URL")
	}
	u.Path = "/" + name
	if pool, err = pgxpool.New(ctx, u.String()); err != nil {
		t.Fatal(err)
	}
	return pool
}

// URL is the connection URL of a pool made by Empty.
func URL(pool *pgxpool.Pool) string { return pool.Config().ConnString() }

// InstallTestClock replaces atlas_now() with a clock the test sets
// (SetClock); unset, it is the real clock. The Node integration tests use
// the same technique.
func InstallTestClock(t testing.TB, pool *pgxpool.Pool) {
	t.Helper()
	_, err := pool.Exec(context.Background(), `
		CREATE TABLE IF NOT EXISTS atlas_test_clock (id int PRIMARY KEY CHECK (id = 1), t timestamp(3));
		INSERT INTO atlas_test_clock VALUES (1, NULL) ON CONFLICT (id) DO NOTHING;
		CREATE OR REPLACE FUNCTION public.atlas_now() RETURNS timestamp(3) LANGUAGE sql STABLE AS $$
			SELECT coalesce((SELECT t FROM atlas_test_clock WHERE id = 1),
			                date_trunc('milliseconds', now() AT TIME ZONE 'UTC')::timestamp(3)) $$`)
	if err != nil {
		t.Fatalf("install test clock: %v", err)
	}
}

// SetClock makes atlas_now() return at (in UTC, millisecond precision).
func SetClock(t testing.TB, pool *pgxpool.Pool, at time.Time) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `UPDATE atlas_test_clock SET t = $1 WHERE id = 1`, at.UTC().Truncate(time.Millisecond)); err != nil {
		t.Fatalf("set clock: %v", err)
	}
}

// ignored are the bookkeeping tables of the migration tools and the tests.
var ignored = []string{"_prisma_migrations", "goose_db_version", "goose_db_version_id_seq", "atlas_test_clock"}

// catalogQueries describe the public schema, one row per object: a key
// naming the object and its definition. Column order is left out (a dropped
// and re-added column changes positions, not meaning).
var catalogQueries = []string{
	`SELECT 'table public.' || quote_ident(c.relname), c.relkind::text
	   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
	  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S') AND NOT (c.relname = ANY($1))`,
	`SELECT 'column public.' || quote_ident(c.relname) || '.' || quote_ident(a.attname),
	        format_type(a.atttypid, a.atttypmod)
	        || CASE WHEN a.attnotnull THEN ' not null' ELSE '' END
	        || coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), '')
	        || CASE WHEN a.attidentity <> '' THEN ' identity ' || a.attidentity::text ELSE '' END
	        || CASE WHEN a.attgenerated <> '' THEN ' generated' ELSE '' END
	   FROM pg_attribute a
	   JOIN pg_class c ON c.oid = a.attrelid
	   JOIN pg_namespace n ON n.oid = c.relnamespace
	   LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
	  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped
	    AND NOT (c.relname = ANY($1))`,
	`SELECT 'constraint public.' || quote_ident(c.relname) || '.' || quote_ident(k.conname), pg_get_constraintdef(k.oid)
	   FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
	  WHERE n.nspname = 'public' AND NOT (c.relname = ANY($1))`,
	`SELECT 'index public.' || quote_ident(indexname), indexdef
	   FROM pg_indexes WHERE schemaname = 'public' AND NOT (tablename = ANY($1))`,
	`SELECT 'function public.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', pg_get_functiondef(p.oid)
	   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND NOT $1::text[] IS NULL`,
	`SELECT 'trigger public.' || quote_ident(c.relname) || '.' || quote_ident(g.tgname), pg_get_triggerdef(g.oid)
	   FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
	  WHERE n.nspname = 'public' AND NOT g.tgisinternal AND NOT (c.relname = ANY($1))`,
	`SELECT 'type public.' || t.typname, t.typtype::text || coalesce(' ' || string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder), '')
	   FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace LEFT JOIN pg_enum e ON e.enumtypid = t.oid
	  WHERE n.nspname = 'public' AND t.typtype IN ('e', 'd', 'c') AND NOT $1::text[] IS NULL
	    AND NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.reltype = t.oid)
	  GROUP BY t.typname, t.typtype`,
}

// Catalog describes the public schema of the database: object key →
// definition. It also counts the rows of every table (data a migration
// inserts) and lists the SystemMarker keys.
func Catalog(t testing.TB, pool *pgxpool.Pool) map[string]string {
	t.Helper()
	ctx := context.Background()
	out := map[string]string{}
	for _, q := range catalogQueries {
		rows, err := pool.Query(ctx, q, ignored)
		if err != nil {
			t.Fatalf("catalog query: %v\n%s", err, q)
		}
		for rows.Next() {
			var key, def string
			if err := rows.Scan(&key, &def); err != nil {
				t.Fatal(err)
			}
			out[key] = def
		}
		if err := rows.Err(); err != nil {
			t.Fatal(err)
		}
	}
	tables, err := pool.Query(ctx, `SELECT quote_ident(tablename) FROM pg_tables WHERE schemaname = 'public' AND NOT (tablename = ANY($1))`, ignored)
	if err != nil {
		t.Fatal(err)
	}
	names, err := pgx.CollectRows(tables, pgx.RowTo[string])
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range names {
		var n int64
		// The name comes from the catalog, quoted by quote_ident.
		if err := pool.QueryRow(ctx, "SELECT count(*) FROM public."+name).Scan(&n); err != nil {
			t.Fatal(err)
		}
		out["rows public."+name] = fmt.Sprint(n)
	}
	var exists bool
	if err := pool.QueryRow(ctx, `SELECT to_regclass('public."SystemMarker"') IS NOT NULL`).Scan(&exists); err != nil {
		t.Fatal(err)
	}
	if exists {
		rows, err := pool.Query(ctx, `SELECT "key" FROM "SystemMarker"`)
		if err != nil {
			t.Fatal(err)
		}
		keys, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			t.Fatal(err)
		}
		for _, k := range keys {
			out["marker "+k] = "set"
		}
	}
	return out
}

// Diff lists what differs between two catalogs, one object per line:
// "- key" only in want, "+ key" only in got, "~ key" defined differently.
func Diff(want, got map[string]string) string {
	keys := map[string]bool{}
	for k := range want {
		keys[k] = true
	}
	for k := range got {
		keys[k] = true
	}
	sorted := make([]string, 0, len(keys))
	for k := range keys {
		sorted = append(sorted, k)
	}
	slices.Sort(sorted)
	var b strings.Builder
	for _, k := range sorted {
		w, inWant := want[k]
		g, inGot := got[k]
		switch {
		case !inGot:
			fmt.Fprintf(&b, "- %s: %s\n", k, w)
		case !inWant:
			fmt.Fprintf(&b, "+ %s: %s\n", k, g)
		case w != g:
			fmt.Fprintf(&b, "~ %s:\n    want %s\n    got  %s\n", k, w, g)
		}
	}
	return b.String()
}
