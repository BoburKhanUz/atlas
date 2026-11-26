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
	var a Auth
	load(t, "auth.json", &a)
	if len(a.JWT.Verify) == 0 || len(a.Classify) == 0 || len(a.Bcrypt) == 0 || len(a.Successor.Decrypt) == 0 {
		t.Fatal("auth.json: a section is empty")
	}
	return a
}

// AuthHTTP is testdata/golden/auth-http.json
// (apps/web/scripts/golden-auth-http.ts): what the Next.js API decides about
// requests. Headers are [name, value] pairs in the order sent.
type AuthHTTP struct {
	GeneratedBy        string `json:"generatedBy"`
	SourceCommit       string `json:"sourceCommit"`
	Note               string `json:"note"`
	GeneratedAtSeconds int64  `json:"generatedAtSeconds"`
	JWTSecret          string `json:"jwtSecret"`
	CSRF               []struct {
		Name        string      `json:"name"`
		Method      string      `json:"method"`
		Headers     [][2]string `json:"headers"`
		TrustProxy  bool        `json:"trustProxy"`
		CrossOrigin bool        `json:"crossOrigin"`
	} `json:"csrf"`
	ClientType []struct {
		Value      *string `json:"value"`
		ClientType string  `json:"clientType"`
	} `json:"clientType"`
	ClientTypeTwice string `json:"clientTypeTwice"`
	ClientIP        []struct {
		Name       string      `json:"name"`
		Headers    [][2]string `json:"headers"`
		TrustProxy bool        `json:"trustProxy"`
		IP         *string     `json:"ip"`
	} `json:"clientIp"`
	Auth []struct {
		Name    string      `json:"name"`
		Headers [][2]string `json:"headers"`
		Via     *string     `json:"via"`
		User    *JWTPayload `json:"user"`
	} `json:"auth"`
}

// LoadAuthHTTP reads testdata/golden/auth-http.json; unknown fields fail.
func LoadAuthHTTP(t testing.TB) AuthHTTP {
	t.Helper()
	var a AuthHTTP
	load(t, "auth-http.json", &a)
	if len(a.CSRF) == 0 || len(a.ClientType) == 0 || len(a.ClientIP) == 0 || len(a.Auth) == 0 {
		t.Fatal("auth-http.json: a section is empty")
	}
	return a
}

func load(t testing.TB, name string, into any) {
	t.Helper()
	_, file, _, _ := runtime.Caller(0)
	f, err := os.Open(filepath.Join(filepath.Dir(file), "../../testdata/golden", name))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	dec := json.NewDecoder(f)
	dec.DisallowUnknownFields()
	if err := dec.Decode(into); err != nil {
		t.Fatalf("%s: %v", name, err)
	}
}

// AuthValidation is testdata/golden/auth-validation.json
// (apps/web/scripts/golden-auth-validation.ts): what the Next.js API answers
// to request bodies of the auth operations.
type AuthValidation struct {
	GeneratedBy  string           `json:"generatedBy"`
	SourceCommit string           `json:"sourceCommit"`
	Note         string           `json:"note"`
	LegalVersion string           `json:"legalVersion"`
	Login        []ValidationCase `json:"login"`
	Register     []ValidationCase `json:"register"`
	Refresh      []ValidationCase `json:"refresh"`
	Logout       []ValidationCase `json:"logout"`
}

// ValidationCase is one request body and its outcome: the parsed value, or
// the error envelope.
type ValidationCase struct {
	Name    string          `json:"name"`
	Body    string          `json:"body"`
	OK      bool            `json:"ok"`
	Value   json.RawMessage `json:"value"`
	Status  int             `json:"status"`
	Code    string          `json:"code"`
	Error   string          `json:"error"`
	Details []struct {
		Path    string `json:"path"`
		Message string `json:"message"`
	} `json:"details"`
}

// LoadAuthValidation reads testdata/golden/auth-validation.json; unknown
// fields fail.
func LoadAuthValidation(t testing.TB) AuthValidation {
	t.Helper()
	var a AuthValidation
	load(t, "auth-validation.json", &a)
	if len(a.Login) == 0 || len(a.Register) == 0 || len(a.Refresh) == 0 || len(a.Logout) == 0 {
		t.Fatal("auth-validation.json: a section is empty")
	}
	return a
}

