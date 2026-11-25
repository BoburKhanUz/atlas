package auth_test

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"strings"
	"testing"
	"time"

	"lookly/internal/auth"
	"lookly/internal/golden"
)

// goStricter: tokens the TypeScript verifier accepts and Go refuses on
// purpose. Our own signer never produces any of them.
var goStricter = map[string]string{
	"no exp":           "a token without an expiry would be valid for ever",
	"empty sub":        "no user has an empty id",
	"trailing space":   "strict base64url: no characters outside the alphabet",
	"padded signature": "strict base64url: JWT parts are unpadded",
}

// bearerStricter: headers the TypeScript parser takes a token from and Go
// does not. Node reads header bytes as Latin-1, so the byte 0xA0 (no-break
// space) counted as white space after "Bearer"; in Go only space and tab do.
var bearerStricter = map[string]bool{"Bearer\u00a0abc": true}

func TestVerifyMatchesTheTypeScriptVerifier(t *testing.T) {
	t.Parallel()
	g := golden.LoadAuth(t)
	tokens := auth.NewTokens([]byte(g.JWTSecret))
	now := time.Unix(g.GeneratedAtSeconds, 0)
	seen := map[string]bool{}
	for _, c := range g.JWT.Verify {
		seen[c.Name] = true
		got, ok := tokens.Verify(c.Token, now)
		want := c.Payload
		if _, stricter := goStricter[c.Name]; stricter {
			if want == nil {
				t.Errorf("%s: listed as stricter in Go, but TypeScript refuses it too", c.Name)
			}
			want = nil
		}
		switch {
		case want == nil && ok:
			t.Errorf("%s: accepted %+v, want refused", c.Name, got)
		case want != nil && !ok:
			t.Errorf("%s: refused, want %+v", c.Name, *want)
		case want != nil && (got.Sub != want.Sub || got.Email != want.Email || got.SID != want.SID):
			t.Errorf("%s: got %+v, want %+v", c.Name, got, *want)
		}
	}
	for name := range goStricter {
		if !seen[name] {
			t.Errorf("stricter case %q is not in the vectors", name)
		}
	}
}

func TestSignProducesTheTokensTheTypeScriptSignerProduced(t *testing.T) {
	t.Parallel()
	g := golden.LoadAuth(t)
	tokens := auth.NewTokens([]byte(g.JWTSecret))
	for _, c := range g.JWT.Signed {
		claims := auth.Claims{Sub: c.Payload.Sub, Email: c.Payload.Email, SID: c.Payload.SID}
		got := tokens.Sign(claims, time.Unix(c.Iat, 0), time.UnixMilli(c.ExpiresAtMs))
		if got != c.Token {
			t.Errorf("%+v:\n got %s\nwant %s", claims, got, c.Token)
		}
		// And each implementation accepts the other's token.
		back, ok := tokens.Verify(c.Token, time.Unix(c.Iat, 0))
		if !ok || back != claims {
			t.Errorf("verify(%+v) = %+v, %v", claims, back, ok)
		}
	}
}

func TestExpiryBoundary(t *testing.T) {
	t.Parallel()
	tokens := auth.NewTokens([]byte("unit-test-secret-unit-test-secret-00"))
	issued := time.Unix(1_800_000_000, 0)
	token := tokens.Sign(auth.Claims{Sub: "u", Email: "a@b.uz"}, issued, issued.Add(15*time.Minute))
	exp := issued.Add(15 * time.Minute)
	if _, ok := tokens.Verify(token, exp.Add(-time.Second)); !ok {
		t.Error("refused one second before the expiry")
	}
	// As jose: expired from the expiry second on.
	if _, ok := tokens.Verify(token, exp); ok {
		t.Error("accepted at the expiry second")
	}
	if _, ok := tokens.Verify(token, exp.Add(-time.Millisecond)); !ok {
		t.Error("refused within the last second (time is floored to seconds, as in jose)")
	}
	other := auth.NewTokens([]byte("another-secret-another-secret-000000"))
	if _, ok := other.Verify(token, issued); ok {
		t.Error("accepted with another secret")
	}
}

