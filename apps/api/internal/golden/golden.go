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

// Images is testdata/golden/images.json (apps/web/scripts/golden-images.ts):
// how the Next.js server's image processing answers each fixture in
// testdata/images, and large images described by their size.
type Images struct {
	GeneratedBy  string         `json:"generatedBy"`
	SourceCommit string         `json:"sourceCommit"`
	Note         string         `json:"note"`
	Fixtures     []ImageOutcome `json:"fixtures"`
	Large        []struct {
		Width     int            `json:"width"`
		Height    int            `json:"height"`
		Outcome   string         `json:"outcome"`
		Display   *ImageMetadata `json:"display"`
		Thumbnail *ImageMetadata `json:"thumbnail"`
	} `json:"large"`
}

// ImageOutcome is one fixture's outcome: "ok" with what was stored, or the
// refusal's code.
type ImageOutcome struct {
	File      string         `json:"file"`
	About     string         `json:"about"`
	Outcome   string         `json:"outcome"`
	Width     int            `json:"width"`
	Height    int            `json:"height"`
	MimeType  string         `json:"mimeType"`
	Master    *ImageMetadata `json:"master"`
	Display   *ImageMetadata `json:"display"`
	Thumbnail *ImageMetadata `json:"thumbnail"`
	RedCorner string         `json:"redCorner"`
}

