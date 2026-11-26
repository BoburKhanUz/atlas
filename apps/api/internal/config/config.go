// Package config reads the server configuration from the environment into a
// typed struct and validates it at startup. It fails closed: a missing or
// invalid value stops the server with a message naming the variable. There
// are no default secrets and no development fallbacks.
//
// Variables shared with the Next.js server keep their names (DATABASE_URL,
// JWT_SECRET, SESSION_ENC_KEY, ...) and its rules, so one environment file
// serves both until the cutover; Go-only variables use the LOOKLY_ prefix.
// Later stages add their settings (AI, storage drivers) here with the same
// checks.
package config

import (
	"bytes"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
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

	JWTSecret          []byte   // secret: signs access tokens
	SessionEncKey      []byte   // secret: 32 bytes, encrypts successor refresh tokens
	SessionDecryptKeys [][]byte // secret: older keys during a staged rotation, decrypt only
	AccessTokenTTL     time.Duration
	RefreshTokenTTL    time.Duration
	CookieSecure       bool // auth cookies carry the Secure attribute
	TrustProxy         bool // the client address comes from the reverse proxy's headers

	// MediaSigningSecret signs the image links (as the Next.js server does,
	// so a link one server signed works on the other); MediaURLTTL is their
	// lifetime.
	MediaSigningSecret []byte // secret
	MediaURLTTL        time.Duration

	// VisionProvider is who analyses the garment photos. Until the real
	// providers (stage B6) it is the development mock or nothing starts.
	VisionProvider string

	// PublicBaseURL is the site's public origin (links in e-mails, absolute
	// image links); "" when not configured.
	PublicBaseURL string
	Mail          Mail
	// StorageDriver is where the images are kept: StorageLocal or StorageR2.
	StorageDriver string
	// StorageLocalDir is where the local storage driver keeps images: the
	// directory the Next.js server writes to until the cutover. It has no
	// default here: a wrong guess would purge nothing without anyone noticing.
	StorageLocalDir string
	// R2 is the bucket of the R2 driver.
	R2 R2
}

// VisionMock is the development mock of garment analysis.
const VisionMock = "mock"

const (
	defaultHTTPAddr      = ":8080"
	defaultDBMaxConns    = 10
	maxDBMaxConns        = 100
	defaultShutdownGrace = 20 * time.Second
	minShutdownGrace     = time.Second
	maxShutdownGrace     = 2 * time.Minute

	minSecretChars       = 32
	sessionKeyBytes      = 32
	maxDecryptOnlyKeys   = 2
	defaultAccessTTL     = 15 * time.Minute
	minAccessTTLSeconds  = 10
	maxAccessTTLSeconds  = 24 * 60 * 60
	defaultRefreshDays   = 30
	defaultMediaTTL      = time.Hour
	minMediaTTLSeconds   = 60
	maxMediaTTLSeconds   = 24 * 60 * 60
	maxRefreshDays       = 365
	generateSecretHint   = "generate one with: openssl rand -base64 48"
	generateSessionKHint = "generate one with: openssl rand -base64 32"
)

