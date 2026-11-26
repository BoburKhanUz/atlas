package storage

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"regexp"
	"time"
)

// Store keeps the images. Keys are the ones NewBase and the variant
// suffixes make; a key of any other form is never turned into a path or an
// object name.
type Store interface {
	// Put writes an object whole (replacing one with the key).
	Put(ctx context.Context, key string, data []byte) error
	// Get reads an object; ErrNotFound when there is none (or the key is not
	// one we make).
	Get(ctx context.Context, key string) ([]byte, error)
	// Delete removes objects; missing objects and keys we never make are
	// skipped.
	Delete(ctx context.Context, keys ...string) error
	// DeleteOwner removes every object of an owner (account deletion).
	DeleteOwner(ctx context.Context, owner string) error
	// List calls fn for every object stored, whatever its name (the sweep
	// reports names we never make). An error of fn stops the listing.
	List(ctx context.Context, fn func(Object) error) error
}

// Object is a stored object's key and when it was last written.
type Object struct {
	Key        string
	ModifiedAt time.Time
}

// ErrNotFound: no such object.
var ErrNotFound = errors.New("storage: no such object")

// keyPattern is the keys we make: users/<owner>/<uuid>, then the master's
// extension, or a variant. "_thumb.jpg" is a Phase 2 thumbnail, still read.
// The Next.js server's KEY_PATTERN (apps/web/src/lib/storage/provider.ts).
var keyPattern = regexp.MustCompile(`^users/[A-Za-z0-9_-]{1,64}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(_thumb|_display)?\.(jpg|png|webp)$`)

// ValidKey reports whether key is one we make.
func ValidKey(key string) bool { return keyPattern.MatchString(key) }

// NewBase returns a new users/<owner>/<uuid> (a random version 4 UUID): the
// master's key and the variants' keys add their suffix to it.
func NewBase(owner string) (string, error) {
	if !ownerID.MatchString(owner) {
		return "", errors.New("storage: invalid owner id")
	}
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("storage: random key: %w", err)
	}
	b[6], b[8] = b[6]&0x0f|0x40, b[8]&0x3f|0x80
	return fmt.Sprintf("users/%s/%x-%x-%x-%x-%x", owner, b[0:4], b[4:6], b[6:8], b[8:10], b[10:16]), nil
}

// ContentType is the media type of an object by its key.
func ContentType(key string) string {
	switch {
	case len(key) > 4 && key[len(key)-4:] == ".png":
		return "image/png"
	case len(key) > 5 && key[len(key)-5:] == ".webp":
		return "image/webp"
	default:
		return "image/jpeg"
	}
}