// AccountValidation is testdata/golden/account-validation.json
// (apps/web/scripts/golden-account-validation.ts): what the Next.js API
// answers to request bodies of the account operations, and the catalog
// values its profile schema accepts.
type AccountValidation struct {
	GeneratedBy  string           `json:"generatedBy"`
	SourceCommit string           `json:"sourceCommit"`
	Note         string           `json:"note"`
	LegalVersion string           `json:"legalVersion"`
	Styles       []string         `json:"styles"`
	Colors       []string         `json:"colors"`
	Fits         []string         `json:"fits"`
	Forgot       []ValidationCase `json:"forgot"`
	Reset        []ValidationCase `json:"reset"`
	Consent      []ValidationCase `json:"consent"`
	Profile      []ValidationCase `json:"profile"`
}

// LoadAccountValidation reads testdata/golden/account-validation.json;
// unknown fields fail.
func LoadAccountValidation(t testing.TB) AccountValidation {
	t.Helper()
	var a AccountValidation
	load(t, "account-validation.json", &a)
	if len(a.Forgot) == 0 || len(a.Reset) == 0 || len(a.Consent) == 0 || len(a.Profile) == 0 ||
		len(a.Styles) == 0 || len(a.Colors) == 0 || len(a.Fits) == 0 {
		t.Fatal("account-validation.json: a section is empty")
	}
	return a
}

// PasswordReset is testdata/golden/password-reset.json
// (apps/web/scripts/golden-password-reset.ts): the reset links and e-mails
// the Next.js server makes.
type PasswordReset struct {
	GeneratedBy  string `json:"generatedBy"`
	SourceCommit string `json:"sourceCommit"`
	Note         string `json:"note"`
	TTLMinutes   int    `json:"ttlMinutes"`
	Links        []struct {
		PublicBaseURL *string `json:"publicBaseUrl"`
		Token         string  `json:"token"`
		Link          string  `json:"link"`
	} `json:"links"`
	Messages []struct {
		To      string `json:"to"`
		Link    string `json:"link"`
		Subject string `json:"subject"`
		Text    string `json:"text"`
		HTML    string `json:"html"`
	} `json:"messages"`
}

// LoadPasswordReset reads testdata/golden/password-reset.json; unknown
// fields fail.
func LoadPasswordReset(t testing.TB) PasswordReset {
	t.Helper()
	var p PasswordReset
	load(t, "password-reset.json", &p)
	if len(p.Links) == 0 || len(p.Messages) == 0 || p.TTLMinutes == 0 {
		t.Fatal("password-reset.json: a section is empty")
	}
	return p
}

// WardrobeValidation is testdata/golden/wardrobe-validation.json
// (apps/web/scripts/golden-wardrobe-validation.ts): what the Next.js API
// answers to the wardrobe's request bodies, list queries, item ids and
// Idempotency-Key headers.
type WardrobeValidation struct {
	GeneratedBy  string           `json:"generatedBy"`
	SourceCommit string           `json:"sourceCommit"`
	Note         string           `json:"note"`
	Patch        []ValidationCase `json:"patch"`
	Query        []struct {
		Name  string            `json:"name"`
		Query map[string]string `json:"query"`
		Outcome
	} `json:"query"`
	ID []struct {
		ID string `json:"id"`
		Outcome
	} `json:"id"`
	IdempotencyKey []struct {
		Key *string `json:"key"`
		Outcome
	} `json:"idempotencyKey"`
}

// Outcome is a parsed value, or the error envelope.
type Outcome struct {
	OK      bool            `json:"ok"`
	Value   json.RawMessage `json:"value"`
	Status  int             `json:"status"`
	Code    string          `json:"code"`
	Error   string          `json:"error"`
	Details []struct {
		Path    string `json:"path"`
		Message string `json:"message"`
	} `json:"details"`
}

// LoadWardrobeValidation reads testdata/golden/wardrobe-validation.json;
// unknown fields fail.
func LoadWardrobeValidation(t testing.TB) WardrobeValidation {
	t.Helper()
	var w WardrobeValidation
	load(t, "wardrobe-validation.json", &w)
	if len(w.Patch) == 0 || len(w.Query) == 0 || len(w.ID) == 0 || len(w.IdempotencyKey) == 0 {
		t.Fatal("wardrobe-validation.json: a section is empty")
	}
	return w
}
