package storage_test

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"lookly/internal/storage"
)

func newLocal(t *testing.T) (*storage.Local, string) {
	t.Helper()
	root := t.TempDir()
	l, err := storage.NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	return l, root
}

var keyShape = regexp.MustCompile(`^users/cuser1/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

func TestNewKeysAreUniqueAndOfTheOwner(t *testing.T) {
	t.Parallel()
	seen := map[string]bool{}
	for range 1000 {
		base, err := storage.NewBase("cuser1")
		if err != nil {
			t.Fatal(err)
		}
		if !keyShape.MatchString(base) || seen[base] {
			t.Fatalf("base %q", base)
		}
		seen[base] = true
		for _, suffix := range []string{".jpg", ".png", ".webp", "_display.webp", "_thumb.webp"} {
			if !storage.ValidKey(base + suffix) {
				t.Errorf("%s%s is not a valid key", base, suffix)
			}
		}
	}
	for _, owner := range []string{"", "../x", "a/b", strings.Repeat("a", 65), "c d"} {
		if _, err := storage.NewBase(owner); err == nil {
			t.Errorf("owner %q accepted", owner)
		}
	}
}

func TestPutGetDeleteOnTheLocalDisk(t *testing.T) {
	t.Parallel()
	l, root := newLocal(t)
	ctx := context.Background()
	base, _ := storage.NewBase("cuser1")
	key := base + "_display.webp"
	if _, err := l.Get(ctx, key); !errors.Is(err, storage.ErrNotFound) {
		t.Fatalf("missing object: err %v", err)
	}
	if err := l.Put(ctx, key, []byte("pixels")); err != nil {
		t.Fatal(err)
	}
	got, err := l.Get(ctx, key)
	if err != nil || string(got) != "pixels" {
		t.Fatalf("get: %q, %v", got, err)
	}
	// Written where the Next.js server writes it, readable by it (another
	// user in another container may share the volume), with no temporary
	// file left behind.
	info, err := os.Stat(filepath.Join(root, key))
	if err != nil || info.Mode().Perm() != 0o644 {
		t.Fatalf("file: %v, mode %v", err, info.Mode().Perm())
	}
	entries, _ := os.ReadDir(filepath.Dir(filepath.Join(root, key)))
	if len(entries) != 1 {
		t.Errorf("%d entries in the owner's directory, want just the object", len(entries))
	}
	// Replaced whole.
	if err := l.Put(ctx, key, []byte("other pixels")); err != nil {
		t.Fatal(err)
	}
	if got, _ := l.Get(ctx, key); string(got) != "other pixels" {
		t.Errorf("after replace: %q", got)
	}
	// Delete: present, missing and invalid keys alike; nothing else touched.
	other := base + "_thumb.webp"
	_ = l.Put(ctx, other, []byte("thumb"))
	if err := l.Delete(ctx, key, base+".jpg", "users/../../etc/passwd", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := l.Get(ctx, key); !errors.Is(err, storage.ErrNotFound) {
		t.Errorf("deleted object: err %v", err)
	}
	if got, _ := l.Get(ctx, other); string(got) != "thumb" {
		t.Error("another object was deleted")
	}
}

func TestKeysWeNeverGenerateAreRefused(t *testing.T) {
	t.Parallel()
	l, root := newLocal(t)
	ctx := context.Background()
	outside := filepath.Join(filepath.Dir(root), "outside-"+filepath.Base(root)+".jpg")
	_ = os.WriteFile(outside, []byte("x"), 0o600)
	t.Cleanup(func() { _ = os.Remove(outside) })
	for _, key := range []string{
		"", "users/cuser1/x.jpg", "../" + filepath.Base(outside), "users/cuser1/../../" + filepath.Base(outside),
		"/etc/passwd", "users/cuser1/0f8fad5b-d9cb-469f-a165-70867728950e.gif",
	} {
		if err := l.Put(ctx, key, []byte("x")); err == nil {
			t.Errorf("put %q accepted", key)
		}
		if _, err := l.Get(ctx, key); !errors.Is(err, storage.ErrNotFound) {
			t.Errorf("get %q: err %v, want not found", key, err)
		}
	}
	if b, _ := os.ReadFile(outside); !bytes.Equal(b, []byte("x")) {
		t.Error("a file outside the storage directory changed")
	}
}

// A reader never sees half of an object being written.
func TestAReaderSeesAWholeObjectOrNone(t *testing.T) {
	t.Parallel()
	l, _ := newLocal(t)
	ctx := context.Background()
	base, _ := storage.NewBase("cuser1")
	key := base + ".png"
	big := bytes.Repeat([]byte("p"), 4<<20)
	var wg sync.WaitGroup
	stop := make(chan struct{})
	wg.Add(1)
	go func() {
		defer wg.Done()
		for {
			select {
			case <-stop:
				return
			default:
			}
			if got, err := l.Get(ctx, key); err == nil && len(got) != len(big) {
				t.Errorf("read %d bytes of %d", len(got), len(big))
				return
			}
		}
	}()
	for range 20 {
		if err := l.Put(ctx, key, big); err != nil {
			t.Fatal(err)
		}
	}
	close(stop)
	wg.Wait()
}

func TestListingEveryObject(t *testing.T) {
	t.Parallel()
	l, root := newLocal(t)
	ctx := context.Background()
	var want []string
	for _, owner := range []string{"cuser1", "cuser2"} {
		base, _ := storage.NewBase(owner)
		for _, suffix := range []string{".jpg", "_display.webp"} {
			_ = l.Put(ctx, base+suffix, []byte("x"))
			want = append(want, base+suffix)
		}
	}
	// A file whose name we never generate is listed too (the sweep reports it).
	_ = os.WriteFile(filepath.Join(root, "users", "cuser1", "notes.txt"), []byte("x"), 0o644)
	want = append(want, "users/cuser1/notes.txt")
	// A directory inside an owner's is not an object.
	_ = os.MkdirAll(filepath.Join(root, "users", "cuser1", "nested"), 0o755)
	got := map[string]time.Time{}
	if err := l.List(ctx, func(o storage.Object) error {
		got[o.Key] = o.ModifiedAt
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if len(got) != len(want) {
		t.Fatalf("listed %v, want %v", got, want)
	}
	for _, k := range want {
		if at, ok := got[k]; !ok || time.Since(at) > time.Minute {
			t.Errorf("%s: listed %v at %s", k, ok, at)
		}
	}
	// An empty storage lists nothing, and an error of the callback stops it.
	empty, _ := newLocal(t)
	n := 0
	_ = empty.List(ctx, func(storage.Object) error { n++; return nil })
	stop := errors.New("stop")
	if err := l.List(ctx, func(storage.Object) error { return stop }); !errors.Is(err, stop) || n != 0 {
		t.Errorf("err %v, %d objects in an empty storage", err, n)
	}
}

// The local driver is a Store.
var _ storage.Store = (*storage.Local)(nil)
