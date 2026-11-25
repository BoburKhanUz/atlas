package httpapi_test

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"testing"
	"time"

	"lookly/internal/contracttest"
	"lookly/internal/health"
	"lookly/internal/httpapi"
)

type pinger func(ctx context.Context) error

func (p pinger) Ping(ctx context.Context) error { return p(ctx) }

func healthHandler(t *testing.T, db health.Pinger) (http.Handler, *logs) {
	t.Helper()
	l := &logs{}
	s := httpapi.NewServer(httpapi.Services{Health: health.New(db, "1.2.3", 50*time.Millisecond)})
	return httpapi.New(s, slog.New(slog.NewJSONHandler(l, nil)), &httpapi.Gate{}), l
}

type healthBody struct {
	Status   string `json:"status"`
	Database string `json:"database"`
	Version  string `json:"version"`
}

func checkHealth(t *testing.T, h http.Handler, wantStatus int, want healthBody) {
	t.Helper()
	w := do(h, http.MethodGet, "/api/health", nil, nil)
	if w.Code != wantStatus {
		t.Fatalf("status %d, want %d: %s", w.Code, wantStatus, w.Body)
	}
	contracttest.Response(t, http.MethodGet, "/api/health", w.Code, w.Header(), w.Body.Bytes())
	var got healthBody
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Errorf("body %+v, want %+v", got, want)
	}
	if cc := w.Header().Get("Cache-Control"); cc != "no-store" {
		t.Errorf("Cache-Control %q", cc)
	}
}

func TestHealthDatabaseUp(t *testing.T) {
	t.Parallel()
	h, _ := healthHandler(t, pinger(func(context.Context) error { return nil }))
	checkHealth(t, h, http.StatusOK, healthBody{"ok", "ok", "1.2.3"})
}

func TestHealthDatabaseDown(t *testing.T) {
	t.Parallel()
	h, l := healthHandler(t, pinger(func(context.Context) error {
		return errors.New("dial tcp db.internal:5432: connect: connection refused")
	}))
	checkHealth(t, h, http.StatusServiceUnavailable, healthBody{"degraded", "unreachable", "1.2.3"})
	if !strings.Contains(l.String(), "database unreachable") || !strings.Contains(l.String(), "connection refused") {
		t.Errorf("the cause is not logged: %s", l.String())
	}
}

func TestHealthDatabaseTooSlow(t *testing.T) {
	t.Parallel()
	h, _ := healthHandler(t, pinger(func(ctx context.Context) error {
		<-ctx.Done() // a database that never answers
		return ctx.Err()
	}))
	started := time.Now()
	checkHealth(t, h, http.StatusServiceUnavailable, healthBody{"degraded", "unreachable", "1.2.3"})
	if took := time.Since(started); took > 2*time.Second {
		t.Errorf("the check waited %s; the ping timeout is 50ms", took)
	}
}