// A token has exactly one spelling. The last character of the signature
// carries two unused bits; a lenient decoder ignores them, so a second
// string would pass as the same token.
func TestASignatureWithStrayBitsIsRefused(t *testing.T) {
	t.Parallel()
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
	tokens := auth.NewTokens([]byte("unit-test-secret-unit-test-secret-00"))
	issued := time.Unix(1_800_000_000, 0)
	token := tokens.Sign(auth.Claims{Sub: "u", Email: "a@b.uz"}, issued, issued.Add(time.Minute))
	last := strings.IndexByte(alphabet, token[len(token)-1])
	if last < 0 || last&3 != 0 {
		t.Fatalf("signature ends in %q: expected two zero bits", token[len(token)-1])
	}
	for _, stray := range []int{1, 2, 3} {
		forged := token[:len(token)-1] + string(alphabet[last|stray])
		if _, ok := tokens.Verify(forged, issued); ok {
			t.Errorf("accepted %q, another spelling of the same signature", forged)
		}
	}
	if _, ok := tokens.Verify(token, issued); !ok {
		t.Error("the token itself is refused")
	}
}

func TestRefreshTokensAndHashes(t *testing.T) {
	t.Parallel()
	g := golden.LoadAuth(t)
	for _, c := range g.TokenHashes {
		if got := auth.HashToken(c.Token); got != c.SHA256 {
			t.Errorf("HashToken(%q) = %s, want %s", c.Token, got, c.SHA256)
		}
	}
	seen := map[string]bool{}
	for range 100 {
		token := auth.NewRefreshToken()
		// 32 random bytes as unpadded base64url: 43 characters.
		if len(token) != 43 || strings.ContainsAny(token, "+/=") || seen[token] {
			t.Fatalf("refresh token %q", token)
		}
		seen[token] = true
	}
}

func TestBearerTokenMatchesTheTypeScriptParser(t *testing.T) {
	t.Parallel()
	g := golden.LoadAuth(t)
	stricter := 0
	for _, c := range g.Bearer {
		header := ""
		if c.Header != nil {
			header = *c.Header
		}
		got, ok := auth.BearerToken(header)
		if bearerStricter[header] {
			if c.Token == nil || ok {
				t.Errorf("%q: listed as stricter in Go; TypeScript gave %v, Go %q %v", header, c.Token, got, ok)
			}
			stricter++
			continue
		}
		switch {
		case c.Token == nil && ok:
			t.Errorf("%q: got %q, want none", header, got)
		case c.Token != nil && (!ok || got != *c.Token):
			t.Errorf("%q: got %q %v, want %q", header, got, ok, *c.Token)
		}
	}
	if stricter != len(bearerStricter) {
		t.Errorf("%d of %d stricter headers are in the vectors", stricter, len(bearerStricter))
	}
	// "Bearer" followed only by spaces: TypeScript yields an empty token,
	// which then fails verification; Go reports no token.
	if got, ok := auth.BearerToken("Bearer   "); ok {
		t.Errorf("only spaces: got %q", got)
	}
}

func TestCookieMaxAge(t *testing.T) {
	t.Parallel()
	g := golden.LoadAuth(t)
	for _, c := range g.CookieMaxAge {
		if got := auth.SecondsBetween(time.UnixMilli(c.FromMs), time.UnixMilli(c.ToMs)); got != c.Seconds {
			t.Errorf("SecondsBetween(%d, %d) = %d, want %d", c.FromMs, c.ToMs, got, c.Seconds)
		}
	}
	// Never negative, however far in the past the end is.
	start := time.UnixMilli(1_800_000_000_000)
	for _, back := range []time.Duration{time.Nanosecond, 5 * time.Second, 48 * time.Hour} {
		if got := auth.SecondsBetween(start, start.Add(-back)); got != 0 {
			t.Errorf("SecondsBetween to %s earlier = %d, want 0", back, got)
		}
	}
}

