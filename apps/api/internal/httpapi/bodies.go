package httpapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"

	"lookly/internal/accounts"
	"lookly/internal/apierr"
	"lookly/internal/catalog"
	"lookly/internal/legal"
	"lookly/internal/platform"
	"lookly/internal/session"
)

// Request bodies, judged as the Next.js API's schemas judge them
// (apps/web/src/server/schemas/requests.ts, validated with zod and its
// Uzbek messages): the same fields are reported, in the same order, with
// the same messages. testdata/golden/auth-validation.json and
// account-validation.json hold the Next.js answers and the tests reproduce
// them.
//
// One difference, on purpose: for a member of the wrong type zod also
// applies the string's length rules to arrays and to objects that have a
// "length" member, and reports those too. Here the wrong type is reported
// and nothing more about that member.

// BodyRule judges a raw request body. It returns the body in canonical form
// (only the known members, normalised) for the generated decoder to read,
// or the error to answer with.
type BodyRule func(raw []byte) (canonical []byte, err *apierr.Error)

// Messages of the request schemas.
const (
	msgInvalidJSON        = "Yaroqsiz JSON"
	msgInvalidCredentials = accounts.MsgInvalidCredentials
	msgInvalidEmail       = "Email noto‘g‘ri"
	msgPasswordTooShort   = "Parol kamida 8 belgi bo‘lishi kerak"
	msgConsentOutdated    = "Foydalanish shartlari yangilangan. Ularni qayta ko‘rib chiqing va tasdiqlang."
	msgConsentMissing     = "Ro‘yxatdan o‘tish uchun Foydalanish shartlari va Maxfiylik siyosatiga rozilik bering."
	msgReconsentMissing   = "Davom etish uchun Foydalanish shartlari va Maxfiylik siyosatiga rozilik bering."
	msgAgeNotConfirmed    = "18 yoshdan kattaligingizni tasdiqlang."
)

// The validator's own messages (zod's Uzbek locale).
func msgWrongType(expected, received string) string {
	return fmt.Sprintf("Noto‘g‘ri kirish: kutilgan %s, qabul qilingan %s", expected, received)
}

func msgTooLong(max int) string {
	return fmt.Sprintf("Juda katta: kutilgan string <=%d belgi bo‘lishi kerak", max)
}

func msgTooShort(min int) string {
	return fmt.Sprintf("Juda kichik: kutilgan string >=%d belgi bo‘lishi kerak", min)
}

func msgNotOneOf(allowed []string) string {
	return `Noto‘g‘ri variant: quyidagilardan biri kutilgan "` + strings.Join(allowed, `"|"`) + `"`
}

func msgTooManyItems(max int) string {
	return fmt.Sprintf("Juda katta: kutilgan array <=%d element bo‘lishi kerak", max)
}

func msgTooFewItems(min int) string {
	return fmt.Sprintf("Juda kichik: kutilgan array >=%d element bo‘lishi kerak", min)
}

// kind is "number" or "int", as the validator names the limit it checked.
func msgTooSmall(kind string, min int64) string {
	return fmt.Sprintf("Juda kichik: kutilgan %s >=%d", kind, min)
}

func msgTooBig(kind string, max int64) string {
	return fmt.Sprintf("Juda katta: kutilgan %s <=%d", kind, max)
}

// LoginBody is the body of POST /api/v1/auth/login.
func LoginBody(raw []byte) ([]byte, *apierr.Error) {
	v, err := readObject(raw)
	if err != nil {
		return nil, err
	}
	var out struct {
		Email      string  `json:"email"`
		Password   string  `json:"password"`
		DeviceName *string `json:"deviceName,omitempty"`
	}
	out.Email, _ = v.text("email", textRule{checks: []check{email(msgInvalidCredentials)}})
	out.Password, _ = v.text("password", textRule{checks: []check{minLength(1, msgInvalidCredentials), maxLength(200, "")}})
	out.DeviceName = v.optionalText("deviceName", deviceNameRule)
	return v.result(out)
}

