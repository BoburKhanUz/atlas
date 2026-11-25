// Package app is the lookly command: `serve` runs the HTTP API, `health`
// probes a running server (the container's health check: the image has no
// shell or curl). Later stages add `worker`, `migrate` and `eval`.
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

	"lookly/internal/config"
	"lookly/internal/database"
	"lookly/internal/health"
	"lookly/internal/httpapi"
)

// version is stamped at build time: -ldflags "-X lookly/internal/app.version=<v>".
var version = "dev"

const (
	usage = "usage: lookly serve | health"

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
	if len(args) != 1 {
		fmt.Fprintln(stderr, usage)
		return exitUsage
	}
	switch args[0] {
	case "serve":
		return serve(ctx, getenv, stdout, stderr)
	case "health":
		return probe(ctx, getenv, stderr)
	default:
		fmt.Fprintln(stderr, usage)
		return exitUsage
	}
}

func serve(ctx context.Context, getenv func(string) (string, bool), stdout, stderr io.Writer) int {
	cfg, err := config.Load(getenv)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return exitUsage
	}
	log := slog.New(slog.NewJSONHandler(stdout, &slog.HandlerOptions{Level: cfg.LogLevel}))

	pool, err := database.Open(ctx, cfg)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return exitUsage
	}
	defer pool.Close()

	handler := httpapi.New(httpapi.NewServer(httpapi.Services{
		Health: health.New(pool, version, healthPingTimeout),
	}), log)

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
