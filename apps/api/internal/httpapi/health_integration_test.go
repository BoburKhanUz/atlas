//go:build integration

// Integration tests run against a real PostgreSQL 16 named by
// LOOKLY_TEST_DATABASE_URL: go test -tags integration ./... (CI job "api").

package httpapi_test

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"os"
	"testing"
	"time"

	"lookly/internal/config"
	"lookly/internal/config/configtest"
	"lookly/internal/database"
	"lookly/internal/health"
	"lookly/internal/httpapi"
)

func testConfig(t *testing.T, url string) config.Config {
	t.Helper()
	cfg, err := config.Load(configtest.Getenv(map[string]string{"DATABASE_URL": url}))
	if err != nil {
		t.Fatal(err)
	}
	return cfg
}

func TestHealthAgainstPostgreSQL(t *testing.T) {
	url := os.Getenv("LOOKLY_TEST_DATABASE_URL")
	if url == "" {
		t.Fatal("LOOKLY_TEST_DATABASE_URL is not set (integration tests need a PostgreSQL 16)")
	}
	pool, err := database.Open(context.Background(), testConfig(t, url))
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	// A real first connection (TCP, startup, password auth) can take longer
	// than the unit tests' 50 ms: use the production ping timeout.
	s := httpapi.NewServer(httpapi.Services{Health: health.New(pool, "1.2.3", 2*time.Second)})
	h := httpapi.New(s, slog.New(slog.NewJSONHandler(io.Discard, nil)))
	checkHealth(t, h, http.StatusOK, healthBody{"ok", "ok", "1.2.3"})
}

func TestHealthWhenPostgreSQLIsNotThere(t *testing.T) {
	// Port 1 on localhost: nothing listens, the connection is refused at once.
	pool, err := database.Open(context.Background(), testConfig(t, "postgresql://lookly@127.0.0.1:1/lookly"))
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	h, _ := healthHandler(t, pool)
	checkHealth(t, h, http.StatusServiceUnavailable, healthBody{"degraded", "unreachable", "1.2.3"})
}
