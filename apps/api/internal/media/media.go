// Package media signs and checks the links the apps load private images
// from: /api/v1/media/<storage key>?exp=<unix seconds>&sig=<signature>,
// where the signature is HMAC-SHA256 over the key, a newline and the expiry,
// in unpadded base64url. Anyone holding a link can fetch the image until it
// expires, the model of an S3 presigned link; the links are the Next.js
// server's (apps/web/src/lib/storage/media.ts), so one server's links open
// on the other.
package media

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"regexp"
	"strconv"
	"time"

	"lookly/internal/storage"
)

// PathPrefix is where media are served.
const PathPrefix = "/api/v1/media/"

// Signer makes and checks signed links.
type Signer struct {
	secret []byte
	ttl    time.Duration
	base   string // PUBLIC_BASE_URL, or "" for links relative to the site
}

// NewSigner returns a Signer with the secret (MEDIA_SIGNING_SECRET), the
// links' lifetime and the public origin they start with ("" for relative).
func NewSigner(secret []byte, ttl time.Duration, publicBaseURL string) *Signer {
	return &Signer{secret: secret, ttl: ttl, base: publicBaseURL}
}

func (s *Signer) mac(key string, exp int64) string {
	m := hmac.New(sha256.New, s.secret)
	m.Write([]byte(key + "\n" + strconv.FormatInt(exp, 10)))
	return base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}

// Sign returns the link to key and when it stops working.
func (s *Signer) Sign(key string, now time.Time) (string, time.Time) {
	exp := now.Unix() + int64(s.ttl/time.Second) // whole seconds, as Math.floor(now / 1000)
	return s.base + PathPrefix + key + "?exp=" + strconv.FormatInt(exp, 10) + "&sig=" + s.mac(key, exp), time.Unix(exp, 0).UTC()
}

var expiry = regexp.MustCompile(`^[0-9]{1,12}$`)

// Verify reports whether sig signs key and exp, and the link has not
// expired (it works up to and including its expiry second). The comparison
// takes the same time whatever the signature.
func (s *Signer) Verify(key, exp, sig string, now time.Time) bool {
	if exp == "" || sig == "" || !storage.ValidKey(key) || !expiry.MatchString(exp) {
		return false
	}
	n, err := strconv.ParseInt(exp, 10, 64)
	if err != nil || n < now.Unix() {
		return false
	}
	return hmac.Equal([]byte(s.mac(key, n)), []byte(sig))
}