func TestPasswordsHashedByTheOldServerStillVerify(t *testing.T) {
	t.Parallel()
	g := golden.LoadAuth(t)
	long := 0
	for i, c := range g.Bcrypt {
		if !auth.NeedsRehash(c.Hash) {
			t.Errorf("a cost-10 hash does not ask for a re-hash")
		}
		for j, m := range c.Matches {
			if len(m.Candidate) > auth.MaxPasswordBytes && m.OK {
				long++
			}
			// Each comparison is slow on purpose (bcrypt): run them side by side.
			t.Run(fmt.Sprintf("hash %d candidate %d", i, j), func(t *testing.T) {
				t.Parallel()
				if got := auth.VerifyPassword(m.Candidate, c.Hash); got != m.OK {
					t.Errorf("password of %d bytes, candidate of %d bytes: got %v, want %v", c.Bytes, len(m.Candidate), got, m.OK)
				}
			})
		}
	}
	// The vectors include what makes long passwords special: a password
	// over 72 bytes that signs in, as it did on the old server.
	if long == 0 {
		t.Error("no vector signs in with a password over 72 bytes")
	}
}

func TestNewPasswords(t *testing.T) {
	t.Parallel()
	hash, err := auth.HashPassword("Tошкент2026!")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(hash, "$2a$12$") && !strings.HasPrefix(hash, "$2b$12$") {
		t.Errorf("hash %q is not bcrypt cost 12", hash[:7])
	}
	if !auth.VerifyPassword("Tошкент2026!", hash) || auth.VerifyPassword("Tошкент2026?", hash) || auth.NeedsRehash(hash) {
		t.Error("a new hash does not verify, verifies a wrong password, or asks for a re-hash")
	}
	// 72 bytes is the most bcrypt reads: accepted. One more is refused when a
	// password is set (never at sign-in). Bytes, not characters: "ў" is two.
	if _, err := auth.HashPassword(strings.Repeat("p", 72)); err != nil {
		t.Errorf("72 bytes refused: %v", err)
	}
	for _, long := range []string{strings.Repeat("p", 73), strings.Repeat("ў", 37)} {
		if _, err := auth.HashPassword(long); err != auth.ErrPasswordTooLong {
			t.Errorf("%d bytes: err %v, want ErrPasswordTooLong", len(long), err)
		}
	}
	for _, garbage := range []string{"", "not a hash", "$2b$12$short"} {
		if auth.VerifyPassword("x", garbage) {
			t.Errorf("verified against %q", garbage)
		}
		if !auth.NeedsRehash(garbage) {
			t.Errorf("%q does not ask for a re-hash", garbage)
		}
	}
}

// A mutated token is never accepted without a valid signature, and nothing
// panics.
func FuzzVerify(f *testing.F) {
	g := golden.LoadAuth(f)
	for _, c := range g.JWT.Verify {
		f.Add(c.Token)
	}
	for _, c := range g.JWT.Signed {
		f.Add(c.Token)
	}
	tokens := auth.NewTokens([]byte(g.JWTSecret))
	now := time.Unix(g.GeneratedAtSeconds, 0)
	f.Fuzz(func(t *testing.T, token string) {
		claims, ok := tokens.Verify(token, now)
		if !ok {
			if claims != (auth.Claims{}) {
				t.Fatalf("refused, but returned claims %+v", claims)
			}
			return
		}
		parts := strings.Split(token, ".")
		if len(parts) != 3 {
			t.Fatalf("accepted a token of %d parts", len(parts))
		}
		mac := hmac.New(sha256.New, []byte(g.JWTSecret))
		mac.Write([]byte(parts[0] + "." + parts[1]))
		if parts[2] != base64.RawURLEncoding.EncodeToString(mac.Sum(nil)) {
			t.Fatalf("accepted %q without our signature", token)
		}
		if claims.Sub == "" {
			t.Fatalf("accepted %q with an empty subject", token)
		}
	})
}

// Whatever the header, the parser does not panic, and a token it returns is
// part of the header.
func FuzzBearerToken(f *testing.F) {
	g := golden.LoadAuth(f)
	for _, c := range g.Bearer {
		if c.Header != nil {
			f.Add(*c.Header)
		}
	}
	f.Fuzz(func(t *testing.T, header string) {
		token, ok := auth.BearerToken(header)
		if !ok {
			if token != "" {
				t.Fatalf("no token, but returned %q", token)
			}
			return
		}
		if token == "" || !strings.HasSuffix(strings.TrimRight(header, " \t"), token) || len(header) < len("Bearer ")+len(token) {
			t.Fatalf("BearerToken(%q) = %q", header, token)
		}
	})
}
