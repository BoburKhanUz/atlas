package auth

import (
	"errors"

	"golang.org/x/crypto/bcrypt"
)

// PasswordCost is the bcrypt cost of new hashes (owner decision, 2026-11-25).
// The Next.js API used 10; those hashes still verify, and NeedsRehash asks
// for their replacement after a successful sign-in.
const PasswordCost = 12

// LegacyPasswordCost is the cost of the hashes the Next.js API stored. They
// stay until their owners next sign in.
const LegacyPasswordCost = 10

// MaxPasswordBytes is the most bcrypt reads: anything after byte 72 would
// be ignored silently, so a longer password is refused when it is set.
const MaxPasswordBytes = 72

// ErrPasswordTooLong is returned when a new password is over MaxPasswordBytes.
var ErrPasswordTooLong = errors.New("password is longer than 72 bytes")

// HashPassword hashes a new password. The length is counted in bytes of
// UTF-8, not characters.
func HashPassword(plain string) (string, error) {
	if len(plain) > MaxPasswordBytes {
		return "", ErrPasswordTooLong
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(plain), PasswordCost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

// VerifyPassword reports whether plain matches a stored bcrypt hash. A
// password longer than 72 bytes is compared by its first 72, as the Next.js
// API (bcryptjs) did when it stored the hash: a user who registered with a
// long password keeps signing in. Anything that is not a bcrypt hash
// matches nothing.
func VerifyPassword(plain, hash string) bool {
	// bcrypt itself reads only the first 72 bytes; the golden vectors fail
	// if a library update ever changes that.
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(plain)) == nil
}

// NeedsRehash reports whether a stored hash is weaker than PasswordCost (or
// not a bcrypt hash at all) and is to be replaced after a successful sign-in.
func NeedsRehash(hash string) bool {
	cost, err := bcrypt.Cost([]byte(hash))
	return err != nil || cost < PasswordCost
}

// Bcrypt is the password hasher of the running server: the functions above
// behind one value, so that services take a hasher and tests can count its
// use.
type Bcrypt struct{}

// Hash is HashPassword.
func (Bcrypt) Hash(plain string) (string, error) { return HashPassword(plain) }

// Verify is VerifyPassword.
func (Bcrypt) Verify(plain, hash string) bool { return VerifyPassword(plain, hash) }

// NeedsRehash is NeedsRehash.
func (Bcrypt) NeedsRehash(hash string) bool { return NeedsRehash(hash) }

// Decoys returns two hashes of a random password nobody knows: one of the
// current cost and one of the legacy cost. A failed sign-in is compared
// against them so that it costs the same work whatever the account's hash
// is, and whether the account exists at all.
func (Bcrypt) Decoys() (current, legacy string, err error) {
	password := []byte(NewRefreshToken())
	c, err := bcrypt.GenerateFromPassword(password, PasswordCost)
	if err != nil {
		return "", "", err
	}
	l, err := bcrypt.GenerateFromPassword(password, LegacyPasswordCost)
	if err != nil {
		return "", "", err
	}
	return string(c), string(l), nil
}
