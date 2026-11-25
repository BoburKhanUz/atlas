package config_test

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"log/slog"
	"strings"
	"testing"
	"time"

	"lookly/internal/config"
	"lookly/internal/config/configtest"
)

const dbURL = "postgresql://atlas:s3cret-pass@db.internal:5432/atlas?sslmode=disable"

func env(vars map[string]string) func(string) (string, bool) {
	return func(k string) (string, bool) {
		v, ok := vars[k]
		return v, ok
	}
}

// valid is a production configuration with only the required variables.
func valid() map[string]string {
	return configtest.Env(map[string]string{"LOOKLY_ENV": "production", "DATABASE_URL": dbURL})
}

func with(changes map[string]string) map[string]string {
	vars := valid()
	for k, v := range changes {
		if v == "<unset>" {
			delete(vars, k)
		} else {
			vars[k] = v
		}
	}
	return vars
}

// key is a session key: 32 bytes of b, in base64 as "openssl rand -base64 32" prints it.
func key(b byte) string { return base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{b}, 32)) }

func TestDefaults(t *testing.T) {
	t.Parallel()
	c, err := config.Load(env(valid()))
	if err != nil {
		t.Fatal(err)
	}
	if c.Env != config.Production || c.HTTPAddr != ":8080" || c.DatabaseURL != dbURL ||
		c.DBMaxConns != 10 || c.LogLevel != slog.LevelInfo || c.ShutdownGrace != 20*time.Second {
		t.Fatalf("defaults: %+v", c)
	}
	if string(c.JWTSecret) != configtest.JWTSecret || !bytes.Equal(c.SessionEncKey, bytes.Repeat([]byte{0x5a}, 32)) || len(c.SessionDecryptKeys) != 0 {
		t.Error("session secrets are not the configured ones")
	}
	if c.AccessTokenTTL != 15*time.Minute || c.RefreshTokenTTL != 30*24*time.Hour || !c.CookieSecure || c.TrustProxy {
		t.Errorf("session defaults: access %s, refresh %s, secure cookies %v, trust proxy %v",
			c.AccessTokenTTL, c.RefreshTokenTTL, c.CookieSecure, c.TrustProxy)
	}
}

func TestSessionSettings(t *testing.T) {
	t.Parallel()
	c, err := config.Load(env(with(map[string]string{
		"LOOKLY_ENV":               "test",
		"SESSION_ENC_KEY":          "  " + key(1) + "\n",
		"SESSION_ENC_DECRYPT_KEYS": " " + key(2) + " ,, " + key(1) + ",",
		"ACCESS_TOKEN_TTL_SECONDS": "10",
		"REFRESH_TOKEN_TTL_DAYS":   "365",
		"COOKIE_SECURE":            "0",
		"TRUST_PROXY":              "1",
	})))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(c.SessionEncKey, bytes.Repeat([]byte{1}, 32)) {
		t.Error("the active key is not the configured one")
	}
	// The active key repeated in the decrypt-only list is dropped; empty items are ignored.
	if len(c.SessionDecryptKeys) != 1 || !bytes.Equal(c.SessionDecryptKeys[0], bytes.Repeat([]byte{2}, 32)) {
		t.Errorf("%d decrypt-only keys, want the one that is not the active key", len(c.SessionDecryptKeys))
	}
	if c.AccessTokenTTL != 10*time.Second || c.RefreshTokenTTL != 365*24*time.Hour || c.CookieSecure || !c.TrustProxy {
		t.Errorf("access %s, refresh %s, secure cookies %v, trust proxy %v", c.AccessTokenTTL, c.RefreshTokenTTL, c.CookieSecure, c.TrustProxy)
	}

	// The key as the Next.js server also accepts it: without padding.
	unpadded := strings.TrimRight(key(3), "=")
	if c, err := config.Load(env(with(map[string]string{"SESSION_ENC_KEY": unpadded}))); err != nil || !bytes.Equal(c.SessionEncKey, bytes.Repeat([]byte{3}, 32)) {
		t.Errorf("unpadded key: %v", err)
	}
	if c, err := config.Load(env(with(map[string]string{"ACCESS_TOKEN_TTL_SECONDS": "86400", "REFRESH_TOKEN_TTL_DAYS": "1", "TRUST_PROXY": "0"}))); err != nil ||
		c.AccessTokenTTL != 24*time.Hour || c.RefreshTokenTTL != 24*time.Hour || c.TrustProxy {
		t.Errorf("limits: %v", err)
	}

	// Cookies are Secure wherever the server is deployed; plain http is for
	// local and test runs, and never for production.
	for environment, secure := range map[string]bool{"production": true, "staging": true, "development": false, "test": false} {
		c, err := config.Load(env(with(map[string]string{"LOOKLY_ENV": environment})))
		if err != nil || c.CookieSecure != secure {
			t.Errorf("%s: secure cookies %v (%v), want %v", environment, c.CookieSecure, err, secure)
		}
	}
	if c, err := config.Load(env(with(map[string]string{"LOOKLY_ENV": "test", "COOKIE_SECURE": "1"}))); err != nil || !c.CookieSecure {
		t.Errorf("COOKIE_SECURE=1 in test: %v", err)
	}
	if c, err := config.Load(env(with(map[string]string{"LOOKLY_ENV": "staging", "COOKIE_SECURE": "0"}))); err != nil || c.CookieSecure {
		t.Errorf("COOKIE_SECURE=0 in staging: %v", err)
	}
	// A secret of exactly 32 characters, counted as characters.
	if _, err := config.Load(env(with(map[string]string{"JWT_SECRET": strings.Repeat("ў", 32)}))); err != nil {
		t.Errorf("32 characters: %v", err)
	}
}