// RegisterBody is the body of POST /api/v1/auth/register.
func RegisterBody(raw []byte) ([]byte, *apierr.Error) {
	v, err := readObject(raw)
	if err != nil {
		return nil, err
	}
	var out struct {
		Email                string  `json:"email"`
		Password             string  `json:"password"`
		Name                 *string `json:"name,omitempty"`
		DeviceName           *string `json:"deviceName,omitempty"`
		AcceptedLegalVersion string  `json:"acceptedLegalVersion"`
		AgeConfirmed         bool    `json:"ageConfirmed"`
	}
	out.Email, _ = v.text("email", textRule{checks: []check{email(msgInvalidEmail)}})
	out.Password, _ = v.text("password", newPasswordRule)
	out.Name = v.optionalText("name", textRule{optional: true, checks: []check{minLength(1, ""), maxLength(60, "")}})
	out.DeviceName = v.optionalText("deviceName", deviceNameRule)
	out.AcceptedLegalVersion, out.AgeConfirmed = v.consent(msgConsentMissing)
	return v.result(out)
}

// RefreshBody is the body of POST /api/v1/auth/refresh in mobile mode.
func RefreshBody(raw []byte) ([]byte, *apierr.Error) {
	v, err := readObject(raw)
	if err != nil {
		return nil, err
	}
	var out struct {
		RefreshToken string `json:"refreshToken"`
	}
	out.RefreshToken, _ = v.text("refreshToken", refreshTokenRule(false))
	return v.result(out)
}

// LogoutBody is the body of POST /api/v1/auth/logout in mobile mode; the
// token is optional there (the access token's session can be ended instead).
func LogoutBody(raw []byte) ([]byte, *apierr.Error) {
	v, err := readObject(raw)
	if err != nil {
		return nil, err
	}
	var out struct {
		RefreshToken *string `json:"refreshToken,omitempty"`
	}
	out.RefreshToken = v.optionalText("refreshToken", refreshTokenRule(true))
	return v.result(out)
}

// consent reads the two consent members: the accepted version must be the
// current one; a missing or mistyped member asks for the consent itself
// (missing is that message).
func (v *validation) consent(missing string) (version string, ageConfirmed bool) {
	version, _ = v.text("acceptedLegalVersion", textRule{
		typeMessage: missing,
		checks: []check{maxLength(40, msgConsentOutdated), func(s string) string {
			if s != legal.Version {
				return msgConsentOutdated
			}
			return ""
		}},
	})
	switch raw, present := v.members["ageConfirmed"]; {
	case !present || (kindOf(raw) != "boolean"):
		v.report("ageConfirmed", missing)
	case string(bytes.TrimSpace(raw)) != "true":
		v.report("ageConfirmed", msgAgeNotConfirmed)
	default:
		ageConfirmed = true
	}
	return version, ageConfirmed
}

// LegalConsentBody is the body of POST /api/v1/legal/consent.
func LegalConsentBody(raw []byte) ([]byte, *apierr.Error) {
	v, err := readObject(raw)
	if err != nil {
		return nil, err
	}
	var out struct {
		AcceptedLegalVersion string `json:"acceptedLegalVersion"`
		AgeConfirmed         bool   `json:"ageConfirmed"`
	}
	out.AcceptedLegalVersion, out.AgeConfirmed = v.consent(msgReconsentMissing)
	return v.result(out)
}

// PasswordForgotBody is the body of POST /api/v1/auth/password/forgot.
func PasswordForgotBody(raw []byte) ([]byte, *apierr.Error) {
	v, err := readObject(raw)
	if err != nil {
		return nil, err
	}
	var out struct {
		Email string `json:"email"`
	}
	out.Email, _ = v.text("email", textRule{checks: []check{email(msgInvalidEmail)}})
	return v.result(out)
}

// PasswordResetBody is the body of POST /api/v1/auth/password/reset.
func PasswordResetBody(raw []byte) ([]byte, *apierr.Error) {
	v, err := readObject(raw)
	if err != nil {
		return nil, err
	}
	var out struct {
		Token    string `json:"token"`
		Password string `json:"password"`
	}
	out.Token, _ = v.text("token", textRule{checks: []check{minLength(1, ""), maxLength(200, "")}})
	out.Password, _ = v.text("password", newPasswordRule)
	return v.result(out)
}

