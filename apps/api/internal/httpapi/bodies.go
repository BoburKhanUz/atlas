package httpapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"lookly/internal/accounts"
	"lookly/internal/apierr"
	"lookly/internal/legal"
	"lookly/internal/session"
)

// Request bodies of the auth operations, judged as the Next.js API's
// schemas judge them (apps/web/src/server/schemas/requests.ts, validated
// with zod and its Uzbek messages): the same fields are reported, in the
// same order, with the same messages. testdata/golden/auth-validation.json
// holds the Next.js answers and the tests reproduce them.
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
	out.Password, _ = v.text("password", textRule{checks: []check{minLength(8, msgPasswordTooShort), maxLength(200, "")}})
	out.Name = v.optionalText("name", textRule{optional: true, checks: []check{minLength(1, ""), maxLength(60, "")}})
	out.DeviceName = v.optionalText("deviceName", deviceNameRule)
	// The accepted version must be the current one; a missing or mistyped
	// consent field asks for the consent itself.
	out.AcceptedLegalVersion, _ = v.text("acceptedLegalVersion", textRule{
		typeMessage: msgConsentMissing,
		checks: []check{maxLength(40, msgConsentOutdated), func(s string) string {
			if s != legal.Version {
				return msgConsentOutdated
			}
			return ""
		}},
	})
	switch raw, present := v.members["ageConfirmed"]; {
	case !present || (kindOf(raw) != "boolean"):
		v.report("ageConfirmed", msgConsentMissing)
	case string(bytes.TrimSpace(raw)) != "true":
		v.report("ageConfirmed", msgAgeNotConfirmed)
	default:
		out.AgeConfirmed = true
	}
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

// deviceNameRule: trimmed first, then at most the session protocol's limit.
var deviceNameRule = textRule{optional: true, trim: true, checks: []check{minLength(1, ""), maxLength(session.DeviceNameMax, "")}}

// refreshTokenRule: at most the longest token the session protocol looks up.
func refreshTokenRule(optional bool) textRule {
	return textRule{optional: optional, checks: []check{minLength(1, ""), maxLength(session.RefreshTokenMaxLength, "")}}
}

// validation collects what is wrong with an object body, in schema order.
type validation struct {
	members map[string]json.RawMessage
	issues  []apierr.Detail
}

// readObject reads a body as a JSON object. An empty body is an empty
// object (the Next.js API reads it so); anything that is not JSON is
// BAD_REQUEST; JSON that is not an object is a validation error.
func readObject(raw []byte) (*validation, *apierr.Error) {
	v := &validation{}
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

func (v *validation) report(path, message string) {
	v.issues = append(v.issues, apierr.Detail{Path: path, Message: message})
}

// result is the canonical body, or the validation error: its message is the
// first problem's, its details at most the first twenty.
func (v *validation) result(out any) ([]byte, *apierr.Error) {
	if len(v.issues) > 0 {
		return nil, apierr.Validation(v.issues[0].Message, v.issues[:min(len(v.issues), 20)]...)
	}
	canonical, err := json.Marshal(out)
	if err != nil { // a struct of strings and booleans always marshals
		return nil, apierr.New(apierr.Internal)
	}
	return canonical, nil
}

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
func isJSWhiteSpace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', 0x00A0, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF:
		return true
	}
	return r >= 0x2000 && r <= 0x200A
}
