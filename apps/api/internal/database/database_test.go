package database_test

import (
	"context"
	"strings"
	"testing"

	"lookly/internal/config"
	"lookly/internal/database"
)

func TestADriverRejectionNeverQuotesTheURL(t *testing.T) {
	t.Parallel()
	// The URL form is valid (config accepts it), the option is not.
	url := "postgresql://atlas:s3cret-pass@db.internal:5432/atlas?sslmode=bogus"
	cfg, err := config.Load(func(k string) (string, bool) {
		return map[string]string{"LOOKLY_ENV": "test", "DATABASE_URL": url}[k], true
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = database.Open(context.Background(), cfg)
	if err == nil {
		t.Fatal("accepted an invalid sslmode")
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