// The values of the profile's own choices (the schema's, not the catalog's).
var (
	profileGenders   = []string{"male", "female", "other", "unisex"}
	profileLanguages = []string{"uz", "ru", "en"}
)

const (
	profileTextMax    = 60
	preferenceListMax = 20
	budgetMax         = 1_000_000_000
)

// ProfilePatchBody is the body of PATCH /api/v1/profile. Every member is
// optional; in the profile section null clears a field, and the canonical
// body keeps null and absent apart.
func ProfilePatchBody(raw []byte) ([]byte, *apierr.Error) {
	v, err := readObject(raw)
	if err != nil {
		return nil, err
	}
	out := map[string]any{}
	if name, present := v.text("name", textRule{optional: true, trim: true, checks: []check{minLength(1, ""), maxLength(profileTextMax, "")}}); present {
		out["name"] = name
	}
	if p, present := v.section("profile"); present {
		section := map[string]any{}
		freeText := func(name string) { p.nullableText(section, name, profileTextMax) }
		p.choice(section, "gender", profileGenders, true)
		freeText("ageRange")
		p.number(section, "height", 50, 250, false)
		p.number(section, "weight", 20, 300, false)
		freeText("bodyShape")
		freeText("skinTone")
		freeText("skinUndertone")
		freeText("hairColor")
		freeText("eyeColor")
		freeText("clothingSize")
		p.choice(section, "preferredFit", catalog.Fits, true)
		p.number(section, "typicalBudget", 0, budgetMax, true)
		out["profile"] = section
	}
	if p, present := v.section("preferences"); present {
		section := map[string]any{}
		p.choices(section, "preferredStyles", catalog.Styles, preferenceListMax)
		p.choices(section, "dislikedStyles", catalog.Styles, preferenceListMax)
		p.choices(section, "favoriteColors", catalog.Colors, preferenceListMax)
		p.choices(section, "dislikedColors", catalog.Colors, preferenceListMax)
		p.choice(section, "language", profileLanguages, false)
		out["preferences"] = section
	}
	return v.result(out)
}

// newPasswordRule is a password being set: at least 8 characters. (The
// 72-byte limit of the hash is the account service's rule.)
var newPasswordRule = textRule{checks: []check{minLength(8, msgPasswordTooShort), maxLength(200, "")}}

// deviceNameRule: trimmed first, then at most the session protocol's limit.
var deviceNameRule = textRule{optional: true, trim: true, checks: []check{minLength(1, ""), maxLength(session.DeviceNameMax, "")}}

// refreshTokenRule: at most the longest token the session protocol looks up.
func refreshTokenRule(optional bool) textRule {
	return textRule{optional: optional, checks: []check{minLength(1, ""), maxLength(session.RefreshTokenMaxLength, "")}}
}

// validation collects what is wrong with an object body, in schema order.
// A section (a member that is itself an object) is a validation of its own
// that reports into the same list, under its path.
type validation struct {
	members map[string]json.RawMessage
	prefix  string           // "" for the body, "profile." for a section
	issues  *[]apierr.Detail // shared by the body and its sections
}

// readObject reads a body as a JSON object. An empty body is an empty
// object (the Next.js API reads it so); anything that is not JSON is
// BAD_REQUEST; JSON that is not an object is a validation error.
func readObject(raw []byte) (*validation, *apierr.Error) {
	v := &validation{issues: new([]apierr.Detail)}
	if len(raw) == 0 {
		return v, nil
	}
	if !json.Valid(raw) {
		return nil, &apierr.Error{Code: apierr.BadRequest, Message: msgInvalidJSON}
	}
	if kind := kindOf(raw); kind != "object" {
		message := msgWrongType("object", kind)
		return nil, apierr.Validation(message, apierr.Detail{Path: "", Message: message})
	}
	// Member names are matched exactly; of a repeated name the last counts.
	if err := json.Unmarshal(raw, &v.members); err != nil {
		return nil, &apierr.Error{Code: apierr.BadRequest, Message: msgInvalidJSON}
	}
	return v, nil
}

// report records a problem with the member name (or with one of its items:
// "name.3").
func (v *validation) report(name, message string) {
	*v.issues = append(*v.issues, apierr.Detail{Path: v.prefix + name, Message: message})
}

