// Package golden loads the golden vectors under testdata/golden: inputs and
// outputs recorded from the TypeScript backend, which the Go code must
// reproduce (.claude/skills/lookly-testing/references/parity.md). A mismatch
// is investigated, never regenerated away. Only test files import it.
package golden

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

// Auth is testdata/golden/auth.json (apps/web/scripts/golden-auth.ts).
type Auth struct {
	GeneratedBy        string `json:"generatedBy"`
	Note               string `json:"note"`
	SourceCommit       string `json:"sourceCommit"`
	GeneratedAtSeconds int64  `json:"generatedAtSeconds"`
	Issuer             string `json:"issuer"`
	JWTSecret          string `json:"jwtSecret"`
	SessionKeys        struct {
		Active      string   `json:"active"`
		DecryptOnly []string `json:"decryptOnly"`
	} `json:"sessionKeys"`
	GraceWindowMs int64 `json:"graceWindowMs"`
	TokenHashes   []struct {
		Token  string `json:"token"`
		SHA256 string `json:"sha256"`
	} `json:"tokenHashes"`
	Bearer []struct {
		Header *string `json:"header"`
		Token  *string `json:"token"`
	} `json:"bearer"`
	JWT struct {
		Signed []struct {
			Payload     JWTPayload `json:"payload"`
			ExpiresAtMs int64      `json:"expiresAtMs"`
			Iat         int64      `json:"iat"`
			Exp         int64      `json:"exp"`
			Token       string     `json:"token"`
		} `json:"signed"`
		Verify []struct {
			Name    string      `json:"name"`
			Token   string      `json:"token"`
			Payload *JWTPayload `json:"payload"`
		} `json:"verify"`
	} `json:"jwt"`
	Successor struct {
		Encrypted []struct {
			Token       string `json:"token"`
			RotatedID   string `json:"rotatedId"`
			SuccessorID string `json:"successorId"`
			AAD         string `json:"aad"`
			Value       string `json:"value"`
		} `json:"encrypted"`
		Decrypt []struct {
			Name      string  `json:"name"`
			Value     string  `json:"value"`
			AAD       string  `json:"aad"`
			Plaintext *string `json:"plaintext"`
		} `json:"decrypt"`
	} `json:"successor"`
	Classify []struct {
		Input struct {
			T      time.Time `json:"t"`
			Family struct {
				RevokedAt         *time.Time `json:"revokedAt"`
				AbsoluteExpiresAt time.Time  `json:"absoluteExpiresAt"`
				ClientType        string     `json:"clientType"`
			} `json:"family"`
			Session struct {
				RevokedAt       *time.Time `json:"revokedAt"`
				ReplacedByID    *string    `json:"replacedById"`
				ExpiresAt       time.Time  `json:"expiresAt"`
				RotatedAt       *time.Time `json:"rotatedAt"`
				RotatedAtSource *string    `json:"rotatedAtSource"`
			} `json:"session"`
			ClientType      string     `json:"clientType"`
			LegacyCutoverAt *time.Time `json:"legacyCutoverAt"`
		} `json:"input"`
		Decision struct {
			Kind         string `json:"kind"`
			RevokeFamily bool   `json:"revokeFamily"`
		} `json:"decision"`
	} `json:"classify"`
	CookieMaxAge []struct {
		FromMs  int64 `json:"fromMs"`
		ToMs    int64 `json:"toMs"`
		Seconds int   `json:"seconds"`
	} `json:"cookieMaxAge"`
	Bcrypt []struct {
		Password string `json:"password"`
		Bytes    int    `json:"bytes"`
		Hash     string `json:"hash"`
		Matches  []struct {
			Candidate string `json:"candidate"`
			OK        bool   `json:"ok"`
		} `json:"matches"`
	} `json:"bcrypt"`
}

// JWTPayload is what the TypeScript verifier returns for a token.
type JWTPayload struct {
	Sub   string `json:"sub"`
	Email string `json:"email"`
	SID   string `json:"sid"`
}

// LoadAuth reads testdata/golden/auth.json; unknown fields fail, so the Go
// struct cannot silently ignore a section of the vectors.
func LoadAuth(t testing.TB) Auth {
	t.Helper()
	_, file, _, _ := runtime.Caller(0)
	f, err := os.Open(filepath.Join(filepath.Dir(file), "../../testdata/golden/auth.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	dec := json.NewDecoder(f)
	dec.DisallowUnknownFields()
	var a Auth
	if err := dec.Decode(&a); err != nil {
		t.Fatalf("auth.json: %v", err)
	}
	if len(a.JWT.Verify) == 0 || len(a.Classify) == 0 || len(a.Bcrypt) == 0 || len(a.Successor.Decrypt) == 0 {
		t.Fatal("auth.json: a section is empty")
	}
	return a
}