// ImageMetadata describes a stored variant.
type ImageMetadata struct {
	Ext    string `json:"ext"`
	Format string `json:"format"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
	EXIF   bool   `json:"exif"`
	ICC    bool   `json:"icc"`
	XMP    bool   `json:"xmp"`
}

// LoadImages reads testdata/golden/images.json; unknown fields fail.
func LoadImages(t testing.TB) Images {
	t.Helper()
	var i Images
	load(t, "images.json", &i)
	if len(i.Fixtures) == 0 || len(i.Large) == 0 {
		t.Fatal("images.json: a section is empty")
	}
	return i
}

// Media is testdata/golden/media.json (apps/web/scripts/golden-media.ts):
// signed media links, their verification, and which storage keys the
// Next.js server accepts.
type Media struct {
	GeneratedBy  string `json:"generatedBy"`
	SourceCommit string `json:"sourceCommit"`
	Note         string `json:"note"`
	Secret       string `json:"secret"`
	Signed       []struct {
		PublicBaseURL *string `json:"publicBaseUrl"`
		TTLSeconds    *string `json:"ttlSeconds"`
		Now           int64   `json:"now"`
		Key           string  `json:"key"`
		URL           string  `json:"url"`
		ExpiresAt     string  `json:"expiresAt"`
	} `json:"signed"`
	Verified []struct {
		Name  string  `json:"name"`
		Key   string  `json:"key"`
		Exp   *string `json:"exp"`
		Sig   *string `json:"sig"`
		Now   int64   `json:"now"`
		Valid bool    `json:"valid"`
	} `json:"verified"`
	Keys []struct {
		Key   string `json:"key"`
		Valid bool   `json:"valid"`
	} `json:"keys"`
}

// LoadMedia reads testdata/golden/media.json; unknown fields fail.
func LoadMedia(t testing.TB) Media {
	t.Helper()
	var m Media
	load(t, "media.json", &m)
	if len(m.Signed) == 0 || len(m.Verified) == 0 || len(m.Keys) == 0 {
		t.Fatal("media.json: a section is empty")
	}
	return m
}

// WardrobeRow is a stored wardrobe item as the golden cases give it: the
// correctable columns always, the rest for the serialized cases.
type WardrobeRow struct {
	ID                     string             `json:"id"`
	UserID                 string             `json:"userId"`
	Category               string             `json:"category"`
	Subcategory            *string            `json:"subcategory"`
	Colors                 string             `json:"colors"`
	Pattern                *string            `json:"pattern"`
	Material               *string            `json:"material"`
	SleeveLength           *string            `json:"sleeveLength"`
	Fit                    *string            `json:"fit"`
	Style                  *string            `json:"style"`
	Season                 string             `json:"season"`
	Gender                 *string            `json:"gender"`
	Formality              *string            `json:"formality"`
	Confidences            string             `json:"confidences"`
	WasCorrected           bool               `json:"wasCorrected"`
	CorrectionLog          string             `json:"correctionLog"`
	AnalysisProvider       *string            `json:"analysisProvider"`
	AnalysisModel          *string            `json:"analysisModel"`
	AnalysisVersion        *string            `json:"analysisVersion"`
	AnalyzedAt             *string            `json:"analyzedAt"`
	AnalysisRawConfidences *string            `json:"analysisRawConfidences"`
	CreatedAt              string             `json:"createdAt"`
	UpdatedAt              string             `json:"updatedAt"`
	Images                 []WardrobeImageRow `json:"images"`
}

// WardrobeImageRow is a stored image row.
type WardrobeImageRow struct {
	ID             string  `json:"id"`
	WardrobeItemID string  `json:"wardrobeItemId"`
	StorageKey     string  `json:"storageKey"`
	ThumbnailKey   *string `json:"thumbnailKey"`
	DisplayKey     *string `json:"displayKey"`
	IsPrimary      bool    `json:"isPrimary"`
	Width          *int32  `json:"width"`
	Height         *int32  `json:"height"`
	MimeType       *string `json:"mimeType"`
	Bytes          *int32  `json:"bytes"`
	Sha256         *string `json:"sha256"`
	CreatedAt      string  `json:"createdAt"`
}

// Wardrobe is testdata/golden/wardrobe.json: what the Next.js correction
// rules and item serializer make of stored rows
// (apps/web/scripts/golden-wardrobe.ts).
type Wardrobe struct {
	Source        string `json:"source"`
	Now           int64  `json:"now"` // the clock of the serialized cases, in milliseconds
	SigningSecret string `json:"signingSecret"`
	At            string `json:"at"` // the time the correction cases were logged with
	// ExistingLog is the correction log every correction case starts with.
	ExistingLog string `json:"existingLog"`
	Corrections []struct {
		Name        string          `json:"name"`
		Current     WardrobeRow     `json:"current"`
		Body        json.RawMessage `json:"body"`
		Mismatch    bool            `json:"mismatch"`
		Corrections []struct {
			Field string `json:"field"`
			From  string `json:"from"`
			To    string `json:"to"`
			At    string `json:"at"`
		} `json:"corrections"`
		// Update is the columns the Next.js route wrote (lists as JSON text).
		Update map[string]*string `json:"update"`
		// StoredLog is the log the route stored; nil when nothing changed.
		StoredLog *string `json:"storedLog"`
	} `json:"corrections"`
	Serialized []struct {
		Name          string      `json:"name"`
		PublicBaseURL *string     `json:"publicBaseUrl"`
		TTLSeconds    int         `json:"ttlSeconds"`
		Row           WardrobeRow `json:"row"`
		JSON          string      `json:"json"`
	} `json:"serialized"`
}

// LoadWardrobe reads testdata/golden/wardrobe.json; unknown fields fail.
func LoadWardrobe(t testing.TB) Wardrobe {
	t.Helper()
	var w Wardrobe
	load(t, "wardrobe.json", &w)
	if len(w.Corrections) == 0 || len(w.Serialized) == 0 {
		t.Fatal("wardrobe.json: a section is empty")
	}
	return w
}

// VisionDetection is a detection as the Next.js mock returns it.
type VisionDetection struct {
	Category     string             `json:"category"`
	Subcategory  *string            `json:"subcategory"`
	Colors       []string           `json:"colors"`
	Pattern      *string            `json:"pattern"`
	Material     *string            `json:"material"`
	SleeveLength *string            `json:"sleeveLength"`
	Fit          *string            `json:"fit"`
	Style        *string            `json:"style"`
	Season       []string           `json:"season"`
	Gender       *string            `json:"gender"`
	Formality    *string            `json:"formality"`
	Confidence   map[string]float64 `json:"confidence"`
	Mock         bool               `json:"mock"`
}

// Vision is testdata/golden/vision.json: what the Next.js development mock
// of garment analysis makes of the pictures in testdata/vision/ and of file
// names (apps/web/scripts/golden-vision.ts).
type Vision struct {
	Source string `json:"source"`
	// HintPicture is the picture every file-name case was analysed with.
	HintPicture string `json:"hintPicture"`
	Detections  []struct {
		File      string          `json:"file"` // under testdata/
		About     string          `json:"about"`
		Filename  string          `json:"filename"`
		Detection VisionDetection `json:"detection"`
	} `json:"detections"`
	Hints []struct {
		Filename           string  `json:"filename"`
		Category           string  `json:"category"`
		Subcategory        *string `json:"subcategory"`
		CategoryConfidence float64 `json:"categoryConfidence"`
	} `json:"hints"`
}

// LoadVision reads testdata/golden/vision.json; unknown fields fail.
func LoadVision(t testing.TB) Vision {
	t.Helper()
	var v Vision
	load(t, "vision.json", &v)
	if len(v.Detections) == 0 || len(v.Hints) == 0 {
		t.Fatal("vision.json: a section is empty")
	}
	return v
}

// TestdataFile reads a file under testdata/.
func TestdataFile(t testing.TB, rel string) []byte {
	t.Helper()
	_, file, _, _ := runtime.Caller(0)
	b, err := os.ReadFile(filepath.Join(filepath.Dir(file), "../../testdata", filepath.FromSlash(rel)))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// Idempotency is testdata/golden/idempotency.json: request hashes by the
// Next.js multipartRequestHash (apps/web/scripts/golden-idempotency.ts).
type Idempotency struct {
	Source string `json:"source"`
	Cases  []struct {
		Name       string            `json:"name"`
		FileBase64 string            `json:"fileBase64"`
		Filename   string            `json:"filename"`
		Fields     map[string]string `json:"fields"`
		Hash       string            `json:"hash"`
	} `json:"cases"`
}

// LoadIdempotency reads testdata/golden/idempotency.json; unknown fields fail.
func LoadIdempotency(t testing.TB) Idempotency {
	t.Helper()
	var i Idempotency
	load(t, "idempotency.json", &i)
	if len(i.Cases) == 0 {
		t.Fatal("idempotency.json: no cases")
	}
	return i
}

// OutfitValidation is testdata/golden/outfit-validation.json
// (apps/web/scripts/golden-outfit-validation.ts): what the Next.js API
// answers to the bodies of the outfit routes, the outfit list's query and
// the weather's coordinates.
type OutfitValidation struct {
	GeneratedBy  string           `json:"generatedBy"`
	SourceCommit string           `json:"sourceCommit"`
	Note         string           `json:"note"`
	Generate     []ValidationCase `json:"generate"`
	Save         []ValidationCase `json:"save"`
	Patch        []ValidationCase `json:"patch"`
	Feedback     []ValidationCase `json:"feedback"`
	Saved        []struct {
		Saved *string `json:"saved"`
		Outcome
	} `json:"saved"`
	Coordinates []struct {
		Lat *string `json:"lat"`
		Lon *string `json:"lon"`
		Outcome
	} `json:"coordinates"`
}

// LoadOutfitValidation reads testdata/golden/outfit-validation.json;
// unknown fields fail.
func LoadOutfitValidation(t testing.TB) OutfitValidation {
	t.Helper()
	var o OutfitValidation
	load(t, "outfit-validation.json", &o)
	if len(o.Generate) == 0 || len(o.Save) == 0 || len(o.Patch) == 0 || len(o.Feedback) == 0 || len(o.Saved) == 0 || len(o.Coordinates) == 0 {
		t.Fatal("outfit-validation.json: a section is empty")
	}
	return o
}

// Weather is testdata/golden/weather.json (apps/web/scripts/golden-weather.ts):
// what the Next.js Open-Meteo provider makes of complete answers taken at
// local hour 00, the address it asks, and toFixed(2) on coordinates.
type Weather struct {
	GeneratedBy  string `json:"generatedBy"`
	SourceCommit string `json:"sourceCommit"`
	Note         string `json:"note"`
	Answers      []struct {
		Name    string          `json:"name"`
		Body    string          `json:"body"`
		Weather json.RawMessage `json:"weather"`
	} `json:"answers"`
	Fixed []struct {
		Value string `json:"value"`
		Fixed string `json:"fixed"`
	} `json:"fixed"`
	Addresses []struct {
		Lat       string `json:"lat"`
		Lon       string `json:"lon"`
		Origin    string `json:"origin"`
		Path      string `json:"path"`
		Latitude  string `json:"latitude"`
		Longitude string `json:"longitude"`
		Current   string `json:"current"`
		Hourly    string `json:"hourly"`
		Timezone  string `json:"timezone"`
	} `json:"addresses"`
}

// LoadWeather reads testdata/golden/weather.json; unknown fields fail.
func LoadWeather(t testing.TB) Weather {
	t.Helper()
	var w Weather
	load(t, "weather.json", &w)
	if len(w.Answers) == 0 || len(w.Fixed) == 0 || len(w.Addresses) == 0 {
		t.Fatal("weather.json: a section is empty")
	}
	return w
}

// AIConfig is testdata/golden/ai-config.json
// (apps/web/scripts/golden-ai-config.ts): what the Next.js AI configuration
// parser makes of an environment, or the variable its refusal names.
type AIConfig struct {
	GeneratedBy  string `json:"generatedBy"`
	SourceCommit string `json:"sourceCommit"`
	Note         string `json:"note"`
	Cases        []struct {
		Name     string            `json:"name"`
		Env      map[string]string `json:"env"`
		OK       bool              `json:"ok"`
		Config   json.RawMessage   `json:"config"`
		Error    string            `json:"error"`
		Variable string            `json:"variable"`
	} `json:"cases"`
}

// LoadAIConfig reads testdata/golden/ai-config.json; unknown fields fail.
func LoadAIConfig(t testing.TB) AIConfig {
	t.Helper()
	var c AIConfig
	load(t, "ai-config.json", &c)
	if len(c.Cases) == 0 {
		t.Fatal("ai-config.json: no cases")
	}
	return c
}

// AIOutcome is how a provider call ended in the Next.js adapters.
type AIOutcome struct {
	OK       bool            `json:"ok"`
	Text     string          `json:"text"`
	Output   json.RawMessage `json:"output"`
	Metadata *struct {
		Provider string `json:"provider"`
		Model    string `json:"model"`
		Usage    struct {
			InputTokens  *float64 `json:"inputTokens"`
			OutputTokens *float64 `json:"outputTokens"`
			TotalTokens  *float64 `json:"totalTokens"`
		} `json:"usage"`
	} `json:"metadata"`
	Kind         string   `json:"kind"`
	Status       *int     `json:"status"`
	RetryAfterMs *float64 `json:"retryAfterMs"`
	Message      string   `json:"message"`
	// Thrown: the adapter fell over with a JavaScript error of this name.
	Thrown string `json:"thrown"`
	// Attempts is set for the retry cases.
	Attempts int `json:"attempts"`
}

// AISent is the request an adapter sent ("<key>" for the key).
type AISent struct {
	URL     string            `json:"url"`
	Headers map[string]string `json:"headers"`
	Body    string            `json:"body"`
}

// AISchema is a structured-output schema of a request.
type AISchema struct {
	Name   string          `json:"name"`
	Schema json.RawMessage `json:"schema"`
}

// AIProviders is testdata/golden/ai-providers.json
// (apps/web/scripts/golden-ai-providers.ts).
type AIProviders struct {
	GeneratedBy  string `json:"generatedBy"`
	SourceCommit string `json:"sourceCommit"`
	Note         string `json:"note"`
	Text         []struct {
		Name     string `json:"name"`
		Provider string `json:"provider"`
		Model    string `json:"model"`
		Request  struct {
			Messages []struct {
				Role    string `json:"role"`
				Content string `json:"content"`
			} `json:"messages"`
			Temperature     *float64  `json:"temperature"`
			MaxOutputTokens *int      `json:"maxOutputTokens"`
			JSONSchema      *AISchema `json:"jsonSchema"`
		} `json:"request"`
		Reply   string    `json:"reply"`
		Sent    *AISent   `json:"sent"`
		Outcome AIOutcome `json:"outcome"`
	} `json:"text"`
	Vision []struct {
		Name     string `json:"name"`
		Provider string `json:"provider"`
		Request  struct {
			MimeType        string    `json:"mimeType"`
			MaxSide         float64   `json:"maxSide"`
			Instruction     string    `json:"instruction"`
			JSONSchema      *AISchema `json:"jsonSchema"`
			MaxOutputTokens *int      `json:"maxOutputTokens"`
			Options         *struct {
				GeminiMediaResolution string `json:"geminiMediaResolution"`
				GeminiThinkingLevel   string `json:"geminiThinkingLevel"`
				OpenAIDetail          string `json:"openaiDetail"`
			} `json:"options"`
		} `json:"request"`
		// ImageBytes is the picture; nil for a large one of ImageLength zero bytes.
		ImageBytes  []int     `json:"imageBytes"`
		ImageLength int       `json:"imageLength"`
		Reply       *string   `json:"reply"`
		Sent        *AISent   `json:"sent"`
		Outcome     AIOutcome `json:"outcome"`
	} `json:"vision"`
	MockText []struct {
		Name    string          `json:"name"`
		Request json.RawMessage `json:"request"`
		Outcome AIOutcome       `json:"outcome"`
	} `json:"mockText"`
	Made []struct {
		Name     string            `json:"name"`
		Provider string            `json:"provider"`
		Status   int               `json:"status"`
		Body     string            `json:"body"`
		Headers  map[string]string `json:"headers"`
		Outcome  AIOutcome         `json:"outcome"`
	} `json:"made"`
	Structured []struct {
		Name     string    `json:"name"`
		Provider string    `json:"provider"`
		Output   string    `json:"output"`
		Outcome  AIOutcome `json:"outcome"`
	} `json:"structured"`
	Statuses []struct {
		Status int    `json:"status"`
		Kind   string `json:"kind"`
	} `json:"statuses"`
	RetryAfter struct {
		Now   int64 `json:"now"` // Unix milliseconds
		Cases []struct {
			Value *string  `json:"value"`
			Ms    *float64 `json:"ms"`
		} `json:"cases"`
	} `json:"retryAfter"`
	Retries []struct {
		Name    string            `json:"name"`
		Steps   []json.RawMessage `json:"steps"` // "ok", "not ours", or {kind, retryAfterMs}
		Random  float64           `json:"random"`
		Sleeps  []float64         `json:"sleeps"`
		Outcome AIOutcome         `json:"outcome"`
	} `json:"retries"`
	Calls []struct {
		Name   string `json:"name"`
		Record struct {
			Feature   string  `json:"feature"`
			Provider  string  `json:"provider"`
			Model     string  `json:"model"`
			Outcome   string  `json:"outcome"`
			LatencyMs float64 `json:"latencyMs"`
			Attempts  int     `json:"attempts"`
			Usage     *struct {
				InputTokens  *float64 `json:"inputTokens"`
				OutputTokens *float64 `json:"outputTokens"`
				TotalTokens  *float64 `json:"totalTokens"`
			} `json:"usage"`
			Price *struct {
				InputUsdPerMTok  float64 `json:"inputUsdPerMTok"`
				OutputUsdPerMTok float64 `json:"outputUsdPerMTok"`
			} `json:"price"`
			HTTPStatus int `json:"httpStatus"`
		} `json:"record"`
		Fields json.RawMessage `json:"fields"`
	} `json:"calls"`
	VisionChecks []struct {
		Name        string  `json:"name"`
		MimeType    string  `json:"mimeType"`
		MaxSide     float64 `json:"maxSide"`
		Instruction string  `json:"instruction"`
		ImageLength int     `json:"imageLength"`
		Problem     *string `json:"problem"`
	} `json:"visionChecks"`
}

// LoadAIProviders reads testdata/golden/ai-providers.json; unknown fields fail.
func LoadAIProviders(t testing.TB) AIProviders {
	t.Helper()
	var p AIProviders
	load(t, "ai-providers.json", &p)
	if len(p.Text) == 0 || len(p.Vision) == 0 || len(p.Made) == 0 || len(p.Structured) == 0 || len(p.Statuses) == 0 ||
		len(p.RetryAfter.Cases) == 0 || len(p.Retries) == 0 || len(p.Calls) == 0 || len(p.VisionChecks) == 0 || len(p.MockText) == 0 {
		t.Fatal("ai-providers.json: a section is empty")
	}
	return p
}

// AIMonitoring is testdata/golden/ai-monitoring.json
// (apps/web/scripts/golden-ai-monitoring.ts): what the Next.js AI code makes
// of a monitoring event, a user id in the rollout, a moment of the quota day.
type AIMonitoring struct {
	GeneratedBy   string         `json:"generatedBy"`
	SourceCommit  string         `json:"sourceCommit"`
	Note          string         `json:"note"`
	SchemaVersion int            `json:"schemaVersion"`
	Limits        map[string]int `json:"limits"`
	// Sanitized: an event as a caller passes it and what may be emitted
	// (null: not an event). In an input, {"number": "NaN"} stands for a
	// number JSON cannot hold and {"undefined": true} for a missing value.
	Sanitized []struct {
		Name   string                     `json:"name"`
		Input  map[string]json.RawMessage `json:"input"`
		Output json.RawMessage            `json:"output"`
	} `json:"sanitized"`
	// Helpers: a typed record and the event it becomes.
	Helpers []struct {
		Name string `json:"name"`
		Call string `json:"call"` // request | quota
		Args struct {
			Feature   string   `json:"feature"`
			Provider  string   `json:"provider"`
			Model     string   `json:"model"`
			Outcome   string   `json:"outcome"`
			Reason    string   `json:"reason"`
			Action    string   `json:"action"`
			Corrected *bool    `json:"corrected"`
			Billable  bool     `json:"billable"`
			LatencyMs *float64 `json:"latencyMs"`
		} `json:"args"`
		Event map[string]any `json:"event"`
	} `json:"helpers"`
	Users []struct {
		ID     string `json:"id"`
		Bucket int    `json:"bucket"`
		Digest string `json:"digest"`
	} `json:"users"`
	Decisions []struct {
		ID      string `json:"id"`
		Rollout struct {
			Name      string   `json:"name"`
			Stylist   bool     `json:"stylist"`
			Vision    bool     `json:"vision"`
			Outfit    bool     `json:"outfit"`
			Percent   int      `json:"percent"`
			Allowlist []string `json:"allowlist"`
		} `json:"rollout"`
		Feature  string `json:"feature"`
		Eligible bool   `json:"eligible"`
		Reason   string `json:"reason"`
	} `json:"decisions"`
	Moments []struct {
		At                  time.Time `json:"at"`
		Day                 string    `json:"day"`
		SecondsUntilNextDay int       `json:"secondsUntilNextDay"`
	} `json:"moments"`
}

// LoadAIMonitoring reads the AI monitoring vectors.
func LoadAIMonitoring(t testing.TB) AIMonitoring {
	t.Helper()
	var m AIMonitoring
	load(t, "ai-monitoring.json", &m)
	if len(m.Sanitized) == 0 || len(m.Helpers) == 0 || len(m.Users) == 0 || len(m.Decisions) == 0 || len(m.Moments) == 0 || len(m.Limits) == 0 {
		t.Fatal("ai-monitoring.json: a section is empty")
	}
	return m
}
