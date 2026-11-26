// Package storage is where images are kept: the Store interface, the local
// driver (a directory, laid out as the Next.js server lays it out) and the
// R2 driver.
package storage

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
)

// ownerID is what an owner's directory may be called: the ids of users (the
// Next.js server's OWNER_PATTERN). Anything else could name another path.
var ownerID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// Local keeps images in a directory, laid out as the Next.js server lays it
// out (apps/web/src/lib/storage/provider.ts): users/<owner>/<image files>.
// Files are written readable by others (0644, in 0755 directories) as the
// Next.js server writes them: until the cutover both servers, in their own
// containers and users, read the same volume.
type Local struct{ root string }

var _ Store = (*Local)(nil)

// NewLocal returns the driver over an existing directory given by its
// absolute path.
func NewLocal(root string) (*Local, error) {
	if !filepath.IsAbs(root) {
		return nil, errors.New("storage: the directory must be an absolute path")
	}
	info, err := os.Stat(root)
	if err != nil {
		return nil, fmt.Errorf("storage: %w", err) // names the path and the reason (missing, permission)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("storage: %s is not a directory", root)
	}
	return &Local{root: filepath.Clean(root)}, nil
}

// DeleteOwner removes every image stored for the owner. An owner with
// nothing stored is not an error: the call can be repeated.
func (l *Local) DeleteOwner(ctx context.Context, owner string) error {
	if !ownerID.MatchString(owner) {
		return errors.New("storage: invalid owner id")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	// RemoveAll removes a symbolic link itself and never what it points to.
	if err := os.RemoveAll(filepath.Join(l.root, "users", owner)); err != nil {
		return fmt.Errorf("storage: remove the images of owner %s: %w", owner, err)
	}
	return nil
}

// path is the file of a key we make; ok is false for any other key.
func (l *Local) path(key string) (string, bool) {
	if !ValidKey(key) {
		return "", false
	}
	return filepath.Join(l.root, filepath.FromSlash(key)), true
}

// Put writes the object under a temporary name and renames it into place:
// a reader sees the old object or the new one, never part of one.
func (l *Local) Put(ctx context.Context, key string, data []byte) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	path, ok := l.path(key)
	if !ok {
		return errors.New("storage: invalid key")
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("storage: make the owner's directory: %w", err)
	}
	tmp, err := os.CreateTemp(dir, ".upload-*")
	if err != nil {
		return fmt.Errorf("storage: write %s: %w", key, err)
	}
	defer func() { _ = os.Remove(tmp.Name()) }() // gone after the rename; removes it after a failure
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("storage: write %s: %w", key, err)
	}
	if err := tmp.Chmod(0o644); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("storage: write %s: %w", key, err)
	}
	// On the disk before it gets its name: after a power cut the name is
	// the whole file or is not there, as for a reader.
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("storage: write %s: %w", key, err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("storage: write %s: %w", key, err)
	}
	if err := os.Rename(tmp.Name(), path); err != nil {
		return fmt.Errorf("storage: write %s: %w", key, err)
	}
	if err := syncDir(dir); err != nil {
		return fmt.Errorf("storage: write %s: %w", key, err)
	}
	return nil
}

// syncDir puts a directory's entries on the disk (a new name in it).
func syncDir(dir string) error {
	d, err := os.Open(dir)
	if err != nil {
		return err
	}
	if err := d.Sync(); err != nil {
		_ = d.Close()
		return err
	}
	return d.Close()
}

// Get reads an object.
func (l *Local) Get(ctx context.Context, key string) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	path, ok := l.path(key)
	if !ok {
		return nil, ErrNotFound
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("storage: read %s: %w", key, err)
	}
	return data, nil
}

// Delete removes objects; missing ones and keys we never make are skipped.
func (l *Local) Delete(ctx context.Context, keys ...string) error {
	var errs []error
	for _, key := range keys {
		if err := ctx.Err(); err != nil {
			return err
		}
		path, ok := l.path(key)
		if !ok {
			continue
		}
		if err := os.Remove(path); err != nil && !errors.Is(err, fs.ErrNotExist) {
			errs = append(errs, fmt.Errorf("storage: delete %s: %w", key, err))
		}
	}
	return errors.Join(errs...)
}

// List calls fn for every file under users/<owner>/ (the files the servers
// write, and whatever else is there).
func (l *Local) List(ctx context.Context, fn func(Object) error) error {
	owners, err := os.ReadDir(filepath.Join(l.root, "users"))
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	} else if err != nil {
		return fmt.Errorf("storage: list: %w", err)
	}
	for _, owner := range owners {
		if !owner.IsDir() {
			continue
		}
		files, err := os.ReadDir(filepath.Join(l.root, "users", owner.Name()))
		if err != nil {
			return fmt.Errorf("storage: list %s: %w", owner.Name(), err)
		}
		for _, f := range files {
			if err := ctx.Err(); err != nil {
				return err
			}
			if !f.Type().IsRegular() {
				continue
			}
			info, err := f.Info()
			if errors.Is(err, fs.ErrNotExist) {
				continue // removed meanwhile
			} else if err != nil {
				return fmt.Errorf("storage: list %s: %w", owner.Name(), err)
			}
			if err := fn(Object{Key: "users/" + owner.Name() + "/" + f.Name(), ModifiedAt: info.ModTime()}); err != nil {
				return err
			}
		}
	}
	return nil
}
