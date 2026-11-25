package database_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"lookly/internal/config"
	"lookly/internal/database"
)

func TestADriverRejectionNeverQuotesTheURL(t *testing.T) {
	t.Parallel()
	// The URL form is valid (config accepts it), the option is not.
	url := "postgresql://atlas:s3cret-pass@db.internal:5432/atlas?connect_timeout=soon"
	cfg, err := config.Load(func(k string) (string, bool) {
		return map[string]string{"LOOKLY_ENV": "test", "DATABASE_URL": url}[k], true
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = database.Open(context.Background(), cfg)
	if err == nil {
		t.Fatal("accepted an invalid connect_timeout")
	}
	if !strings.Contains(err.Error(), "DATABASE_URL") || strings.Contains(err.Error(), "s3cret-pass") || strings.Contains(err.Error(), "db.internal") {
		t.Fatalf("error %q", err)
	}
}

func TestThePoolUsesTheConfiguredSize(t *testing.T) {
	t.Parallel()
	cfg, err := config.Load(func(k string) (string, bool) {
		v, ok := map[string]string{"LOOKLY_ENV": "test", "DATABASE_URL": "postgresql://u@127.0.0.1:1/db", "LOOKLY_DB_MAX_CONNS": "7"}[k]
		return v, ok
	})
	if err != nil {
		t.Fatal(err)
	}
	pool, err := database.Open(context.Background(), cfg) // lazy: no connection is made
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if got := pool.Config().MaxConns; got != 7 {
		t.Errorf("MaxConns %d", got)
	}
	if got := pool.Config().ConnConfig.ConnectTimeout; got != database.ConnectTimeout {
		t.Errorf("ConnectTimeout %s", got)
	}
}

func TestDescribeNeverShowsConnectionDetails(t *testing.T) {
	t.Parallel()
	cfg, err := config.Load(func(k string) (string, bool) {
		v, ok := map[string]string{"LOOKLY_ENV": "test", "DATABASE_URL": "postgresql://secretuser:s3cret-pass@127.0.0.1:1/proddb"}[k]
		return v, ok
	})
	if err != nil {
		t.Fatal(err)
	}
	pool, err := database.Open(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	pingErr := pool.Ping(context.Background()) // nothing listens on port 1
	if pingErr == nil {
		t.Fatal("connected to port 1")
	}
	// The driver's own text is what must not be passed on.
	if !strings.Contains(pingErr.Error(), "secretuser") {
		t.Fatalf("the driver error no longer names the user (%q): revisit Describe", pingErr)
	}
	got := database.Describe(pingErr)
	if got != "cannot connect (no answer from the server)" {
		t.Errorf("Describe = %q", got)
	}
	for _, leak := range []string{"secretuser", "s3cret-pass", "proddb", "127.0.0.1"} {
		if strings.Contains(got, leak) {
			t.Errorf("Describe shows %q: %s", leak, got)
		}
	}
	if got := database.Describe(errors.New(`relation "river.river_job" does not exist`)); got != `relation "river.river_job" does not exist` {
		t.Errorf("a query error is changed: %q", got)
	}
	if got := database.Describe(context.DeadlineExceeded); got != "timed out" {
		t.Errorf("timeout: %q", got)
	}
}
