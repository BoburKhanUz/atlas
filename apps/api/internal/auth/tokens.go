// Package auth holds the pure building blocks of authentication: access
// tokens (JWT), refresh tokens and their hashes, the Authorization header,
// cookie lifetimes and password hashing. No I/O.
//
// Everything stored or signed here is byte-compatible with the Next.js API,
// so each implementation accepts the other's sessions until the cutover
// (docs/plan/B2.md). testdata/golden/auth.json, recorded from the TypeScript
// code, pins this.
package auth

import (
	"bytes"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

// Issuer is the "iss" claim of every access token. It is the name the
// Next.js API has always used; changing it would sign everybody out.
const Issuer = "ai-fashion-stylist"

// Claims is what an access token says about its bearer.
type Claims struct {
	Sub   string // user id
	Email string
	SID   string // session id; empty on tokens issued before sessions carried one
}

// Tokens signs and verifies access tokens (JWT, HS256) with one secret.
type Tokens struct{ secret []byte }

// NewTokens returns a signer for the secret (JWT_SECRET).
func NewTokens(secret []byte) Tokens { return Tokens{secret: bytes.Clone(secret)} }

// The protected header the TypeScript signer (jose) produces.
var joseHeader = b64.EncodeToString([]byte(`{"alg":"HS256"}`))

// JWT parts are base64url without padding (RFC 7515); Strict also refuses
// encodings with stray trailing bits, so a token has exactly one spelling.
var b64 = base64.RawURLEncoding.Strict()

// Sign returns an access token valid until expiresAt (floored to whole
// seconds, as the session protocol computes it from the database clock).
// The bytes equal what the TypeScript signer produces for the same input.
func (t Tokens) Sign(c Claims, issuedAt, expiresAt time.Time) string {
	payload := make([]byte, 0, 160)
	payload = appendJSONString(append(payload, `{"sub":`...), c.Sub)
	payload = appendJSONString(append(payload, `,"email":`...), c.Email)
	if c.SID != "" {
		payload = appendJSONString(append(payload, `,"sid":`...), c.SID)
	}
	payload = strconv.AppendInt(append(payload, `,"iat":`...), issuedAt.Unix(), 10)
	payload = appendJSONString(append(payload, `,"iss":`...), Issuer)
	payload = strconv.AppendInt(append(payload, `,"exp":`...), floorSeconds(expiresAt), 10)
	payload = append(payload, '}')

	signed := joseHeader + "." + b64.EncodeToString(payload)
	return signed + "." + b64.EncodeToString(t.mac(signed))
}

func (t Tokens) mac(signed string) []byte {
	h := hmac.New(sha256.New, t.secret)
	h.Write([]byte(signed))
	return h.Sum(nil)
}

// Verify returns the claims of a token that is intact, signed with the
// secret by HS256, issued by Issuer and not expired at now. It accepts what
// the TypeScript verifier (jose) accepts, except that it also refuses a
// token without an expiry, an empty subject, and any part that is not strict
// unpadded base64url; our signers produce none of these.
func (t Tokens) Verify(token string, now time.Time) (Claims, bool) {
	head, rest, ok := strings.Cut(token, ".")
	if !ok {
		return Claims{}, false
	}
	// A fourth part stays in sig and fails to decode: "." is not base64url.
	body, sig, ok := strings.Cut(rest, ".")
	if !ok {
		return Claims{}, false
	}

	// The header: only HS256. "none", another algorithm or a critical
	// extension is refused before the signature is looked at.
	header, ok := decodeObject(head)
	if !ok {
		return Claims{}, false
	}
	if alg, ok := jsonString(header["alg"]); !ok || alg != "HS256" {
		return Claims{}, false
	}
	if _, has := header["crit"]; has {
		return Claims{}, false
	}

	got, err := b64.DecodeString(sig)
	if err != nil || !hmac.Equal(got, t.mac(token[:len(head)+1+len(body)])) {
		return Claims{}, false
	}

	claims, ok := decodeObject(body)
	if !ok {
		return Claims{}, false
	}
	if iss, ok := jsonString(claims["iss"]); !ok || iss != Issuer {
		return Claims{}, false
	}
	// Whole seconds, as jose compares: expired from the expiry second on.
	seconds := float64(now.Unix())
	exp, ok := jsonNumber(claims["exp"])
	if !ok || exp <= seconds {
		return Claims{}, false
	}
	// Present time claims must be numbers; a token is not valid before "nbf".
	for _, name := range [...]string{"iat", "nbf"} {
		raw, has := claims[name]
		if !has {
			continue
		}
		at, ok := jsonNumber(raw)
		if !ok || (name == "nbf" && at > seconds) {
			return Claims{}, false
		}
	}

	var c Claims
	if c.Sub, ok = jsonString(claims["sub"]); !ok || c.Sub == "" {
		return Claims{}, false
	}
	if c.Email, ok = jsonString(claims["email"]); !ok {
		return Claims{}, false
	}
	c.SID, _ = jsonString(claims["sid"]) // anything but a string: no session id
	return c, true
}

// decodeObject reads one base64url part as a JSON object. Member names are
// matched exactly ("Sub" is not "sub"); of a repeated name the last counts,
// as in JavaScript.
func decodeObject(part string) (map[string]json.RawMessage, bool) {
	raw, err := b64.DecodeString(part)
	if err != nil {
		return nil, false
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(raw, &object); err != nil || object == nil {
		return nil, false
	}
	return object, true
}

// jsonString reports the value of a JSON string; null, numbers and the rest
// are not strings.
func jsonString(raw json.RawMessage) (string, bool) {
	if len(raw) == 0 || raw[0] != '"' {
		return "", false
	}
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		return "", false
	}
	return s, true
}

// jsonNumber reports the value of a JSON number; a quoted number is a
// string, not a number.
func jsonNumber(raw json.RawMessage) (float64, bool) {
	if len(raw) == 0 || raw[0] == '"' || raw[0] == 'n' {
		return 0, false
	}
	var n float64
	if err := json.Unmarshal(raw, &n); err != nil {
		return 0, false
	}
	return n, true
}

// appendJSONString encodes s as JavaScript's JSON.stringify does: only the
// quote, the backslash and control characters are escaped (encoding/json
// also escapes <, >, & and U+2028/9). Invalid UTF-8 becomes U+FFFD.
func appendJSONString(dst []byte, s string) []byte {
	const hexDigits = "0123456789abcdef"
	dst = append(dst, '"')
	for _, r := range s {
		switch {
		case r == '"' || r == '\\':
			dst = append(dst, '\\', byte(r))
		case r == '\b':
			dst = append(dst, '\\', 'b')
		case r == '\f':
			dst = append(dst, '\\', 'f')
		case r == '\n':
			dst = append(dst, '\\', 'n')
		case r == '\r':
			dst = append(dst, '\\', 'r')
		case r == '\t':
			dst = append(dst, '\\', 't')
		case r < 0x20:
			dst = append(dst, '\\', 'u', '0', '0', hexDigits[r>>4], hexDigits[r&0xf])
		default:
			dst = utf8.AppendRune(dst, r)
		}
	}
	return append(dst, '"')
}

func floorSeconds(t time.Time) int64 {
	return t.Unix() // Unix() already floors, also before 1970
}

// NewRefreshToken returns an opaque refresh token: 32 random bytes as
// unpadded base64url. Only its hash is stored.
func NewRefreshToken() string {
	var b [32]byte
	rand.Read(b[:]) // never fails (crypto/rand aborts the program instead)
	return base64.RawURLEncoding.EncodeToString(b[:])
}

// HashToken is the SHA-256 hex digest the Session table stores in place of
// a refresh token.
func HashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// BearerToken returns the token of an "Authorization: Bearer <token>"
// header. The scheme is matched without regard to case; spaces and tabs
// separate it from the token.
func BearerToken(header string) (string, bool) {
	const scheme = "bearer"
	if len(header) <= len(scheme) || !strings.EqualFold(header[:len(scheme)], scheme) {
		return "", false
	}
	rest := header[len(scheme):]
	if rest[0] != ' ' && rest[0] != '\t' {
		return "", false
	}
	token := strings.Trim(rest, " \t")
	return token, token != ""
}

// SecondsBetween is a cookie's Max-Age for a lifetime from one database
// time to another: whole seconds, rounded up, never negative.
func SecondsBetween(from, to time.Time) int {
	d := to.Sub(from)
	if d <= 0 {
		return 0
	}
	return int((d + time.Second - 1) / time.Second)
}