func TestExplicitValues(t *testing.T) {
	t.Parallel()
	c, err := config.Load(env(with(map[string]string{
		"LOOKLY_ENV":            "staging",
		"LOOKLY_HTTP_ADDR":      "127.0.0.1:9090",
		"LOOKLY_DB_MAX_CONNS":   "25",
		"LOOKLY_LOG_LEVEL":      "debug",
		"LOOKLY_SHUTDOWN_GRACE": "45s",
		"DATABASE_URL":          "postgres://u@localhost/lookly",
	})))
	if err != nil {
		t.Fatal(err)
	}
	if c.Env != config.Staging || c.HTTPAddr != "127.0.0.1:9090" || c.DBMaxConns != 25 ||
		c.LogLevel != slog.LevelDebug || c.ShutdownGrace != 45*time.Second {
		t.Fatalf("explicit: %+v", c)
	}
	for _, e := range []string{"development", "test"} {
		if _, err := config.Load(env(with(map[string]string{"LOOKLY_ENV": e}))); err != nil {
			t.Errorf("%s: %v", e, err)
		}
		// Outside production the driver's default is acceptable.
		if _, err := config.Load(env(with(map[string]string{"LOOKLY_ENV": e, "DATABASE_URL": "postgresql://u@localhost/db"}))); err != nil {
			t.Errorf("%s without sslmode: %v", e, err)
		}
	}
	for _, mode := range []string{"disable", "require", "verify-ca", "verify-full"} {
		if _, err := config.Load(env(with(map[string]string{"DATABASE_URL": "postgresql://u:p@db/x?sslmode=" + mode}))); err != nil {
			t.Errorf("production with sslmode=%s: %v", mode, err)
		}
	}
}

