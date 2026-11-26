//go:build integration

package legal_test

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"lookly/internal/dbtest"
	"lookly/internal/legal"
	"lookly/migrations"
)

func database(t *testing.T) *pgxpool.Pool {
	t.Helper()
	pool := dbtest.Empty(t)
	if err := migrations.Apply(context.Background(), pool); err != nil {
		t.Fatal(err)
	}
	return pool
}

func exec(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
}

func count(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	return n
}

func addUser(t *testing.T, pool *pgxpool.Pool, id string) {
	t.Helper()
	exec(t, pool, `INSERT INTO "User" ("id","email","passwordHash","updatedAt") VALUES ($1, $1 || '@test.local', 'x', now())`, id)
}

// An account can disappear between the gate and the handler (its deletion
// commits in between): nothing is recorded for it.
func TestAcceptForAnAccountThatIsGone(t *testing.T) {
	t.Parallel()
	pool := database(t)
	err := legal.NewService(pool).Accept(context.Background(), "nobody", legal.Version, true)
	if !errors.Is(err, legal.ErrNoUser) {
		t.Fatalf("err %v, want ErrNoUser", err)
	}
	if n := count(t, pool, `SELECT count(*) FROM "LegalConsent"`); n != 0 {
		t.Errorf("%d consents recorded for nobody", n)
	}
}

func TestAcceptRecordsOncePerVersion(t *testing.T) {
	t.Parallel()
	pool := database(t)
	addUser(t, pool, "u1")
	addUser(t, pool, "u2")
	s := legal.NewService(pool)
	ctx := context.Background()
	for range 3 {
		if err := s.Accept(ctx, "u1", legal.Version, true); err != nil {
			t.Fatal(err)
		}
	}
	if n := count(t, pool, `SELECT count(*) FROM "LegalConsent" WHERE "userId" = 'u1' AND "version" = $1 AND "ageConfirmed"`, legal.Version); n != 1 {
		t.Errorf("%d consents for u1, want 1", n)
	}
	if n := count(t, pool, `SELECT count(*) FROM "LegalConsent" WHERE "userId" = 'u2'`); n != 0 {
		t.Errorf("%d consents for the other user", n)
	}
	if required, err := s.ConsentRequired(ctx, "u1"); err != nil || required {
		t.Errorf("u1: required %v, err %v", required, err)
	}
	if required, err := s.ConsentRequired(ctx, "u2"); err != nil || !required {
		t.Errorf("u2: required %v, err %v", required, err)
	}
	// What is recorded is what was given (the HTTP edge lets only a
	// confirmed age through).
	if err := s.Accept(ctx, "u2", legal.Version, false); err != nil {
		t.Fatal(err)
	}
	if n := count(t, pool, `SELECT count(*) FROM "LegalConsent" WHERE "userId" = 'u2' AND NOT "ageConfirmed"`); n != 1 {
		t.Errorf("%d unconfirmed consents for u2, want 1", n)
	}
}

// The consent check reads a bounded number of a user's consents, the newest
// first. A consent is only ever added for the texts current at that moment,
// so the newest decide; the test shows both that and the bound itself (with
// rows that real use cannot produce: a valid consent older than
// ConsentsRead outdated ones).
func TestTheConsentCheckReadsTheNewestConsents(t *testing.T) {
	t.Parallel()
	pool := database(t)
	addUser(t, pool, "u1")
	addUser(t, pool, "u2")
	s := legal.NewService(pool)
	ctx := context.Background()
	outdated := func(user string, n int, age string) {
		for i := range n {
			exec(t, pool, `INSERT INTO "LegalConsent" ("id","userId","version","ageConfirmed","acceptedAt") VALUES ($1, $2, $3, true, now() - $4::interval + $5 * interval '1 minute')`,
				fmt.Sprintf("%s-old%d", user, i), user, fmt.Sprintf("2020-01-01.%d", i+1), age, i)
		}
	}

	// u1: sixty outdated consents, then the current texts accepted.
	outdated("u1", 60, "100 days")
	if required, err := s.ConsentRequired(ctx, "u1"); err != nil || !required {
		t.Fatalf("sixty outdated consents: required %v, err %v", required, err)
	}
	if err := s.Accept(ctx, "u1", legal.Version, true); err != nil {
		t.Fatal(err)
	}
	if required, err := s.ConsentRequired(ctx, "u1"); err != nil || required {
		t.Errorf("after accepting: required %v, err %v", required, err)
	}

	// u2: a valid consent, then ConsentsRead outdated ones after it.
	exec(t, pool, `INSERT INTO "LegalConsent" ("id","userId","version","ageConfirmed","acceptedAt") VALUES ('u2-valid', 'u2', $1, true, now() - interval '200 days')`, legal.Version)
	outdated("u2", legal.ConsentsRead-1, "100 days")
	if required, err := s.ConsentRequired(ctx, "u2"); err != nil || required {
		t.Errorf("a valid consent among the %d newest: required %v, err %v", legal.ConsentsRead, required, err)
	}
	exec(t, pool, `INSERT INTO "LegalConsent" ("id","userId","version","ageConfirmed","acceptedAt") VALUES ('u2-last', 'u2', '2020-01-01.999', true, now())`)
	if required, err := s.ConsentRequired(ctx, "u2"); err != nil || !required {
		t.Errorf("a valid consent older than the %d newest: required %v, err %v", legal.ConsentsRead, required, err)
	}
}