// result is the canonical body, or the validation error: its message is the
// first problem's, its details at most the first twenty.
func (v *validation) result(out any) ([]byte, *apierr.Error) {
	if issues := *v.issues; len(issues) > 0 {
		return nil, apierr.Validation(issues[0].Message, issues[:min(len(issues), 20)]...)
	}
	canonical, err := json.Marshal(out)
	if err != nil { // strings, booleans, finite numbers and lists of them always marshal
		return nil, apierr.New(apierr.Internal)
	}
	return canonical, nil
}

// section reads a member that is an object. Absent: not present; of another
// type: reported, and not present.
func (v *validation) section(name string) (*validation, bool) {
	raw, has := v.members[name]
	if !has {
		return nil, false
	}
	if kind := kindOf(raw); kind != "object" {
		v.report(name, msgWrongType("object", kind))
		return nil, false
	}
	s := &validation{prefix: v.prefix + name + ".", issues: v.issues}
	if err := json.Unmarshal(raw, &s.members); err != nil { // cannot happen: the body is valid JSON and this is an object
		v.report(name, msgWrongType("object", "object"))
		return nil, false
	}
	return s, true
}

// nullableText reads an optional member that is a string or null into out:
// trimmed, at most max characters (it may be empty).
func (v *validation) nullableText(out map[string]any, name string, max int) {
	if isNull(v.members[name]) {
		out[name] = nil
		return
	}
	if value, present := v.text(name, textRule{optional: true, trim: true, checks: []check{maxLength(max, "")}}); present {
		out[name] = value
	}
}

// choice reads an optional member that must be one of allowed (or null,
// when nullable) into out. Anything else, of whatever type, is "not one of".
func (v *validation) choice(out map[string]any, name string, allowed []string, nullable bool) {
	raw, has := v.members[name]
	switch {
	case !has:
	case nullable && isNull(raw):
		out[name] = nil
	default:
		if value, ok := oneOf(raw, allowed); ok {
			out[name] = value
		} else {
			v.report(name, msgNotOneOf(allowed))
		}
	}
}

// choices reads an optional member that is a list of at most max values of
// allowed into out. Each wrong item is reported under its index, then the
// list's length.
func (v *validation) choices(out map[string]any, name string, allowed []string, max int) {
	raw, has := v.members[name]
	if !has {
		return
	}
	if kind := kindOf(raw); kind != "massiv" {
		v.report(name, msgWrongType("massiv", kind))
		return
	}
	var items []json.RawMessage
	if err := json.Unmarshal(raw, &items); err != nil { // cannot happen: the body is valid JSON and this is an array
		v.report(name, msgWrongType("massiv", "massiv"))
		return
	}
	values := make([]string, 0, len(items))
	for i, item := range items {
		if value, ok := oneOf(item, allowed); ok {
			values = append(values, value)
		} else {
			v.report(name+"."+strconv.Itoa(i), msgNotOneOf(allowed))
		}
	}
	if len(items) > max {
		v.report(name, msgTooManyItems(max))
	}
	out[name] = values
}

// maxSafeInteger is the largest whole number a JavaScript number holds
// exactly: the validator's limit for a whole number.
const maxSafeInteger = 1<<53 - 1

// number reads an optional member that is a number from min to max (or
// null) into out, read as JavaScript reads it: as a double. whole: it must
// be a whole number, and is written as one.
func (v *validation) number(out map[string]any, name string, min, max int64, whole bool) {
	raw, has := v.members[name]
	if !has {
		return
	}
	kind := kindOf(raw)
	if kind == "null" {
		out[name] = nil
		return
	}
	if kind != "raqam" {
		v.report(name, msgWrongType("raqam", kind))
		return
	}
	// A JSON number is always in ParseFloat's syntax; past the largest
	// double it is an infinity, which is not a number to the validator.
	f, _ := strconv.ParseFloat(string(bytes.TrimSpace(raw)), 64)
	if math.IsInf(f, 0) || math.IsNaN(f) {
		v.report(name, msgWrongType("raqam", "raqam"))
		return
	}
	limit := "number"
	if whole {
		switch {
		case f != math.Trunc(f):
			v.report(name, msgWrongType("int", "raqam"))
			return
		case f > maxSafeInteger:
			v.report(name, msgTooBig("int", maxSafeInteger))
		case f < -maxSafeInteger:
			v.report(name, msgTooSmall("int", -maxSafeInteger))
		}
	}
	if f < float64(min) {
		v.report(name, msgTooSmall(limit, min))
	}
	if f > float64(max) {
		v.report(name, msgTooBig(limit, max))
	}
	if whole {
		if f >= float64(min) && f <= float64(max) {
			out[name] = int64(f)
		}
		return
	}
	out[name] = f
}