func TestRefusals(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name     string
		changes  map[string]string
		variable string
	}{
		{"environment missing", map[string]string{"LOOKLY_ENV": "<unset>"}, "LOOKLY_ENV"},
		{"environment empty", map[string]string{"LOOKLY_ENV": ""}, "LOOKLY_ENV"},
		{"environment unknown", map[string]string{"LOOKLY_ENV": "prod"}, "LOOKLY_ENV"},
		{"environment wrong case", map[string]string{"LOOKLY_ENV": "Production"}, "LOOKLY_ENV"},
		{"database missing", map[string]string{"DATABASE_URL": "<unset>"}, "DATABASE_URL"},
		{"database empty", map[string]string{"DATABASE_URL": "  "}, "DATABASE_URL"},
		{"database not a URL", map[string]string{"DATABASE_URL": "host=db user=atlas password=s3cret-pass"}, "DATABASE_URL"},
		{"database other scheme", map[string]string{"DATABASE_URL": "mysql://atlas:s3cret-pass@db/atlas"}, "DATABASE_URL"},
		{"database without host", map[string]string{"DATABASE_URL": "postgresql:///atlas"}, "DATABASE_URL"},
		{"database without name", map[string]string{"DATABASE_URL": "postgresql://atlas:s3cret-pass@db:5432/"}, "DATABASE_URL"},
		{"database bad port", map[string]string{"DATABASE_URL": "postgresql://atlas:s3cret-pass@db:99999/atlas"}, "DATABASE_URL"},
		// Without sslmode the driver uses "prefer", which falls back to plain
		// text silently: production states its choice.
		{"database without sslmode in production", map[string]string{"DATABASE_URL": "postgresql://atlas:s3cret-pass@db.internal:5432/atlas"}, "DATABASE_URL"},
		{"database with an unknown sslmode", map[string]string{"DATABASE_URL": "postgresql://atlas:s3cret-pass@db.internal:5432/atlas?sslmode=sometimes"}, "DATABASE_URL"},
		{"address without port", map[string]string{"LOOKLY_HTTP_ADDR": "localhost"}, "LOOKLY_HTTP_ADDR"},
		{"address port zero", map[string]string{"LOOKLY_HTTP_ADDR": ":0"}, "LOOKLY_HTTP_ADDR"},
		{"address port too big", map[string]string{"LOOKLY_HTTP_ADDR": ":70000"}, "LOOKLY_HTTP_ADDR"},
		{"address port not a number", map[string]string{"LOOKLY_HTTP_ADDR": ":http"}, "LOOKLY_HTTP_ADDR"},
		{"pool not a number", map[string]string{"LOOKLY_DB_MAX_CONNS": "ten"}, "LOOKLY_DB_MAX_CONNS"},
		{"pool zero", map[string]string{"LOOKLY_DB_MAX_CONNS": "0"}, "LOOKLY_DB_MAX_CONNS"},
		{"pool too big", map[string]string{"LOOKLY_DB_MAX_CONNS": "101"}, "LOOKLY_DB_MAX_CONNS"},
		{"log level unknown", map[string]string{"LOOKLY_LOG_LEVEL": "verbose"}, "LOOKLY_LOG_LEVEL"},
		{"debug logs in production", map[string]string{"LOOKLY_LOG_LEVEL": "debug"}, "LOOKLY_LOG_LEVEL"},
		{"grace not a duration", map[string]string{"LOOKLY_SHUTDOWN_GRACE": "20"}, "LOOKLY_SHUTDOWN_GRACE"},
		{"grace too short", map[string]string{"LOOKLY_SHUTDOWN_GRACE": "500ms"}, "LOOKLY_SHUTDOWN_GRACE"},
		{"grace too long", map[string]string{"LOOKLY_SHUTDOWN_GRACE": "121s"}, "LOOKLY_SHUTDOWN_GRACE"},
		{"signing secret missing", map[string]string{"JWT_SECRET": "<unset>"}, "JWT_SECRET"},
		{"signing secret empty", map[string]string{"JWT_SECRET": ""}, "JWT_SECRET"},
		{"signing secret short", map[string]string{"JWT_SECRET": strings.Repeat("x", 31)}, "JWT_SECRET"},
		{"signing secret short in characters", map[string]string{"JWT_SECRET": strings.Repeat("ў", 31)}, "JWT_SECRET"},
		{"signing secret is a shipped default", map[string]string{"JWT_SECRET": "dev-secret-change-in-production-please-use-env"}, "JWT_SECRET"},
		{"signing secret is the other shipped default", map[string]string{"JWT_SECRET": "dev-refresh-secret-change-in-production-please-use-env"}, "JWT_SECRET"},
		// The Next.js server signs with the value as it is; a trimmed copy
		// would be another key, so the difference is refused, not guessed.
		{"signing secret with a trailing space", map[string]string{"JWT_SECRET": strings.Repeat("x", 40) + " "}, "JWT_SECRET"},
		{"signing secret with a leading newline", map[string]string{"JWT_SECRET": "\n" + strings.Repeat("x", 40)}, "JWT_SECRET"},
		{"session key missing", map[string]string{"SESSION_ENC_KEY": "<unset>"}, "SESSION_ENC_KEY"},
		{"session key empty", map[string]string{"SESSION_ENC_KEY": " "}, "SESSION_ENC_KEY"},
		{"session key not base64", map[string]string{"SESSION_ENC_KEY": strings.Repeat("!", 44)}, "SESSION_ENC_KEY"},
		{"session key base64url", map[string]string{"SESSION_ENC_KEY": base64.URLEncoding.EncodeToString(bytes.Repeat([]byte{0xfb}, 32))}, "SESSION_ENC_KEY"},
		{"session key of 31 bytes", map[string]string{"SESSION_ENC_KEY": base64.StdEncoding.EncodeToString(make([]byte, 31))}, "SESSION_ENC_KEY"},
		{"session key of 33 bytes", map[string]string{"SESSION_ENC_KEY": base64.StdEncoding.EncodeToString(make([]byte, 33))}, "SESSION_ENC_KEY"},
		{"session key with too much padding", map[string]string{"SESSION_ENC_KEY": key(1) + "=="}, "SESSION_ENC_KEY"},
		{"session key equal to the signing secret", map[string]string{"JWT_SECRET": key(4), "SESSION_ENC_KEY": key(4)}, "SESSION_ENC_KEY"},
		{"session key that is the signing secret's bytes", map[string]string{
			"JWT_SECRET": strings.Repeat("k", 32), "SESSION_ENC_KEY": base64.StdEncoding.EncodeToString([]byte(strings.Repeat("k", 32))),
		}, "SESSION_ENC_KEY"},
		{"session key equal to the media secret", map[string]string{"MEDIA_SIGNING_SECRET": key(5), "SESSION_ENC_KEY": key(5)}, "SESSION_ENC_KEY"},
		{"three decrypt-only keys", map[string]string{"SESSION_ENC_DECRYPT_KEYS": key(1) + "," + key(2) + "," + key(3)}, "SESSION_ENC_DECRYPT_KEYS"},
		{"decrypt-only key not base64", map[string]string{"SESSION_ENC_DECRYPT_KEYS": "not base64!"}, "SESSION_ENC_DECRYPT_KEYS"},
		{"decrypt-only key of 16 bytes", map[string]string{"SESSION_ENC_DECRYPT_KEYS": base64.StdEncoding.EncodeToString(make([]byte, 16))}, "SESSION_ENC_DECRYPT_KEYS"},
		{"decrypt-only key equal to the signing secret", map[string]string{"JWT_SECRET": key(6), "SESSION_ENC_DECRYPT_KEYS": key(6)}, "SESSION_ENC_DECRYPT_KEYS"},
		{"access lifetime not a number", map[string]string{"ACCESS_TOKEN_TTL_SECONDS": "15m"}, "ACCESS_TOKEN_TTL_SECONDS"},
		{"access lifetime too short", map[string]string{"ACCESS_TOKEN_TTL_SECONDS": "9"}, "ACCESS_TOKEN_TTL_SECONDS"},
		{"access lifetime too long", map[string]string{"ACCESS_TOKEN_TTL_SECONDS": "86401"}, "ACCESS_TOKEN_TTL_SECONDS"},
		{"access lifetime fractional", map[string]string{"ACCESS_TOKEN_TTL_SECONDS": "900.5"}, "ACCESS_TOKEN_TTL_SECONDS"},
		{"refresh lifetime zero", map[string]string{"REFRESH_TOKEN_TTL_DAYS": "0"}, "REFRESH_TOKEN_TTL_DAYS"},
		{"refresh lifetime too long", map[string]string{"REFRESH_TOKEN_TTL_DAYS": "366"}, "REFRESH_TOKEN_TTL_DAYS"},
		{"refresh lifetime not a number", map[string]string{"REFRESH_TOKEN_TTL_DAYS": "a month"}, "REFRESH_TOKEN_TTL_DAYS"},
		{"plain-http cookies in production", map[string]string{"COOKIE_SECURE": "0"}, "COOKIE_SECURE"},
		{"cookie flag not 0 or 1", map[string]string{"LOOKLY_ENV": "test", "COOKIE_SECURE": "false"}, "COOKIE_SECURE"},
		{"proxy flag not 0 or 1", map[string]string{"TRUST_PROXY": "true"}, "TRUST_PROXY"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			_, err := config.Load(env(with(tc.changes)))
			if err == nil {
				t.Fatal("accepted")
			}
			msg := err.Error()
			if !strings.Contains(msg, tc.variable) {
				t.Errorf("error does not name %s: %q", tc.variable, msg)
			}
			if strings.Contains(msg, "s3cret-pass") || strings.Contains(msg, "db.internal") {
				t.Errorf("error leaks the database URL: %q", msg)
			}
			for name, value := range with(tc.changes) {
				if (name == "JWT_SECRET" || name == "MEDIA_SIGNING_SECRET" || strings.HasPrefix(name, "SESSION_ENC_")) && len(strings.TrimSpace(value)) >= 8 && strings.Contains(msg, strings.TrimSpace(value)) {
					t.Errorf("error shows the value of %s: %q", name, msg)
				}
			}
		})
	}
}

