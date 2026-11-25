// Package app is the lookly command:
//   - serve: the HTTP API;
//   - worker: the background jobs (River);
//   - health: probes a running server (the container's health check: the
//     image has no shell or curl);
//   - migrate river: creates River's tables in their own schema.
//
// Later stages add `eval`; the Go schema migrations get a command at the
// cutover (B7, ADR 0007).
package app

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"lookly/internal/accounts"
	"lookly/internal/auth"
	"lookly/internal/config"
	"lookly/internal/database"
	"lookly/internal/health"
	"lookly/internal/httpapi"
	"lookly/internal/jobs"
	"lookly/internal/legal"
	"lookly/internal/maintenance"
	"lookly/internal/ratelimit"
	"lookly/internal/session"
)

// version is stamped at build time: -ldflags "-X lookly/internal/app.version=<v>".
var version = "dev"

const (
	usage = "usage: lookly serve | worker | health | migrate river"

	// Exit codes: 1 a runtime failure, 2 a usage or configuration error.
	exitFailure = 1
	exitUsage   = 2

	healthPingTimeout = 2 * time.Second
	healthProbeWait   = 3 * time.Second
)

// Server timeouts. Long work (AI, image variants) runs in background jobs,
// so no request needs more than these.
const (
	readHeaderTimeout = 5 * time.Second
	readTimeout       = 30 * time.Second
	writeTimeout      = 60 * time.Second
	idleTimeout       = 120 * time.Second
	maxHeaderBytes    = 16 << 10
)

// Run executes one command and returns the process exit code. ctx ends the
// command (main cancels it on SIGINT/SIGTERM).
func Run(ctx context.Context, args []string, getenv func(string) (string, bool), stdout, stderr io.Writer) int {
	switch strings.Join(args, " ") {
	case "serve":
		return serve(ctx, getenv, stdout, stderr)
	case "worker":
		return worker(ctx, getenv, stdout, stderr)
	case "health":
		return probe(ctx, getenv, stderr)
	case "migrate river":
		return migrateRiver(ctx, getenv, stdout, stderr)
	default:
		fmt.Fprintln(stderr, usage)
		return exitUsage
	}
}

// api builds the HTTP API over the database: the domain services, the gate
// every request passes, and the router generated from the contract.
func api(cfg config.Config, pool *pgxpool.Pool, log *slog.Logger) http.Handler {
	tokens := auth.NewTokens(cfg.JWTSecret)
	sessions := session.New(pool, session.Config{
		Tokens:     tokens,
		Keys:       session.Keys{Active: cfg.SessionEncKey, DecryptOnly: cfg.SessionDecryptKeys},
		AccessTTL:  cfg.AccessTokenTTL,
		RefreshTTL: cfg.RefreshTokenTTL,
		Log:        log,
	})
	consent := legal.NewService(pool)
	users := accounts.New(pool, sessions, ratelimit.New(pool, cfg.JWTSecret), consent, auth.Bcrypt{}, log)
	server := httpapi.NewServer(httpapi.Services{
		Health:       health.New(pool, version, healthPingTimeout),
		Accounts:     users,
		Sessions:     sessions,
		CookieSecure: cfg.CookieSecure,
		TrustProxy:   cfg.TrustProxy,
	})
	return httpapi.New(server, log, &httpapi.Gate{Tokens: tokens, Sessions: sessions, Consent: consent, TrustProxy: cfg.TrustProxy})
}

func serve(ctx context.Context, getenv func(string) (string, bool), stdout, stderr io.Writer) int {
	cfg, log, pool, code := open(ctx, getenv, stdout, stderr)
	if pool == nil {
		return code
	}
	defer pool.Close()

	handler := api(cfg, pool, log)

	listener, err := net.Listen("tcp", cfg.HTTPAddr)
	if err != nil {
		log.Error("cannot listen", "addr", cfg.HTTPAddr, "err", err.Error())
		return exitFailure
	}
	srv := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: readHeaderTimeout,
		ReadTimeout:       readTimeout,
		WriteTimeout:      writeTimeout,
		IdleTimeout:       idleTimeout,
		MaxHeaderBytes:    maxHeaderBytes,
		ErrorLog:          slog.NewLogLogger(log.Handler(), slog.LevelWarn),
		// Requests keep running when the stop signal arrives; Shutdown waits for them.
		BaseContext: func(net.Listener) context.Context { return context.WithoutCancel(ctx) },
	}
	log.Info("starting", "version", version, "addr", listener.Addr().String(), "config", cfg)

	served := make(chan error, 1)
	go func() { served <- srv.Serve(listener) }()

	select {
	case err := <-served:
		log.Error("server stopped", "err", err.Error())
		return exitFailure
	case <-ctx.Done():
	}
	log.Info("stopping", "grace", cfg.ShutdownGrace.String())
	shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), cfg.ShutdownGrace)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Error("requests still running when the grace period ended", "err", err.Error())
		// Close the remaining connections: their requests' contexts end, so
		// running queries are cancelled and pool.Close (deferred) does not wait
		// on them past the grace period.
		if err := srv.Close(); err != nil {
			log.Error("closing connections", "err", err.Error())
		}
		return exitFailure
	}
	if err := <-served; !errors.Is(err, http.ErrServerClosed) {
		log.Error("server stopped", "err", err.Error())
		return exitFailure
	}
	log.Info("stopped")
	return 0
}

