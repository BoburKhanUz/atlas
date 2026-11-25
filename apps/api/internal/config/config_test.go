package config_test

import (
	"fmt"
	"log/slog"
	"strings"
	"testing"
	"time"

	"lookly/internal/config"
)

const dbURL = "postgresql://atlas:s3cret-pass@db.internal:5432/atlas?sslmode=disable"

func env(vars map[string]string) func(string) (string, bool) {
	return func(k string) (string, bool) {
		v, ok := vars[k]
		return v, ok
	}
}

func valid() map[string]string {
	return map[string]string{"LOOKLY_ENV": "production", "DATABASE_URL": dbURL}
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
		})
	}
}

func TestEveryProblemIsReportedAtOnce(t *testing.T) {
	t.Parallel()
	_, err := config.Load(env(map[string]string{"LOOKLY_LOG_LEVEL": "loud"}))
	if err == nil {
		t.Fatal("accepted")
	}
	for _, v := range []string{"LOOKLY_ENV", "DATABASE_URL", "LOOKLY_LOG_LEVEL"} {
		if !strings.Contains(err.Error(), v) {
			t.Errorf("missing %s in %q", v, err)
		}
	}
}

func TestPrintingTheConfigNeverShowsTheDatabaseURL(t *testing.T) {
	t.Parallel()
	c, err := config.Load(env(valid()))
	if err != nil {
		t.Fatal(err)
	}
	var b strings.Builder
	slog.New(slog.NewJSONHandler(&b, nil)).Info("config", "config", c)
	for _, s := range []string{fmt.Sprint(c), fmt.Sprintf("%+v", c), fmt.Sprintf("%#v", c), b.String()} {
		if strings.Contains(s, "s3cret-pass") || strings.Contains(s, "db.internal") {
			t.Errorf("printed config shows the database URL: %s", s)
		}
	}
	if !strings.Contains(b.String(), `"env":"production"`) {
		t.Errorf("log value lacks the environment: %s", b.String())
	}
}
