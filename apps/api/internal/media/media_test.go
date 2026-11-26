package media_test

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"strconv"
	"testing"
	"time"

	"lookly/internal/golden"
	"lookly/internal/media"
	"lookly/internal/storage"
)

func TestSignedLinksAreTheNextJSOnes(t *testing.T) {
	t.Parallel()
	g := golden.LoadMedia(t)
	for _, s := range g.Signed {
		ttl := time.Hour
		if s.TTLSeconds != nil {
			n, _ := strconv.Atoi(*s.TTLSeconds)
			ttl = time.Duration(n) * time.Second
		}
		base := ""
		if s.PublicBaseURL != nil {
			base = *s.PublicBaseURL
		}
		signer := media.NewSigner([]byte(g.Secret), ttl, base)
		link, expires := signer.Sign(s.Key, time.UnixMilli(s.Now))
		if link != s.URL || expires.UTC().Format("2006-01-02T15:04:05.000Z") != s.ExpiresAt {
			t.Errorf("%s (ttl %v, base %q): %s %s, want %s %s", s.Key, ttl, base, link, expires, s.URL, s.ExpiresAt)
		}
	}
	signer := media.NewSigner([]byte(g.Secret), time.Hour, "")
	valid, invalid := 0, 0
	for _, v := range g.Verified {
		exp, sig := "", ""
		if v.Exp != nil {
			exp = *v.Exp
		}
		if v.Sig != nil {
			sig = *v.Sig
		}
		if got := signer.Verify(v.Key, exp, sig, time.UnixMilli(v.Now)); got != v.Valid {
			t.Errorf("%s: valid %v, want %v", v.Name, got, v.Valid)
		}
		if v.Valid {
			valid++
		} else {
			invalid++
		}
	}
	if valid == 0 || invalid == 0 {
		t.Errorf("%d valid and %d invalid checks", valid, invalid)
	}
	// An expiry past 12 digits is refused as the Next.js server refuses it,
	// even when it is correctly signed.
	// (Signed here by hand: no lifetime reaches 13 digits.)
	const exp = "1000000000000"
	mac := hmac.New(sha256.New, []byte(g.Secret))
	mac.Write([]byte(g.Signed[0].Key + "\n" + exp))
	if signer.Verify(g.Signed[0].Key, exp, base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), time.UnixMilli(g.Signed[0].Now)) {
		t.Error("a 13-digit expiry was accepted")
	}
	// Another secret signs other links.
	other := media.NewSigner([]byte("another-secret-another-secret-another"), time.Hour, "")
	otherLink, _ := other.Sign(g.Signed[0].Key, time.UnixMilli(g.Signed[0].Now))
	if otherLink == g.Signed[0].URL {
		t.Error("two secrets sign the same link")
	}
}

func TestStorageKeysAreTheNextJSOnes(t *testing.T) {
	t.Parallel()
	for _, k := range golden.LoadMedia(t).Keys {
		if got := storage.ValidKey(k.Key); got != k.Valid {
			t.Errorf("ValidKey(%q) = %v, want %v", k.Key, got, k.Valid)
		}
	}
}
