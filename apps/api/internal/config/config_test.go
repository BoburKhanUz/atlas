package config_test

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"log/slog"
	"maps"
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
	return configtest.Env(map[string]string{
		"LOOKLY_ENV": "production", "DATABASE_URL": dbURL,
		// The mock AI, acknowledged: the tests of the AI settings are in ai_test.go.
		"AI_LLM_PROVIDER": "mock", "AI_VISION_PROVIDER": "mock", "AI_ALLOW_MOCK_IN_PRODUCTION": "1",
	})
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
	if string(c.MediaSigningSecret) != configtest.MediaSigningSecret || c.MediaURLTTL != time.Hour {
		t.Errorf("media links: secret as configured %v, lifetime %s", string(c.MediaSigningSecret) == configtest.MediaSigningSecret, c.MediaURLTTL)
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
		"MEDIA_URL_TTL_SECONDS": " 600 ",

		"STORAGE_SWEEP_MAX_REMOVALS": "5000",
	})))
	if err != nil {
		t.Fatal(err)
	}
	if c.SweepMaxRemovals != 5000 || !strings.Contains(c.String(), "SweepMaxRemovals:5000") {
		t.Errorf("sweep limit %d: %s", c.SweepMaxRemovals, c)
	}
	// Unset, the sweep keeps its own limit.
	if plain, err := config.Load(env(with(nil))); err != nil || plain.SweepMaxRemovals != 0 {
		t.Errorf("sweep limit unset: %d, %v", plain.SweepMaxRemovals, err)
	}
	if c.AI.Vision.Provider != config.AIMock || !c.AI.MockInProduction {
		t.Errorf("vision provider %q, mock in production %t", c.AI.Vision.Provider, c.AI.MockInProduction)
	}
	if c.MediaURLTTL != 10*time.Minute {
		t.Errorf("media link lifetime %s", c.MediaURLTTL)
	}
	for _, edge := range []string{"60", "86400"} {
		if _, err := config.Load(env(with(map[string]string{"MEDIA_URL_TTL_SECONDS": edge}))); err != nil {
			t.Errorf("media link lifetime %s: %v", edge, err)
		}
	}
	if c.Env != config.Staging || c.HTTPAddr != "127.0.0.1:9090" || c.DBMaxConns != 25 ||
		c.LogLevel != slog.LevelDebug || c.ShutdownGrace != 45*time.Second {
		t.Fatalf("explicit: %+v", c)
	}
	for _, e := range []string{"development", "test"} {
		if _, err := config.Load(env(with(map[string]string{"LOOKLY_ENV": e}))); err != nil {
			t.Errorf("%s: %v", e, err)
		}
		// Outside the deployed environments the mock is the default and
		// needs no acknowledgement.
		for _, provider := range []string{"<unset>", "mock", "MOCK"} {
			c, err := config.Load(env(with(map[string]string{"LOOKLY_ENV": e, "AI_VISION_PROVIDER": provider, "AI_ALLOW_MOCK_IN_PRODUCTION": "<unset>"})))
			if err != nil || c.AI.Vision.Provider != config.AIMock || c.AI.MockInProduction {
				t.Errorf("%s with AI_VISION_PROVIDER %s: provider %q, err %v", e, provider, c.AI.Vision.Provider, err)
			}
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
		{"vision provider missing in production", map[string]string{"AI_VISION_PROVIDER": "<unset>"}, "AI_VISION_PROVIDER"},
		{"vision provider empty in production", map[string]string{"AI_VISION_PROVIDER": " "}, "AI_VISION_PROVIDER"},
		{"vision provider missing in staging", map[string]string{"LOOKLY_ENV": "staging", "AI_VISION_PROVIDER": "<unset>"}, "AI_VISION_PROVIDER"},
		{"mock not acknowledged in production", map[string]string{"AI_ALLOW_MOCK_IN_PRODUCTION": "<unset>"}, "AI_ALLOW_MOCK_IN_PRODUCTION"},
		{"mock not acknowledged in staging", map[string]string{"LOOKLY_ENV": "staging", "AI_ALLOW_MOCK_IN_PRODUCTION": "0"}, "AI_ALLOW_MOCK_IN_PRODUCTION"},
		{"mock acknowledged with another word", map[string]string{"AI_ALLOW_MOCK_IN_PRODUCTION": "true"}, "AI_ALLOW_MOCK_IN_PRODUCTION"},
		{"a real vision provider without its key", map[string]string{"AI_VISION_PROVIDER": "openai", "AI_VISION_MODEL": "m"}, "OPENAI_API_KEY"},
		{"a real vision provider without its model", map[string]string{"LOOKLY_ENV": "development", "AI_VISION_PROVIDER": "gemini", "GEMINI_API_KEY": "k"}, "AI_VISION_MODEL"},
		{"an unknown vision provider", map[string]string{"LOOKLY_ENV": "test", "AI_VISION_PROVIDER": "claude"}, "AI_VISION_PROVIDER"},
		{"text provider missing in production", map[string]string{"AI_LLM_PROVIDER": "<unset>"}, "AI_LLM_PROVIDER"},
		{"media secret missing", map[string]string{"MEDIA_SIGNING_SECRET": "<unset>"}, "MEDIA_SIGNING_SECRET"},
		{"media secret empty", map[string]string{"MEDIA_SIGNING_SECRET": ""}, "MEDIA_SIGNING_SECRET"},
		{"media secret short", map[string]string{"MEDIA_SIGNING_SECRET": strings.Repeat("m", 31)}, "MEDIA_SIGNING_SECRET"},
		{"media secret is a shipped default", map[string]string{"MEDIA_SIGNING_SECRET": "dev-secret-change-in-production-please-use-env"}, "MEDIA_SIGNING_SECRET"},
		{"media secret with a trailing newline", map[string]string{"MEDIA_SIGNING_SECRET": strings.Repeat("m", 40) + "\n"}, "MEDIA_SIGNING_SECRET"},
		{"media secret equal to the signing secret", map[string]string{"MEDIA_SIGNING_SECRET": configtest.JWTSecret}, "MEDIA_SIGNING_SECRET"},
		{"media link lifetime not a number", map[string]string{"MEDIA_URL_TTL_SECONDS": "1h"}, "MEDIA_URL_TTL_SECONDS"},
		{"media link lifetime fractional", map[string]string{"MEDIA_URL_TTL_SECONDS": "3600.5"}, "MEDIA_URL_TTL_SECONDS"},
		{"media link lifetime too short", map[string]string{"MEDIA_URL_TTL_SECONDS": "59"}, "MEDIA_URL_TTL_SECONDS"},
		{"media link lifetime too long", map[string]string{"MEDIA_URL_TTL_SECONDS": "86401"}, "MEDIA_URL_TTL_SECONDS"},
		{"sweep limit zero", map[string]string{"STORAGE_SWEEP_MAX_REMOVALS": "0"}, "STORAGE_SWEEP_MAX_REMOVALS"},
		{"sweep limit not a number", map[string]string{"STORAGE_SWEEP_MAX_REMOVALS": "all"}, "STORAGE_SWEEP_MAX_REMOVALS"},
		{"sweep limit beyond reason", map[string]string{"STORAGE_SWEEP_MAX_REMOVALS": "1000001"}, "STORAGE_SWEEP_MAX_REMOVALS"},
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
	for _, v := range []string{"LOOKLY_ENV", "DATABASE_URL", "LOOKLY_LOG_LEVEL", "JWT_SECRET", "MEDIA_SIGNING_SECRET", "SESSION_ENC_KEY", "STORAGE_LOCAL_DIR"} {
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
		for _, secret := range []string{configtest.JWTSecret, configtest.MediaSigningSecret, configtest.SessionEncKey, key(9), "116 101 115 116", "90 90 90", "9 9 9"} {
			if strings.Contains(s, secret) {
				t.Errorf("printed config shows a secret (%q): %s", secret, s)
			}
		}
	}
	if !strings.Contains(b.String(), `"decryptOnlyKeys":1`) || !strings.Contains(b.String(), `"accessTokenTTL"`) || !strings.Contains(b.String(), `"mediaURLTTL"`) {
		t.Errorf("log value lacks the session settings: %s", b.String())
	}
	if !strings.Contains(b.String(), `"env":"production"`) {
		t.Errorf("log value lacks the environment: %s", b.String())
	}
}

func TestTheWeatherProvider(t *testing.T) {
	t.Parallel()
	// The real service unless the mock is named; the mock nowhere it would
	// be shown to users as their weather.
	for _, c := range []struct {
		env, value string
		want       string // "" = refused
	}{
		{"production", "<unset>", config.WeatherOpenMeteo},
		{"production", "open-meteo", config.WeatherOpenMeteo},
		{"production", "Open-Meteo", config.WeatherOpenMeteo},
		{"production", "mock", ""},
		{"production", "MOCK", ""},
		{"production", "yandex", ""},
		{"production", " ", config.WeatherOpenMeteo}, // blank is unset, as for every variable
		{"staging", "<unset>", config.WeatherOpenMeteo},
		{"staging", "mock", ""},
		{"development", "<unset>", config.WeatherOpenMeteo},
		{"development", "mock", config.WeatherMock},
		{"development", "Mock", config.WeatherMock},
		{"development", "open-meteo", config.WeatherOpenMeteo},
		{"development", "none", ""},
		{"test", "mock", config.WeatherMock},
		{"test", "openmeteo", ""},
	} {
		changes := map[string]string{"LOOKLY_ENV": c.env, "WEATHER_PROVIDER": c.value}
		if c.env == "development" || c.env == "test" {
			changes["AI_ALLOW_MOCK_IN_PRODUCTION"] = "<unset>"
		}
		got, err := config.Load(env(with(changes)))
		switch {
		case c.want == "" && (err == nil || !strings.Contains(err.Error(), "WEATHER_PROVIDER")):
			t.Errorf("%s with WEATHER_PROVIDER %q: provider %q, err %v; want a refusal that names the variable", c.env, c.value, got.WeatherProvider, err)
		case c.want != "" && (err != nil || got.WeatherProvider != c.want):
			t.Errorf("%s with WEATHER_PROVIDER %q: provider %q, err %v; want %q", c.env, c.value, got.WeatherProvider, err, c.want)
		}
	}
	// The acknowledgement of the mock AI does not let the mock weather in.
	_, err := config.Load(env(with(map[string]string{"WEATHER_PROVIDER": "mock", "AI_ALLOW_MOCK_IN_PRODUCTION": "1"})))
	if err == nil || !strings.Contains(err.Error(), "WEATHER_PROVIDER") {
		t.Errorf("production with the mock weather and the AI acknowledgement: %v", err)
	}
	c, err := config.Load(env(with(map[string]string{"LOOKLY_ENV": "development", "WEATHER_PROVIDER": "mock"})))
	if err != nil {
		t.Fatal(err)
	}
	if text := fmt.Sprintf("%v %+v", c, c.LogValue()); !strings.Contains(text, "WeatherProvider:mock") || !strings.Contains(text, "weatherProvider=mock") {
		t.Errorf("the weather provider is not in the printed configuration: %s", text)
	}
}

// The migrations read the database's settings only: the server's secrets
// are not needed, and the same rules hold for what is read.
func TestLoadDatabaseReadsTheDatabaseSettingsOnly(t *testing.T) {
	t.Parallel()
	vars := map[string]string{"LOOKLY_ENV": "production", "DATABASE_URL": valid()["DATABASE_URL"], "LOOKLY_DB_MAX_CONNS": "3", "LOOKLY_LOG_LEVEL": "warn"}
	c, err := config.LoadDatabase(env(vars))
	if err != nil {
		t.Fatal(err)
	}
	if c.Env != config.Production || c.DatabaseURL != vars["DATABASE_URL"] || c.DBMaxConns != 3 || c.LogLevel != slog.LevelWarn || c.JWTSecret != nil {
		t.Errorf("%+v", c)
	}
	for name, change := range map[string]map[string]string{
		"no environment":                 {"LOOKLY_ENV": ""},
		"no database":                    {"DATABASE_URL": ""},
		"production without TLS setting": {"DATABASE_URL": "postgresql://u:p@db:5432/lookly"},
		"a bad pool size":                {"LOOKLY_DB_MAX_CONNS": "0"},
		"debug logs in production":       {"LOOKLY_LOG_LEVEL": "debug"},
	} {
		bad := maps.Clone(vars)
		maps.Copy(bad, change)
		if _, err := config.LoadDatabase(env(bad)); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}
