// Package config reads the server configuration from the environment into a
// typed struct and validates it at startup. It fails closed: a missing or
// invalid value stops the server with a message naming the variable. There
// are no default secrets and no development fallbacks.
//
// Variables shared with the Next.js server keep their names (DATABASE_URL);
// Go-only variables use the LOOKLY_ prefix. Later stages add their settings
// (JWT and session keys, media secret, AI, mail) here with the same checks.
package config

import (
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Env is the deployment environment. It has no default: a server never runs
// in development mode by accident.
type Env string

const (
	Production  Env = "production"
	Staging     Env = "staging"
	Development Env = "development"
	Test        Env = "test"
)

// Config is the validated server configuration.
type Config struct {
	Env           Env
	HTTPAddr      string
	DatabaseURL   string // secret (credentials): never printed, see LogValue and String
	DBMaxConns    int32
	LogLevel      slog.Level
	ShutdownGrace time.Duration
}

const (
	defaultHTTPAddr      = ":8080"
	defaultDBMaxConns    = 10
	maxDBMaxConns        = 100
	defaultShutdownGrace = 20 * time.Second
	minShutdownGrace     = time.Second
	maxShutdownGrace     = 2 * time.Minute
)

// Load reads and validates the configuration. getenv is os.LookupEnv in
// production; every problem is reported, joined, in one error.
func Load(getenv func(string) (string, bool)) (Config, error) {
	var errs []error
	fail := func(variable, format string, args ...any) {
		errs = append(errs, fmt.Errorf("%s: %s", variable, fmt.Sprintf(format, args...)))
	}
	value := func(name string) (string, bool) {
		v, ok := getenv(name)
		v = strings.TrimSpace(v)
		return v, ok && v != ""
	}

	var c Config

	switch v, _ := value("LOOKLY_ENV"); Env(v) {
	case Production, Staging, Development, Test:
		c.Env = Env(v)
	case "":
		fail("LOOKLY_ENV", "is not set (production, staging, development or test)")
	default:
		fail("LOOKLY_ENV", "must be production, staging, development or test")
	}

	c.HTTPAddr = defaultHTTPAddr
	if v, ok := value("LOOKLY_HTTP_ADDR"); ok {
		if err := checkListenAddr(v); err != nil {
			fail("LOOKLY_HTTP_ADDR", "%v", err)
		} else {
			c.HTTPAddr = v
		}
	}

	if v, ok := value("DATABASE_URL"); !ok {
		fail("DATABASE_URL", "is not set")
	} else if err := checkDatabaseURL(v, c.Env); err != nil {
		// The value holds credentials: only the reason is reported.
		fail("DATABASE_URL", "%v", err)
	} else {
		c.DatabaseURL = v
	}

	c.DBMaxConns = defaultDBMaxConns
	if v, ok := value("LOOKLY_DB_MAX_CONNS"); ok {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > maxDBMaxConns {
			fail("LOOKLY_DB_MAX_CONNS", "must be a whole number from 1 to %d", maxDBMaxConns)
		} else {
			c.DBMaxConns = int32(n)
		}
	}

	c.LogLevel = slog.LevelInfo
	if v, ok := value("LOOKLY_LOG_LEVEL"); ok {
		switch v {
		case "debug":
			c.LogLevel = slog.LevelDebug
		case "info":
			c.LogLevel = slog.LevelInfo
		case "warn":
			c.LogLevel = slog.LevelWarn
		case "error":
			c.LogLevel = slog.LevelError
		default:
			fail("LOOKLY_LOG_LEVEL", "must be debug, info, warn or error")
		}
	}
	if c.Env == Production && c.LogLevel < slog.LevelInfo {
		fail("LOOKLY_LOG_LEVEL", "debug is not allowed in production")
	}

	c.ShutdownGrace = defaultShutdownGrace
	if v, ok := value("LOOKLY_SHUTDOWN_GRACE"); ok {
		d, err := time.ParseDuration(v)
		if err != nil || d < minShutdownGrace || d > maxShutdownGrace {
			fail("LOOKLY_SHUTDOWN_GRACE", "must be a duration from %s to %s, such as 20s", minShutdownGrace, maxShutdownGrace)
		} else {
			c.ShutdownGrace = d
		}
	}

	if len(errs) > 0 {
		return Config{}, fmt.Errorf("invalid configuration:\n%w", errors.Join(errs...))
	}
	return c, nil
}

func checkListenAddr(addr string) error {
	_, port, err := net.SplitHostPort(addr)
	if err != nil {
		return errors.New("must be host:port or :port, such as :8080")
	}
	n, err := strconv.Atoi(port)
	if err != nil || n < 1 || n > 65535 {
		return errors.New("port must be a number from 1 to 65535")
	}
	return nil
}

// sslModes are the driver's values. In production only an explicit choice
// that never falls back silently is accepted: "prefer" and "allow" (and the
// default, which is "prefer") switch to plain text when TLS fails.
var sslModes = map[string]bool{"disable": true, "allow": true, "prefer": true, "require": true, "verify-ca": true, "verify-full": true}
var productionSSLModes = map[string]bool{"disable": true, "require": true, "verify-ca": true, "verify-full": true}

// checkDatabaseURL accepts the URL form the deployment uses
// (postgresql://user:password@host:port/database?options). Errors never
// include the value.
func checkDatabaseURL(raw string, env Env) error {
	u, err := url.Parse(raw)
	if err != nil {
		return errors.New("is not a valid URL")
	}
	if u.Scheme != "postgres" && u.Scheme != "postgresql" {
		return errors.New("must be a postgres:// or postgresql:// URL")
	}
	if u.Hostname() == "" {
		return errors.New("has no host")
	}
	if p := u.Port(); p != "" {
		if n, err := strconv.Atoi(p); err != nil || n < 1 || n > 65535 {
			return errors.New("has an invalid port")
		}
	}
	if strings.Trim(u.Path, "/") == "" {
		return errors.New("has no database name")
	}
	mode, set := u.Query()["sslmode"]
	switch {
	case set && (len(mode) != 1 || !sslModes[mode[0]]):
		return errors.New("sslmode must be disable, allow, prefer, require, verify-ca or verify-full")
	case env == Production && (!set || !productionSSLModes[mode[0]]):
		return errors.New("must set sslmode in production: disable (private network), require, verify-ca or verify-full")
	}
	return nil
}

// LogValue keeps the database URL out of logs.
func (c Config) LogValue() slog.Value {
	return slog.GroupValue(
		slog.String("env", string(c.Env)),
		slog.String("httpAddr", c.HTTPAddr),
		slog.String("databaseURL", "[set]"),
		slog.Int("dbMaxConns", int(c.DBMaxConns)),
		slog.String("logLevel", c.LogLevel.String()),
		slog.Duration("shutdownGrace", c.ShutdownGrace),
	)
}

// String keeps the database URL out of fmt output.
func (c Config) String() string {
	return fmt.Sprintf("Config{Env:%s HTTPAddr:%s DatabaseURL:[set] DBMaxConns:%d LogLevel:%s ShutdownGrace:%s}",
		c.Env, c.HTTPAddr, c.DBMaxConns, c.LogLevel, c.ShutdownGrace)
}

// GoString keeps the database URL out of %#v.
func (c Config) GoString() string { return c.String() }
