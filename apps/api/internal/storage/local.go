// Package storage is where images are kept. Stage B3 brings the part the
// account deletion needs, removing everything of one owner, for the local
// driver; uploads, reads and the R2 driver arrive with stage B4 behind the
// same shape.
package storage

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
)

// ownerID is what an owner's directory may be called: the ids of users (the
// Next.js server's OWNER_PATTERN). Anything else could name another path.
var ownerID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// Local keeps images in a directory, laid out as the Next.js server lays it
// out (apps/web/src/lib/storage/provider.ts): users/<owner>/<image files>.
type Local struct{ root string }

// NewLocal returns the driver over an existing directory given by its
// absolute path.
func NewLocal(root string) (*Local, error) {
	if !filepath.IsAbs(root) {
		return nil, errors.New("storage: the directory must be an absolute path")
	}
	info, err := os.Stat(root)
	if err != nil || !info.IsDir() {
		return nil, fmt.Errorf("storage: %s is not an existing directory", root)
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
