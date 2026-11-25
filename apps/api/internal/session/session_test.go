package session_test

import (
	"encoding/base64"
	"strings"
	"testing"

	"lookly/internal/golden"
	"lookly/internal/session"
)

func TestClassifyMatchesTheTypeScriptClassifier(t *testing.T) {
	t.Parallel()
	g := golden.LoadAuth(t)
	if g.GraceWindowMs != session.GraceWindow.Milliseconds() {
		t.Fatalf("grace window: TypeScript %d ms, Go %d ms", g.GraceWindowMs, session.GraceWindow.Milliseconds())
	}
	kinds := map[session.Kind]int{}
	for i, c := range g.Classify {
		in := c.Input
		got := session.Classify(session.Refresh{
			At: in.T,
			Family: session.FamilyState{
				RevokedAt:         in.Family.RevokedAt,
				AbsoluteExpiresAt: in.Family.AbsoluteExpiresAt,
				ClientType:        in.Family.ClientType,
			},
			Session: session.SessionState{
				RevokedAt:       in.Session.RevokedAt,
				ReplacedByID:    in.Session.ReplacedByID,
				ExpiresAt:       in.Session.ExpiresAt,
				RotatedAt:       in.Session.RotatedAt,
				RotatedAtSource: in.Session.RotatedAtSource,
			},
			ClientType:      in.ClientType,
			LegacyCutoverAt: in.LegacyCutoverAt,
		})
		want := session.Decision{Kind: session.Kind(c.Decision.Kind), RevokeFamily: c.Decision.RevokeFamily}
		if got != want {
			t.Errorf("case %d: got %+v, want %+v\ninput %+v", i, got, want, in)
		}
		kinds[got.Kind]++
	}
	// The vectors reach every outcome; none is tested by accident only.
	for _, kind := range []session.Kind{
		session.Rotate, session.Grace, session.Race, session.Reuse,
		session.Expired, session.Revoked, session.ClientMismatch,
	} {
		if kinds[kind] == 0 {
			t.Errorf("no vector gives %q", kind)
		}
	}
	if len(kinds) != 7 {
		t.Errorf("outcomes %v: want exactly the seven known ones", kinds)
	}
}

func keysOf(t *testing.T, g golden.Auth) session.Keys {
	t.Helper()
	decode := func(s string) []byte {
		key, err := base64.StdEncoding.DecodeString(s)
		if err != nil || len(key) != 32 {
			t.Fatalf("golden session key: %v (%d bytes)", err, len(key))
		}
		return key
	}
	keys := session.Keys{Active: decode(g.SessionKeys.Active)}
	for _, k := range g.SessionKeys.DecryptOnly {
		keys.DecryptOnly = append(keys.DecryptOnly, decode(k))
	}
	return keys
}

func TestDecryptSuccessorMatchesTheTypeScriptDecoder(t *testing.T) {
	t.Parallel()
	g := golden.LoadAuth(t)
	keys := keysOf(t, g)
	for _, c := range g.Successor.Decrypt {
		got, ok := session.DecryptSuccessor(c.Value, c.AAD, keys)
		switch {
		case c.Plaintext == nil && ok:
			t.Errorf("%s: decrypted to %q, want refused", c.Name, got)
		case c.Plaintext != nil && (!ok || got != *c.Plaintext):
			t.Errorf("%s: got %q %v, want %q", c.Name, got, ok, *c.Plaintext)
		}
	}
}

func TestEncryptSuccessorProducesTheTypeScriptCiphertext(t *testing.T) {
	t.Parallel()
	g := golden.LoadAuth(t)
	keys := keysOf(t, g)
	for _, c := range g.Successor.Encrypted {
		if aad := session.SuccessorAAD(c.RotatedID, c.SuccessorID); aad != c.AAD {
			t.Errorf("SuccessorAAD(%q, %q) = %q, want %q", c.RotatedID, c.SuccessorID, aad, c.AAD)
		}
		// The same key, nonce and input give the same bytes.
		iv, err := base64.RawURLEncoding.DecodeString(strings.Split(c.Value, ".")[2])
		if err != nil {
			t.Fatal(err)
		}
		if got := session.EncryptSuccessorWithNonce(c.Token, c.AAD, keys, iv); got != c.Value {
			t.Errorf("%q:\n got %s\nwant %s", c.Token, got, c.Value)
		}
		if got, ok := session.DecryptSuccessor(c.Value, c.AAD, keys); !ok || got != c.Token {
			t.Errorf("decrypt(%q) = %q, %v", c.Token, got, ok)
		}
	}
}

