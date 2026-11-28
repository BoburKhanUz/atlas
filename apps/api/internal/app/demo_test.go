package app_test

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"lookly/internal/app"
	"lookly/internal/config/configtest"
)

const (
	demoPassword = "seed-secret-pass-7"
	oneShoe      = `{"name": "Dilnoza", "items": [{"file": "photos/shoe.png", "category": "shoes", "colors": ["white"], "season": ["summer"]}]}`
)

// demoFolder writes a manifest and its photos (fixture → name) into a new
// folder and returns the manifest's path.
func demoFolder(t *testing.T, manifest string, photos map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	for name, fixture := range photos {
		data, err := os.ReadFile(filepath.Join("..", "..", "testdata", "images", fixture))
		if err != nil {
			t.Fatal(err)
		}
		path := filepath.Join(dir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, data, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	path := filepath.Join(dir, "manifest.json")
	if err := os.WriteFile(path, []byte(manifest), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

// demoEnv is a valid configuration (its database is never reached by the
// cases here) with the demo account.
func demoEnv(changes map[string]string) func(string) (string, bool) {
	vars := map[string]string{"DEMO_EMAIL": " Demo@Lookly.UZ ", "DEMO_PASSWORD": demoPassword}
	for k, v := range changes {
		vars[k] = v
	}
	return configtest.Getenv(vars)
}

func runDemo(t *testing.T, getenv func(string) (string, bool), args ...string) (code int, stdout, stderr string) {
	t.Helper()
	var out, errs bytes.Buffer
	code = app.Run(context.Background(), append([]string{"demo-seed"}, args...), getenv, &out, &errs)
	if strings.Contains(out.String(), demoPassword) || strings.Contains(errs.String(), demoPassword) {
		t.Errorf("the password was printed:\n%s\n%s", out.String(), errs.String())
	}
	return code, out.String(), errs.String()
}

func TestDemoSeedUsage(t *testing.T) {
	t.Parallel()
	manifest := demoFolder(t, oneShoe, map[string]string{"photos/shoe.png": "min.png"})
	for _, args := range [][]string{
		{}, {"--apply"}, {"--manifest"}, {"--manifest", manifest, "--reset"}, {"--manifest", manifest, "--force"},
		{"--manifest", manifest, "extra"}, {"--manifest="},
	} {
		code, stdout, stderr := runDemo(t, demoEnv(nil), args...)
		if code != 2 || stdout != "" || !strings.Contains(stderr, "usage: lookly demo-seed --manifest <file> [--apply] [--reset]") {
			t.Errorf("%q: exit %d, stdout %q, stderr %q", args, code, stdout, stderr)
		}
	}
	if code, _, stderr := runDemo(t, demoEnv(nil), "--manifest", manifest, "--reset"); !strings.Contains(stderr, "--reset needs --apply") {
		t.Errorf("exit %d: %s", code, stderr)
	}
	// The command is in the list of commands.
	var stderr bytes.Buffer
	if code := app.Run(context.Background(), []string{"nope"}, demoEnv(nil), &bytes.Buffer{}, &stderr); code != 2 || !strings.Contains(stderr.String(), "demo-seed") {
		t.Errorf("exit %d: %s", code, stderr.String())
	}
}

func TestDemoSeedRefusesAnInvalidConfiguration(t *testing.T) {
	t.Parallel()
	manifest := demoFolder(t, oneShoe, map[string]string{"photos/shoe.png": "min.png"})
	code, stdout, stderr := runDemo(t, demoEnv(map[string]string{"JWT_SECRET": "<unset>", "DATABASE_URL": "<unset>"}), "--manifest", manifest)
	if code != 2 || stdout != "" || !strings.Contains(stderr, "JWT_SECRET") || !strings.Contains(stderr, "DATABASE_URL") {
		t.Errorf("exit %d, stdout %q, stderr %q", code, stdout, stderr)
	}
}

func TestDemoSeedNeedsTheAccountFromTheEnvironment(t *testing.T) {
	t.Parallel()
	manifest := demoFolder(t, oneShoe, map[string]string{"photos/shoe.png": "min.png"})
	for name, changes := range map[string]map[string]string{
		"DEMO_EMAIL":    {"DEMO_EMAIL": "not-an-address"},
		"DEMO_PASSWORD": {"DEMO_PASSWORD": "short"},
	} {
		code, stdout, stderr := runDemo(t, demoEnv(changes), "--manifest", manifest, "--apply")
		if code != 2 || stdout != "" || !strings.HasPrefix(stderr, name+" ") {
			t.Errorf("%s: exit %d, stdout %q, stderr %q", name, code, stdout, stderr)
		}
	}
}

// A dry run reads the manifest and puts every photo through the pipeline;
// it never touches the database (this one does not exist) or the storage.
func TestDemoSeedDryRun(t *testing.T) {
	t.Parallel()
	manifest := demoFolder(t, oneShoe, map[string]string{"photos/shoe.png": "min.png"})
	env := demoEnv(map[string]string{"DATABASE_URL": "postgresql://nobody@127.0.0.1:1/none", "STORAGE_LOCAL_DIR": "/nonexistent/uploads"})
	code, stdout, stderr := runDemo(t, env, "--manifest", manifest)
	want := "demo account demo@lookly.uz: 1 item (shoes 1)\nDRY RUN: manifest and photos are valid (use --apply to write)\n"
	if code != 0 || stdout != want || stderr != "" {
		t.Errorf("exit %d\nstdout %q\nwant   %q\nstderr %q", code, stdout, want, stderr)
	}
	// --manifest=<file> is the same.
	if code, stdout, _ := runDemo(t, env, "--manifest="+manifest); code != 0 || stdout != want {
		t.Errorf("--manifest=: exit %d, %q", code, stdout)
	}
}

func TestDemoSeedReportsAnInvalidManifestAndPhoto(t *testing.T) {
	t.Parallel()
	bad := demoFolder(t, `{"name": "", "items": [{"file": "../x.png", "category": "shoes", "subcategory": "jeans", "colors": [], "season": ["summer"]}]}`, nil)
	code, stdout, stderr := runDemo(t, demoEnv(nil), "--manifest", bad)
	want := "name: must be 1 to 60 characters after trimming\n" +
		"items.0.file: photo path must stay inside the manifest folder\n" +
		"items.0.colors: at least 1 colour\n" +
		"items.0.subcategory: jeans is not a shoes subcategory\n"
	if code != 1 || stdout != "" || stderr != want {
		t.Errorf("exit %d, stdout %q\nstderr %q\nwant   %q", code, stdout, stderr, want)
	}

	if code, _, stderr := runDemo(t, demoEnv(nil), "--manifest", filepath.Join(t.TempDir(), "missing.json")); code != 1 || !strings.HasPrefix(stderr, "the manifest: ") {
		t.Errorf("a missing manifest: exit %d, %q", code, stderr)
	}

	tiny := demoFolder(t, oneShoe, map[string]string{"photos/shoe.png": "tiny.png"})
	code, stdout, stderr = runDemo(t, demoEnv(nil), "--manifest", tiny)
	if code != 1 || stdout != "" || !strings.HasPrefix(stderr, "photo photos/shoe.png: each side must be 256 to 8000 pixels") {
		t.Errorf("a photo too small: exit %d, stdout %q, stderr %q", code, stdout, stderr)
	}
}