func TestEveryProblemIsReportedAtOnce(t *testing.T) {
	t.Parallel()
	_, err := config.Load(env(map[string]string{"LOOKLY_LOG_LEVEL": "loud"}))
	if err == nil {
		t.Fatal("accepted")
	}
	for _, v := range []string{"LOOKLY_ENV", "DATABASE_URL", "LOOKLY_LOG_LEVEL", "JWT_SECRET", "SESSION_ENC_KEY"} {
		if !strings.Contains(err.Error(), v) {
			t.Errorf("missing %s in %q", v, err)
		}
	}
}

func TestPrintingTheConfigNeverShowsASecret(t *testing.T) {
	t.Parallel()
	c, err := config.Load(env(with(map[string]string{"SESSION_ENC_DECRYPT_KEYS": key(9)})))
	if err != nil {
		t.Fatal(err)
	}
	var b strings.Builder
	slog.New(slog.NewJSONHandler(&b, nil)).Info("config", "config", c)
	for _, s := range []string{fmt.Sprint(c), fmt.Sprintf("%+v", c), fmt.Sprintf("%#v", c), b.String()} {
		if strings.Contains(s, "s3cret-pass") || strings.Contains(s, "db.internal") {
			t.Errorf("printed config shows the database URL: %s", s)
		}
		// Neither as text nor as the numbers of a printed byte slice.
		for _, secret := range []string{configtest.JWTSecret, configtest.SessionEncKey, key(9), "116 101 115 116", "90 90 90", "9 9 9"} {
			if strings.Contains(s, secret) {
				t.Errorf("printed config shows a secret (%q): %s", secret, s)
			}
		}
	}
	if !strings.Contains(b.String(), `"decryptOnlyKeys":1`) || !strings.Contains(b.String(), `"accessTokenTTL"`) {
		t.Errorf("log value lacks the session settings: %s", b.String())
	}
	if !strings.Contains(b.String(), `"env":"production"`) {
		t.Errorf("log value lacks the environment: %s", b.String())
	}
}