func TestEncryptSuccessor(t *testing.T) {
	t.Parallel()
	g := golden.LoadAuth(t)
	keys := keysOf(t, g)
	aad := session.SuccessorAAD("rotated", "successor")
	first := session.EncryptSuccessor("refresh-token", aad, keys)
	second := session.EncryptSuccessor("refresh-token", aad, keys)
	if first == second {
		t.Fatal("two encryptions of one token are equal: the nonce is not random")
	}
	if strings.Contains(first, "refresh-token") || !strings.HasPrefix(first, "v1.") {
		t.Fatalf("ciphertext %q", first)
	}
	if got, ok := session.DecryptSuccessor(first, aad, keys); !ok || got != "refresh-token" {
		t.Errorf("round trip: %q, %v", got, ok)
	}
	// Bound to its two rows: the same value on other rows does not decrypt.
	if _, ok := session.DecryptSuccessor(first, session.SuccessorAAD("rotated", "another"), keys); ok {
		t.Error("decrypted with another successor id")
	}
	// A decrypt-only key decrypts but never encrypts: after the keys swap
	// roles, the old ciphertext is still readable and new ones use the new key.
	swapped := session.Keys{Active: keys.DecryptOnly[0], DecryptOnly: [][]byte{keys.Active}}
	if got, ok := session.DecryptSuccessor(first, aad, swapped); !ok || got != "refresh-token" {
		t.Errorf("after key rotation: %q, %v", got, ok)
	}
	if id := strings.Split(session.EncryptSuccessor("x", aad, swapped), ".")[1]; id == strings.Split(first, ".")[1] {
		t.Error("the swapped keys encrypt with the old key")
	}
	// A nonce or tag of another length is refused, not passed to the cipher
	// (which panics on a wrong nonce length).
	parts := strings.Split(first, ".")
	for _, forged := range []string{
		strings.Join([]string{parts[0], parts[1], parts[2][:8], parts[3], parts[4]}, "."),
		strings.Join([]string{parts[0], parts[1], parts[2] + "AAAA", parts[3], parts[4]}, "."),
		strings.Join([]string{parts[0], parts[1], "", parts[3], parts[4]}, "."),
		strings.Join([]string{parts[0], parts[1], parts[2], parts[3], ""}, "."),
		strings.Join([]string{parts[0], parts[1], parts[2], "", parts[4]}, "."),
	} {
		if got, ok := session.DecryptSuccessor(forged, aad, keys); ok {
			t.Errorf("decrypted %q to %q", forged, got)
		}
	}
	// Without the key, nothing.
	if _, ok := session.DecryptSuccessor(first, aad, session.Keys{Active: keys.DecryptOnly[0]}); ok {
		t.Error("decrypted without the key")
	}
}

// A mutated ciphertext never decrypts and never panics.
func FuzzDecryptSuccessor(f *testing.F) {
	g := golden.LoadAuth(f)
	keys := session.Keys{}
	for i, s := range append([]string{g.SessionKeys.Active}, g.SessionKeys.DecryptOnly...) {
		key, err := base64.StdEncoding.DecodeString(s)
		if err != nil {
			f.Fatal(err)
		}
		if i == 0 {
			keys.Active = key
		} else {
			keys.DecryptOnly = append(keys.DecryptOnly, key)
		}
	}
	valid := map[string]string{}
	for _, c := range g.Successor.Decrypt {
		f.Add(c.Value, c.AAD)
		if c.Plaintext != nil {
			valid[c.Value+"\x00"+c.AAD] = *c.Plaintext
		}
	}
	f.Fuzz(func(t *testing.T, value, aad string) {
		got, ok := session.DecryptSuccessor(value, aad, keys)
		if !ok {
			return
		}
		// Accepted: then it is one of the recorded pairs, or the same
		// ciphertext under another key id (the id only orders the keys).
		parts := strings.Split(value, ".")
		for known, plaintext := range valid {
			v, a, _ := strings.Cut(known, "\x00")
			kp := strings.Split(v, ".")
			if a == aad && got == plaintext && len(parts) == 5 && parts[0] == kp[0] && parts[2] == kp[2] && parts[3] == kp[3] && parts[4] == kp[4] {
				return
			}
		}
		t.Fatalf("accepted a forged ciphertext %q (aad %q) as %q", value, aad, got)
	})
}
