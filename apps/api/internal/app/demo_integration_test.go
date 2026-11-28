//go:build integration

package app_test

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const threeDemoItems = `{
  "name": "Dilnoza",
  "preferences": {"preferredStyles": ["minimal"], "favoriteColors": ["white"]},
  "items": [
    {"file": "photos/shirt.png", "category": "shirt", "subcategory": "tshirt", "colors": ["white"], "season": ["summer"]},
    {"file": "photos/jeans.jpg", "category": "pants", "subcategory": "jeans", "colors": ["navy"], "season": ["autumn"]},
    {"file": "photos/tee.png", "category": "shirt", "colors": ["gray"], "season": ["spring"]}
  ]
}`

var threeDemoPhotos = map[string]string{"photos/shirt.png": "min.png", "photos/jeans.jpg": "gps.jpg", "photos/tee.png": "gray.png"}

// storedFiles counts the files under a local storage directory.
func storedFiles(t *testing.T, root string) int {
	t.Helper()
	n := 0
	err := filepath.WalkDir(root, func(_ string, d os.DirEntry, err error) error {
		if err == nil && d.Type().IsRegular() {
			n++
		}
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	return n
}

func TestDemoSeedAppliesRefusesASecondRunAndResets(t *testing.T) {
	t.Parallel()
	pool := schemaDB(t)
	uploads := t.TempDir()
	env := func(extra map[string]string) func(string) (string, bool) {
		vars := map[string]string{"STORAGE_LOCAL_DIR": uploads, "DEMO_EMAIL": "Demo@Lookly.uz", "DEMO_PASSWORD": demoPassword}
		for k, v := range extra {
			vars[k] = v
		}
		return appEnv(pool, vars)
	}
	manifest := demoFolder(t, threeDemoItems, threeDemoPhotos)
	summary := "demo account demo@lookly.uz: 3 items (shirt 2, pants 1)\n"
	users := func() int {
		var n int
		if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM "User"`).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}

	// A dry run writes nothing.
	code, stdout, stderr := runDemo(t, env(nil), "--manifest", manifest)
	if code != 0 || !strings.HasSuffix(stdout, "DRY RUN: manifest and photos are valid (use --apply to write)\n") || users() != 0 || storedFiles(t, uploads) != 0 {
		t.Fatalf("dry run: exit %d, stdout %q, stderr %q, %d users", code, stdout, stderr, users())
	}

	code, stdout, stderr = runDemo(t, env(nil), "--manifest", manifest, "--apply")
	if want := summary + "created the demo user\nAPPLIED: 3 items\n"; code != 0 || stdout != want {
		t.Fatalf("apply: exit %d\nstdout %q\nwant   %q\nstderr %s", code, stdout, want, stderr)
	}
	if users() != 1 || storedFiles(t, uploads) != 9 {
		t.Errorf("%d users, %d files", users(), storedFiles(t, uploads))
	}

	// Again without --reset: refused, nothing changed.
	code, stdout, stderr = runDemo(t, env(nil), "--manifest", manifest, "--apply")
	if code != 1 || stdout != summary || stderr != "demo@lookly.uz already has 3 items; use --reset to replace them\n" {
		t.Errorf("second apply: exit %d, stdout %q, stderr %q", code, stdout, stderr)
	}
	if storedFiles(t, uploads) != 9 {
		t.Errorf("%d files", storedFiles(t, uploads))
	}

	// With --reset and a new password: the wardrobe replaced.
	code, stdout, stderr = runDemo(t, env(map[string]string{"DEMO_PASSWORD": demoPassword + "-new"}), "--manifest", manifest, "--apply", "--reset")
	if want := summary + "removed 3 earlier items\nupdated the demo user\nAPPLIED: 3 items\n"; code != 0 || stdout != want {
		t.Errorf("reset: exit %d\nstdout %q\nwant   %q\nstderr %s", code, stdout, want, stderr)
	}
	if strings.Contains(stdout+stderr, demoPassword) {
		t.Error("the new password was printed")
	}
	if users() != 1 || storedFiles(t, uploads) != 9 {
		t.Errorf("%d users, %d files", users(), storedFiles(t, uploads))
	}
}

func TestDemoSeedStopsAtAPhotoThePipelineRefusesBeforeWritingAnything(t *testing.T) {
	t.Parallel()
	pool := schemaDB(t)
	uploads := t.TempDir()
	photos := map[string]string{"photos/shirt.png": "min.png", "photos/jeans.jpg": "garbage.bin", "photos/tee.png": "gray.png"}
	manifest := demoFolder(t, threeDemoItems, photos)
	code, stdout, stderr := runDemo(t, appEnv(pool, map[string]string{"STORAGE_LOCAL_DIR": uploads, "DEMO_EMAIL": "demo@lookly.uz", "DEMO_PASSWORD": demoPassword}),
		"--manifest", manifest, "--apply")
	if code != 1 || stdout != "" || !strings.HasPrefix(stderr, "photo photos/jeans.jpg: not a readable picture") {
		t.Errorf("exit %d, stdout %q, stderr %q", code, stdout, stderr)
	}
	var n int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM "User"`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 || storedFiles(t, uploads) != 0 {
		t.Errorf("%d users, %d files", n, storedFiles(t, uploads))
	}
}

func TestDemoSeedApplyNeedsTheDatabaseAndTheStorage(t *testing.T) {
	t.Parallel()
	pool := schemaDB(t)
	manifest := demoFolder(t, threeDemoItems, threeDemoPhotos)
	account := map[string]string{"DEMO_EMAIL": "demo@lookly.uz", "DEMO_PASSWORD": demoPassword}

	missing := map[string]string{"STORAGE_LOCAL_DIR": filepath.Join(t.TempDir(), "missing")}
	for k, v := range account {
		missing[k] = v
	}
	if code, _, stderr := runDemo(t, appEnv(pool, missing), "--manifest", manifest, "--apply"); code != 2 || !strings.Contains(stderr, "STORAGE_LOCAL_DIR") {
		t.Errorf("a storage directory that is not there: exit %d, %q", code, stderr)
	}

	down := map[string]string{"DATABASE_URL": "postgresql://nobody@" + freeAddr(t) + "/none", "STORAGE_LOCAL_DIR": t.TempDir()}
	for k, v := range account {
		down[k] = v
	}
	if code, _, stderr := runDemo(t, appEnv(pool, down), "--manifest", manifest, "--apply"); code != 1 || !strings.Contains(stderr, "cannot reach the database") {
		t.Errorf("a database that is down: exit %d, %q", code, stderr)
	}
}

// A failure after the account is written says how far the run came and
// how to finish it; a changed password ends the account's sessions.
func TestDemoSeedReportsAFailureMidwayAndEndedSessions(t *testing.T) {
	t.Parallel()
	pool := schemaDB(t)
	uploads := t.TempDir()
	manifest := demoFolder(t, threeDemoItems, threeDemoPhotos)
	env := func(password string) func(string) (string, bool) {
		return appEnv(pool, map[string]string{"STORAGE_LOCAL_DIR": uploads, "DEMO_EMAIL": "demo@lookly.uz", "DEMO_PASSWORD": password})
	}
	exec := func(sql string) {
		t.Helper()
		if _, err := pool.Exec(context.Background(), sql); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	exec(`CREATE FUNCTION refuse_images() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'the disk of the database is full'; END $$`)
	exec(`CREATE TRIGGER refuse_images BEFORE INSERT ON "WardrobeImage" FOR EACH ROW EXECUTE FUNCTION refuse_images()`)
	code, stdout, stderr := runDemo(t, env(demoPassword), "--manifest", manifest, "--apply")
	if code != 1 || !strings.HasSuffix(stdout, "created the demo user\n") || !strings.HasPrefix(stderr, "item 1 (photos/shirt.png): write the item: ") ||
		!strings.HasSuffix(stderr, "made 0 of 3 items; run again with --apply --reset\n") {
		t.Errorf("exit %d\nstdout %q\nstderr %q", code, stdout, stderr)
	}
	if n := storedFiles(t, uploads); n != 0 {
		t.Errorf("%d files", n)
	}

	exec(`DROP TRIGGER refuse_images ON "WardrobeImage"`)
	exec(`INSERT INTO "SessionFamily" ("id", "userId", "absoluteExpiresAt") SELECT 'fam_1', "id", now() + interval '1 day' FROM "User"`)
	code, stdout, stderr = runDemo(t, env(demoPassword+"-new"), "--manifest", manifest, "--apply")
	if code != 0 || !strings.Contains(stdout, "\nended the demo user's sessions: 1 (the password changed)\nupdated the demo user\nAPPLIED: 3 items\n") {
		t.Errorf("exit %d\nstdout %q\nstderr %q", code, stdout, stderr)
	}
}