// oneOf reads raw as a string that is one of allowed.
func oneOf(raw json.RawMessage, allowed []string) (string, bool) {
	if kindOf(raw) != "string" {
		return "", false
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", false
	}
	for _, a := range allowed {
		if value == a {
			return value, true
		}
	}
	return "", false
}

func isNull(raw json.RawMessage) bool { return raw != nil && kindOf(raw) == "null" }

// check returns what is wrong with a string, or "".
type check func(s string) string

type textRule struct {
	optional    bool
	typeMessage string // for a missing or mistyped member; "" for the validator's own
	trim        bool
	checks      []check // all are applied, in order
}

// text reads a string member and applies its rule.
func (v *validation) text(name string, rule textRule) (value string, present bool) {
	raw, has := v.members[name]
	kind := "undefined"
	if has {
		kind = kindOf(raw)
	} else if rule.optional {
		return "", false
	}
	if kind != "string" {
		message := rule.typeMessage
		if message == "" {
			message = msgWrongType("string", kind)
		}
		v.report(name, message)
		return "", false
	}
	if err := json.Unmarshal(raw, &value); err != nil { // cannot happen: the body is valid JSON and this is a string
		v.report(name, msgWrongType("string", kind))
		return "", false
	}
	if rule.trim {
		value = strings.TrimFunc(value, isJSWhiteSpace)
	}
	for _, c := range rule.checks {
		if message := c(value); message != "" {
			v.report(name, message)
		}
	}
	return value, true
}

func (v *validation) optionalText(name string, rule textRule) *string {
	if value, present := v.text(name, rule); present {
		return &value
	}
	return nil
}

func minLength(n int, message string) check {
	if message == "" {
		message = msgTooShort(n)
	}
	return func(s string) string {
		if utf16Length(s) < n {
			return message
		}
		return ""
	}
}

func maxLength(n int, message string) check {
	if message == "" {
		message = msgTooLong(n)
	}
	return func(s string) string {
		if utf16Length(s) > n {
			return message
		}
		return ""
	}
}

// The validator's email rule: its pattern is the contract's (LoginRequest
// and RegisterRequest), split here because Go's regular expressions have no
// look-ahead: the address does not start with a dot and has no two dots in
// a row.
var emailPattern = regexp.MustCompile(`^[A-Za-z0-9_'+\-.]*[A-Za-z0-9_+\-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$`)

func email(message string) check {
	return func(s string) string {
		if strings.HasPrefix(s, ".") || strings.Contains(s, "..") || !emailPattern.MatchString(s) {
			return message
		}
		return ""
	}
}

// kindOf names the type of a JSON value as the validator's messages do.
func kindOf(raw json.RawMessage) string {
	switch first := bytes.TrimLeft(raw, " \t\r\n"); {
	case len(first) == 0:
		return "undefined"
	case first[0] == '"':
		return "string"
	case first[0] == '{':
		return "object"
	case first[0] == '[':
		return "massiv"
	case first[0] == 't' || first[0] == 'f':
		return "boolean"
	case first[0] == 'n':
		return "null"
	default:
		return "raqam"
	}
}

// utf16Length is a string's length as JavaScript counts it (the schemas'
// limits are in those units): a character outside the basic plane is two.
func utf16Length(s string) int {
	n := 0
	for _, r := range s {
		n++
		if r > 0xFFFF {
			n++
		}
	}
	return n
}

// isJSWhiteSpace is what JavaScript's String.prototype.trim removes.
func isJSWhiteSpace(r rune) bool { return platform.IsJSWhiteSpace(r) }
