package storage_test

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"lookly/internal/storage"
)

// tree makes a storage directory as the Next.js server fills it: images
// under users/<owner>/.
func tree(t *testing.T, owners ...string) string {
	t.Helper()
	root := t.TempDir()
	for _, owner := range owners {
		dir := filepath.Join(root, "users", owner)
		if err := os.MkdirAll(filepath.Join(dir, "nested"), 0o700); err != nil {
			t.Fatal(err)
		}
		for _, name := range []string{"a.jpg", "a_display.webp", "a_thumb.webp", "nested/deep.png"} {
			if err := os.WriteFile(filepath.Join(dir, name), []byte("image"), 0o600); err != nil {
				t.Fatal(err)
			}
		}
	}
	return root
}

func exists(path string) bool {
	_, err := os.Lstat(path)
	return err == nil
}

func TestDeleteOwnerRemovesThatOwnersImagesOnly(t *testing.T) {
	t.Parallel()
	root := tree(t, "cuser1", "cuser2", "cuser10")
	local, err := storage.NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := local.DeleteOwner(context.Background(), "cuser1"); err != nil {
		t.Fatal(err)
	}
	if exists(filepath.Join(root, "users", "cuser1")) {
		t.Error("the owner's directory is still there")
	}
	for _, kept := range []string{"cuser2/a.jpg", "cuser2/nested/deep.png", "cuser10/a_thumb.webp"} {
		if !exists(filepath.Join(root, "users", kept)) {
			t.Errorf("another owner's %s is gone", kept)
		}
	}
	// Again, and for an owner who never stored anything: nothing to do.
	for _, owner := range []string{"cuser1", "cnobody"} {
		if err := local.DeleteOwner(context.Background(), owner); err != nil {
			t.Errorf("%s: %v", owner, err)
		}
	}
	if !exists(filepath.Join(root, "users", "cuser2", "a.jpg")) {
		t.Error("a repeat removed another owner's image")
	}
}

// An owner id is a path component: one that could name another directory is
// refused before the file system is touched.
func TestDeleteOwnerRefusesIdsThatAreNotIds(t *testing.T) {
	t.Parallel()
	root := tree(t, "cuser1", "cuser2")
	outside := filepath.Join(filepath.Dir(root), "outside-"+filepath.Base(root))
	if err := os.MkdirAll(outside, 0o700); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(outside) })
	local, err := storage.NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{
		"", ".", "..", "../" + filepath.Base(outside), "../../" + filepath.Base(outside), "cuser1/..", "cuser1/../cuser2", "/", root, "cuser2/",
		"cuser 2", "cuser2\x00", "cuser2\n", "ўзбек", "*", "c*", strings.Repeat("a", 65), "a.b", "~",
	} {
		if err := local.DeleteOwner(context.Background(), id); err == nil {
			t.Errorf("owner id %q was accepted", id)
		}
	}
	for _, kept := range []string{filepath.Join(root, "users", "cuser1", "a.jpg"), filepath.Join(root, "users", "cuser2", "a.jpg"), filepath.Join(root, "users"), outside} {
		if !exists(kept) {
			t.Errorf("%s is gone", kept)
		}
	}
	// The longest and the oddest ids that are ids.
	for _, id := range []string{strings.Repeat("a", 64), "A-b_9"} {
		if err := local.DeleteOwner(context.Background(), id); err != nil {
			t.Errorf("owner id %q: %v", id, err)
		}
	}
}

// A link in place of an owner's directory is removed; what it points to is
// not followed into.
func TestDeleteOwnerDoesNotFollowLinks(t *testing.T) {
	t.Parallel()
	root := tree(t, "cuser2")
	target := t.TempDir()
	if err := os.WriteFile(filepath.Join(target, "precious"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, filepath.Join(root, "users", "cuser1")); err != nil {
		t.Fatal(err)
	}
	local, err := storage.NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := local.DeleteOwner(context.Background(), "cuser1"); err != nil {
		t.Fatal(err)
	}
	if exists(filepath.Join(root, "users", "cuser1")) || !exists(filepath.Join(target, "precious")) {
		t.Error("the link is still there, or what it pointed to was removed")
	}
}

// The directory must be there when the driver is made: a mistyped path
// would otherwise "delete" nothing, silently, for ever.
func TestTheStorageDirectoryMustExist(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	file := filepath.Join(dir, "a-file")
	if err := os.WriteFile(file, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	for name, root := range map[string]string{"missing": filepath.Join(dir, "missing"), "a file": file, "relative, although it exists": ".", "empty": ""} {
		if _, err := storage.NewLocal(root); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
	if _, err := storage.NewLocal(dir); err != nil {
		t.Errorf("an existing directory: %v", err)
	}
}

func TestDeleteOwnerStopsWithItsContext(t *testing.T) {
	t.Parallel()
	root := tree(t, "cuser1")
	local, err := storage.NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := local.DeleteOwner(ctx, "cuser1"); err == nil {
		t.Error("a cancelled purge reported success")
	}
	if !exists(filepath.Join(root, "users", "cuser1", "a.jpg")) {
		t.Error("a cancelled purge removed the images")
	}
}
