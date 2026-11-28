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
	"lookly/internal/ai"
	"lookly/internal/auth"
	"lookly/internal/clienterrors"
	"lookly/internal/color"
	"lookly/internal/config"
	"lookly/internal/database"
	"lookly/internal/health"
	"lookly/internal/httpapi"
	"lookly/internal/idempotency"
	"lookly/internal/imaging"
	"lookly/internal/jobs"
	"lookly/internal/legal"
	"lookly/internal/mail"
	"lookly/internal/maintenance"
	"lookly/internal/media"
	"lookly/internal/outfits"
	"lookly/internal/profile"
	"lookly/internal/quota"
	"lookly/internal/ratelimit"
	"lookly/internal/session"
	"lookly/internal/storage"
	"lookly/internal/stylist"
	"lookly/internal/vision"
	"lookly/internal/wardrobe"
	"lookly/internal/weather"
)

// version is stamped at build time: -ldflags "-X lookly/internal/app.version=<v>".
var version = "dev"

const (
	usage = "usage: lookly serve | worker | health | migrate river | eval (see lookly eval --help)"

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
	// picturesAtOnce is how many uploaded pictures are processed at a time:
	// each can take hundreds of megabytes while decoded (ADR 0009).
	picturesAtOnce = 2
)

// Run executes one command and returns the process exit code. ctx ends the
// command (main cancels it on SIGINT/SIGTERM).
func Run(ctx context.Context, args []string, getenv func(string) (string, bool), stdout, stderr io.Writer) int {
	if len(args) > 0 && args[0] == "eval" {
		return RunEval(ctx, args[1:], getenv, osStdin, stdout, stderr)
	}
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
func api(cfg config.Config, pool *pgxpool.Pool, log *slog.Logger, images storage.Store) (http.Handler, error) {
	queue, err := jobs.NewQueue(pool, log)
	if err != nil {
		return nil, fmt.Errorf("job queue: %w", err)
	}
	tokens := auth.NewTokens(cfg.JWTSecret)
	sessions := session.New(pool, session.Config{
		Tokens:     tokens,
		Keys:       session.Keys{Active: cfg.SessionEncKey, DecryptOnly: cfg.SessionDecryptKeys},
		AccessTTL:  cfg.AccessTokenTTL,
		RefreshTTL: cfg.RefreshTokenTTL,
		Log:        log,
	})
	consent := legal.NewService(pool)
	limiter := ratelimit.New(pool, cfg.JWTSecret)
	users := accounts.New(accounts.Config{
		Pool: pool, Sessions: sessions, Limiter: limiter, Consent: consent, Hasher: auth.Bcrypt{}, Log: log,
		Queue: queue, MailEnabled: cfg.Mail.Enabled(),
	})
	forecasts := weather.New(pool, weatherProvider(cfg), limiter, log)
	// The AI: every call and request told to the monitoring, the day's
	// quotas, the providers the configuration names.
	monitor := ai.NewMonitor(log, string(cfg.Env))
	quotas := quota.New(pool, monitor, log)
	models, err := ai.NewClient(cfg.AI, ai.DefaultAddresses, monitor)
	if err != nil {
		return nil, fmt.Errorf("AI providers: %w", err)
	}
	pictures := imaging.NewProcessor(picturesAtOnce)
	keys := idempotency.New(pool)
	server := httpapi.NewServer(httpapi.Services{
		Health:   health.New(pool, version, healthPingTimeout),
		Accounts: users,
		Sessions: sessions,
		Legal:    consent,
		Profile:  profile.New(pool),
		Wardrobe: wardrobe.New(pool, images, log),
		Weather:  forecasts,
		Outfits: outfits.New(pool, forecasts, limiter, outfits.NewRanker(outfits.RankerConfig{
			Client: models, Quotas: quotas, Monitor: monitor, Route: cfg.AI.Outfit, Rollout: cfg.AI.Rollout, Log: log,
		}), log),
		Uploads: wardrobe.NewUploads(wardrobe.UploadsConfig{
			Pool: pool, Images: images, Processor: pictures, Limiter: limiter, Keys: keys, Log: log,
			Analyzer: vision.NewAnalyzer(vision.AnalyzerConfig{
				Client: models, Quotas: quotas, Pictures: pictures, Monitor: monitor, Settings: cfg.AI.Vision, Rollout: cfg.AI.Rollout, Log: log,
			}),
		}),
		Stylist: stylist.New(stylist.Config{
			Pool: pool, Keys: keys, Client: models, Quotas: quotas, Monitor: monitor, Route: cfg.AI.Stylist, Rollout: cfg.AI.Rollout, Log: log,
		}),
		Colors:       color.NewService(pool, pictures, monitor, log),
		Reports:      clienterrors.NewService(limiter, log),
		Media:        media.NewSigner(cfg.MediaSigningSecret, cfg.MediaURLTTL, cfg.PublicBaseURL),
		Images:       images,
		CookieSecure: cfg.CookieSecure,
		TrustProxy:   cfg.TrustProxy,
	})
	return httpapi.New(server, log, &httpapi.Gate{
		Tokens: tokens, Sessions: sessions, Consent: consent, Users: users, TrustProxy: cfg.TrustProxy, HTTPSOnly: cfg.CookieSecure,
	}), nil
}

// weatherProvider is who the configuration says is asked for the weather.
func weatherProvider(cfg config.Config) weather.Provider {
	if cfg.WeatherProvider == config.WeatherMock {
		return weather.Mock{}
	}
	return weather.NewOpenMeteo(weather.OpenMeteoURL, nil, 0)
}

// storageCheckTimeout bounds the question to the bucket at start.
const storageCheckTimeout = 10 * time.Second

// openStorage opens the image storage; nil and the exit code when it
// cannot be used. A directory that is not there and a bucket that refuses
// the request (its name, the credentials) are settings to fix: the command
// does not start. A bucket that cannot be reached right now may come back:
// that is logged, and the command starts.
func openStorage(ctx context.Context, cfg config.Config, log *slog.Logger, stderr io.Writer) (storage.Store, int) {
	if cfg.StorageDriver != config.StorageR2 {
		images, err := storage.NewLocal(cfg.StorageLocalDir)
		if err != nil {
			fmt.Fprintf(stderr, "STORAGE_LOCAL_DIR: %v\n", err)
			return nil, exitUsage
		}
		return images, 0
	}
	bucket, err := storage.NewR2(storage.R2Config{
		Endpoint: cfg.R2.Endpoint, Bucket: cfg.R2.Bucket, Region: cfg.R2.Region,
		AccessKeyID: cfg.R2.AccessKeyID, SecretAccessKey: cfg.R2.SecretAccessKey,
	})
	if err != nil {
		fmt.Fprintf(stderr, "R2: %v\n", err)
		return nil, exitUsage
	}
	checkCtx, cancel := context.WithTimeout(ctx, storageCheckTimeout)
	defer cancel()
	switch permanent, err := bucket.Check(checkCtx); {
	case err != nil && permanent:
		fmt.Fprintf(stderr, "R2 (R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY): %v\n", err)
		return nil, exitUsage
	case err != nil:
		log.Error("the image bucket does not answer; starting all the same", "err", err.Error())
	}
	return bucket, 0
}

func serve(ctx context.Context, getenv func(string) (string, bool), stdout, stderr io.Writer) int {
	cfg, log, pool, code := open(ctx, getenv, stdout, stderr)
	if pool == nil {
		return code
	}
	defer pool.Close()

	if cfg.Env == config.Production && !cfg.TrustProxy {
		// Not refused: a server reached directly must not believe forwarding
		// headers. But behind the reverse proxy this setting is a mistake.
		log.Warn("TRUST_PROXY is not 1: client addresses are unknown, so sign-in is limited per account only and registration shares one limit")
	}
	// The images are served from here: a storage directory that is not
	// there would answer every image link with 404.
	images, code := openStorage(ctx, cfg, log, stderr)
	if images == nil {
		return code
	}
	handler, err := api(cfg, pool, log, images)
	if err != nil {
		log.Error("server setup", "err", err.Error())
		return exitFailure
	}

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
	// The images of deleted accounts are removed here: a storage directory
	// that is not there would make that a silent no-op.
	images, code := openStorage(ctx, cfg, log, stderr)
	if images == nil {
		return code
	}
	client, err := jobs.NewClient(pool, log, jobs.Workers{
		Cleanup:     maintenance.New(pool),
		ResetMailer: accounts.NewResetMailer(pool, mail.New(cfg.Mail), cfg.LinkOrigin(), log),
		Storage:     images,
		Sweeper:     wardrobe.NewSweeper(pool, images, log, nil, cfg.SweepMaxRemovals),
	})
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
	// The WebP encoder must be the one this project ships (ADR 0009).
	if err := imaging.CheckEncoder(); err != nil {
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