// Values that shipped as defaults in the project's first export. Never
// accepted (the Next.js server refuses the same two).
var knownInsecureSecrets = map[string]bool{
	"dev-secret-change-in-production-please-use-env":         true,
	"dev-refresh-secret-change-in-production-please-use-env": true,
}

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

	// Secrets: only the reason is ever reported, never the value.
	//
	// JWT_SECRET is used exactly as given, as the Next.js server uses it:
	// both sign with the same bytes. A value with white space at its ends
	// is refused, so nothing depends on who trims what.
	c.JWTSecret = signingSecret("JWT_SECRET", getenv, fail)
	c.MediaSigningSecret = signingSecret("MEDIA_SIGNING_SECRET", getenv, fail)
	// One secret for both would let anyone holding an image link's key
	// material forge access tokens, and the other way round.
	if c.JWTSecret != nil && bytes.Equal(c.JWTSecret, c.MediaSigningSecret) {
		fail("MEDIA_SIGNING_SECRET", "must be different from JWT_SECRET")
		c.MediaSigningSecret = nil
	}
	c.MediaURLTTL = defaultMediaTTL
	if v, ok := value("MEDIA_URL_TTL_SECONDS"); ok {
		n, err := strconv.Atoi(v)
		if err != nil || n < minMediaTTLSeconds || n > maxMediaTTLSeconds {
			fail("MEDIA_URL_TTL_SECONDS", "must be a whole number of seconds from %d to %d", minMediaTTLSeconds, maxMediaTTLSeconds)
		} else {
			c.MediaURLTTL = time.Duration(n) * time.Second
		}
	}

	// The session key must not be derived from, or equal to, another secret.
	otherSecrets := map[string]string{}
	for _, name := range []string{"JWT_SECRET", "MEDIA_SIGNING_SECRET"} {
		if v, _ := getenv(name); v != "" {
			otherSecrets[name] = v
		}
	}
	sessionKey := func(name, raw string) []byte {
		key, err := decodeSessionKey(raw, otherSecrets)
		if err != nil {
			fail(name, "%v", err)
		}
		return key
	}
	if v, ok := value("SESSION_ENC_KEY"); !ok {
		fail("SESSION_ENC_KEY", "is not set (%s)", generateSessionKHint)
	} else {
		c.SessionEncKey = sessionKey("SESSION_ENC_KEY", v)
	}
	if v, ok := value("SESSION_ENC_DECRYPT_KEYS"); ok {
		var list []string
		for _, item := range strings.Split(v, ",") {
			if item = strings.TrimSpace(item); item != "" {
				list = append(list, item)
			}
		}
		if len(list) > maxDecryptOnlyKeys {
			fail("SESSION_ENC_DECRYPT_KEYS", "accepts at most %d keys", maxDecryptOnlyKeys)
		} else {
			for _, item := range list {
				// The active key listed again adds nothing.
				if key := sessionKey("SESSION_ENC_DECRYPT_KEYS", item); key != nil && !bytes.Equal(key, c.SessionEncKey) {
					c.SessionDecryptKeys = append(c.SessionDecryptKeys, key)
				}
			}
		}
	}

	c.AccessTokenTTL = defaultAccessTTL
	if v, ok := value("ACCESS_TOKEN_TTL_SECONDS"); ok {
		n, err := strconv.Atoi(v)
		if err != nil || n < minAccessTTLSeconds || n > maxAccessTTLSeconds {
			fail("ACCESS_TOKEN_TTL_SECONDS", "must be a whole number of seconds from %d to %d", minAccessTTLSeconds, maxAccessTTLSeconds)
		} else {
			c.AccessTokenTTL = time.Duration(n) * time.Second
		}
	}

	c.RefreshTokenTTL = defaultRefreshDays * 24 * time.Hour
	if v, ok := value("REFRESH_TOKEN_TTL_DAYS"); ok {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > maxRefreshDays {
			fail("REFRESH_TOKEN_TTL_DAYS", "must be a whole number of days from 1 to %d", maxRefreshDays)
		} else {
			c.RefreshTokenTTL = time.Duration(n) * 24 * time.Hour
		}
	}

	// Cookies are Secure wherever the server is deployed. Plain http is for
	// local and test runs; production never allows it.
	c.CookieSecure = c.Env == Production || c.Env == Staging
	if v, ok := value("COOKIE_SECURE"); ok {
		switch {
		case v != "0" && v != "1":
			fail("COOKIE_SECURE", "must be 0 or 1")
		case v == "0" && c.Env == Production:
			fail("COOKIE_SECURE", "0 (cookies over plain http) is not allowed in production")
		default:
			c.CookieSecure = v == "1"
		}
	}

	if v, ok := value("TRUST_PROXY"); ok {
		if v != "0" && v != "1" {
			fail("TRUST_PROXY", "must be 0 or 1")
		} else {
			c.TrustProxy = v == "1"
		}
	}

	if v, ok := value("PUBLIC_BASE_URL"); ok {
		origin, err := parsePublicBaseURL(v, c.Env)
		if err != nil {
			fail("PUBLIC_BASE_URL", "%v", err)
		}
		c.PublicBaseURL = origin
	}
	c.Mail = loadMail(c.Env, c.PublicBaseURL, value, getenv, fail)

	// Garment analysis. The variables are the Next.js server's; until the
	// real providers are ported (stage B6) only the mock is accepted, and
	// where the server is deployed only when it is acknowledged, as there.
	deployed := c.Env == Production || c.Env == Staging
	provider, set := value("AI_VISION_PROVIDER")
	provider = strings.ToLower(provider)
	switch {
	case !set && deployed:
		fail("AI_VISION_PROVIDER", "must be set in %s", c.Env)
	case set && provider != VisionMock:
		fail("AI_VISION_PROVIDER", "must be mock: the Go server has no other garment analysis before stage B6")
	default:
		c.VisionProvider = VisionMock
		if allow, _ := value("AI_ALLOW_MOCK_IN_PRODUCTION"); deployed && allow != "1" {
			fail("AI_VISION_PROVIDER", "mock is refused in %s unless AI_ALLOW_MOCK_IN_PRODUCTION=1", c.Env)
		}
	}

	c.StorageDriver, c.StorageLocalDir, c.R2 = loadStorage(c.Env, value, getenv, fail)

	if len(errs) > 0 {
		return Config{}, fmt.Errorf("invalid configuration:\n%w", errors.Join(errs...))
	}
	return c, nil
}