// probe asks the local server's /api/health: exit 0 on 200, 1 otherwise.
// It reads only LOOKLY_HTTP_ADDR (the container has the server's settings).
func probe(ctx context.Context, getenv func(string) (string, bool), stderr io.Writer) int {
	addr := ":8080"
	if v, ok := getenv("LOOKLY_HTTP_ADDR"); ok && strings.TrimSpace(v) != "" {
		addr = strings.TrimSpace(v)
	}
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		fmt.Fprintln(stderr, "LOOKLY_HTTP_ADDR: must be host:port or :port")
		return exitUsage
	}
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = "127.0.0.1"
	}
	ctx, cancel := context.WithTimeout(ctx, healthProbeWait)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://"+net.JoinHostPort(host, port)+"/api/health", nil)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return exitFailure
	}
	// Straight to the local server: never through an HTTP proxy from the
	// environment.
	client := &http.Client{Transport: &http.Transport{Proxy: nil}}
	resp, err := client.Do(req)
	if err != nil {
		fmt.Fprintln(stderr, "unhealthy:", err)
		return exitFailure
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		fmt.Fprintln(stderr, "unhealthy: status", resp.StatusCode)
		return exitFailure
	}
	return 0
}

// worker runs the background jobs until ctx ends, then stops River within
// the grace period (running jobs are cancelled after it).
func worker(ctx context.Context, getenv func(string) (string, bool), stdout, stderr io.Writer) int {
	cfg, log, pool, code := open(ctx, getenv, stdout, stderr)
	if pool == nil {
		return code
	}
	defer pool.Close()
	if !reachable(ctx, pool, stderr) {
		return exitFailure
	}
	if err := jobs.CheckMigrated(ctx, pool); err != nil {
		fmt.Fprintln(stderr, err)
		return exitFailure
	}
	client, err := jobs.NewClient(pool, log, maintenance.New(pool))
	if err != nil {
		log.Error("worker setup", "err", database.Describe(err))
		return exitFailure
	}
	log.Info("worker starting", "version", version, "config", cfg)
	if err := client.Start(context.WithoutCancel(ctx)); err != nil {
		log.Error("worker start", "err", database.Describe(err))
		return exitFailure
	}
	<-ctx.Done()
	log.Info("worker stopping", "grace", cfg.ShutdownGrace.String())
	stopCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), cfg.ShutdownGrace)
	defer cancel()
	if err := client.Stop(stopCtx); err != nil {
		log.Error("jobs still running when the grace period ended: cancelling them", "err", err.Error())
		cancelCtx, cancelStop := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancelStop()
		if err := client.StopAndCancel(cancelCtx); err != nil {
			log.Error("cancelling jobs", "err", err.Error())
		}
		return exitFailure
	}
	log.Info("worker stopped")
	return 0
}

// migrateRiver creates River's schema and tables (idempotent).
func migrateRiver(ctx context.Context, getenv func(string) (string, bool), stdout, stderr io.Writer) int {
	_, log, pool, code := open(ctx, getenv, stdout, stderr)
	if pool == nil {
		return code
	}
	defer pool.Close()
	if !reachable(ctx, pool, stderr) {
		return exitFailure
	}
	applied, err := jobs.Migrate(ctx, pool)
	if err != nil {
		log.Error("migrate river", "err", database.Describe(err))
		return exitFailure
	}
	if len(applied) == 0 {
		log.Info("river migrations already current", "schema", jobs.Schema)
	} else {
		log.Info("river migrations applied", "schema", jobs.Schema, "versions", applied)
	}
	return 0
}

// open loads the configuration and opens the pool. On failure it prints the
// reason and returns a nil pool with the exit code.
func open(ctx context.Context, getenv func(string) (string, bool), stdout, stderr io.Writer) (config.Config, *slog.Logger, *pgxpool.Pool, int) {
	cfg, err := config.Load(getenv)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return config.Config{}, nil, nil, exitUsage
	}
	log := slog.New(slog.NewJSONHandler(stdout, &slog.HandlerOptions{Level: cfg.LogLevel}))
	pool, err := database.Open(ctx, cfg)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return config.Config{}, nil, nil, exitUsage
	}
	return cfg, log, pool, 0
}

// reachable checks the database before a command that needs it from the
// start (serve does not: it starts while the database is down). The driver's
// error names the user, database and host: database.Describe gives the
// reason without them.
func reachable(ctx context.Context, pool *pgxpool.Pool, stderr io.Writer) bool {
	ctx, cancel := context.WithTimeout(ctx, database.ConnectTimeout)
	defer cancel()
	if err := pool.Ping(ctx); err != nil {
		fmt.Fprintf(stderr, "cannot reach the database: %s; check DATABASE_URL and that PostgreSQL is running\n", database.Describe(err))
		return false
	}
	return true
}