// signingSecret reads an HMAC secret by the Next.js server's rules (at least
// 32 characters, not a shipped default) and one of its own: no white space
// around it, which an editor or a copied line adds without anyone seeing.
func signingSecret(name string, getenv func(string) (string, bool), fail func(string, string, ...any)) []byte {
	v, _ := getenv(name)
	switch {
	case v == "":
		fail(name, "is not set (%s)", generateSecretHint)
	case strings.TrimSpace(v) != v:
		fail(name, "must not start or end with white space")
	case utf8.RuneCountInString(v) < minSecretChars:
		fail(name, "must be at least %d characters long", minSecretChars)
	case knownInsecureSecrets[v]:
		fail(name, "uses a known insecure default value")
	default:
		return []byte(v)
	}
	return nil
}

// decodeSessionKey reads a session key as the Next.js server does: standard
// base64, padded or not, of exactly 32 bytes, and independent of the other
// secrets (neither the same text nor the same bytes).
func decodeSessionKey(value string, otherSecrets map[string]string) ([]byte, error) {
	body := strings.TrimRight(value, "=")
	if body == "" || len(value)-len(body) > 2 || strings.ContainsFunc(body, notBase64) {
		return nil, fmt.Errorf("must be base64 (%s)", generateSessionKHint)
	}
	key, err := base64.RawStdEncoding.DecodeString(body)
	if err != nil || len(key) != sessionKeyBytes {
		return nil, fmt.Errorf("must decode to exactly %d bytes (%s)", sessionKeyBytes, generateSessionKHint)
	}
	for _, name := range []string{"JWT_SECRET", "MEDIA_SIGNING_SECRET"} {
		if other, set := otherSecrets[name]; set && (strings.TrimSpace(other) == value || bytes.Equal([]byte(other), key)) {
			return nil, fmt.Errorf("must be independent of %s", name)
		}
	}
	return key, nil
}

func notBase64(r rune) bool {
	return r > unicode.MaxASCII || !(unicode.IsLetter(r) || unicode.IsDigit(r) || r == '+' || r == '/')
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

// LogValue keeps the secrets out of logs: the database URL, the signing
// secret and the session keys are shown as set, never as values.
func (c Config) LogValue() slog.Value {
	return slog.GroupValue(
		slog.String("env", string(c.Env)),
		slog.String("httpAddr", c.HTTPAddr),
		slog.String("databaseURL", "[set]"),
		slog.Int("dbMaxConns", int(c.DBMaxConns)),
		slog.String("logLevel", c.LogLevel.String()),
		slog.Duration("shutdownGrace", c.ShutdownGrace),
		slog.String("jwtSecret", "[set]"),
		slog.String("mediaSigningSecret", "[set]"),
		slog.Duration("mediaURLTTL", c.MediaURLTTL),
		slog.String("sessionEncKey", "[set]"),
		slog.Int("decryptOnlyKeys", len(c.SessionDecryptKeys)),
		slog.Duration("accessTokenTTL", c.AccessTokenTTL),
		slog.Duration("refreshTokenTTL", c.RefreshTokenTTL),
		slog.Bool("cookieSecure", c.CookieSecure),
		slog.Bool("trustProxy", c.TrustProxy),
		slog.String("publicBaseURL", c.PublicBaseURL),
		slog.String("mailTransport", string(c.Mail.Transport)),
		slog.String("mailFrom", c.Mail.From.Address),
		slog.String("smtpHost", c.Mail.Host),
		slog.Int("smtpPort", c.Mail.Port),
		slog.Bool("smtpSecure", c.Mail.Secure),
		slog.String("smtpCredentials", setOrNot(c.Mail.Password)),
		slog.String("mailOutboxDir", c.Mail.OutboxDir),
		slog.String("storageDriver", c.StorageDriver),
		slog.String("storageLocalDir", c.StorageLocalDir),
		slog.String("r2Endpoint", c.R2.Endpoint),
		slog.String("r2Bucket", c.R2.Bucket),
		slog.String("r2Credentials", setOrNot(c.R2.SecretAccessKey)),
		slog.String("visionProvider", c.VisionProvider),
	)
}

// String keeps the secrets out of fmt output.
func (c Config) String() string {
	return fmt.Sprintf("Config{Env:%s HTTPAddr:%s DatabaseURL:[set] DBMaxConns:%d LogLevel:%s ShutdownGrace:%s "+
		"JWTSecret:[set] SessionEncKey:[set] DecryptOnlyKeys:%d AccessTokenTTL:%s RefreshTokenTTL:%s CookieSecure:%t TrustProxy:%t "+
		"MediaSigningSecret:[set] MediaURLTTL:%s "+
		"PublicBaseURL:%s %s StorageDriver:%s StorageLocalDir:%s %s VisionProvider:%s}",
		c.Env, c.HTTPAddr, c.DBMaxConns, c.LogLevel, c.ShutdownGrace,
		len(c.SessionDecryptKeys), c.AccessTokenTTL, c.RefreshTokenTTL, c.CookieSecure, c.TrustProxy, c.MediaURLTTL,
		c.PublicBaseURL, c.Mail, c.StorageDriver, c.StorageLocalDir, c.R2, c.VisionProvider)
}

// GoString keeps the secrets out of %#v.
func (c Config) GoString() string { return c.String() }
