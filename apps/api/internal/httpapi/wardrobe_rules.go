package httpapi

import (
	"encoding/json"
	"math"
	"math/big"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"lookly/internal/apierr"
	"lookly/internal/catalog"
)

// Request rules of the wardrobe operations, judged as the Next.js schemas
// judge them (apps/web/src/server/schemas/requests.ts and common.ts;
// testdata/golden/wardrobe-validation.json holds the Next.js answers).

const (
	itemColorsMax  = 5
	itemSeasonsMax = 4
	idMax          = 64
	listLimitMin   = 1
	listLimitMax   = 200
	listLimitDflt  = 100
)

// WardrobePatchBody is the body of PATCH /api/v1/wardrobe/items/{id}: every
// member optional; each one-of member but the category may be null (it is
// then cleared).
func WardrobePatchBody(raw []byte) ([]byte, *apierr.Error) {
	v, err := readObject(raw)
	if err != nil {
		return nil, err
	}
	out := map[string]any{}
	v.choice(out, "category", catalog.Categories, false)
	v.choice(out, "subcategory", catalog.AllSubcategories, true)
	v.choices(out, "colors", catalog.Colors, itemColorsMax)
	v.choice(out, "pattern", catalog.Patterns, true)
	v.choice(out, "material", catalog.Materials, true)
	v.choice(out, "sleeveLength", catalog.SleeveLengths, true)
	v.choice(out, "fit", catalog.Fits, true)
	v.choice(out, "style", catalog.Styles, true)
	v.choices(out, "season", catalog.Seasons, itemSeasonsMax)
	v.choice(out, "gender", catalog.Genders, true)
	v.choice(out, "formality", catalog.Formalities, true)
	return v.result(out)
}

// QueryRule judges a request's query string. It returns the query in
// canonical form (only the known parameters, normalised, defaults filled
// in) for the generated decoder to read, or the error to answer with.
type QueryRule func(query url.Values) (url.Values, *apierr.Error)

// WardrobeListQuery is the query of GET /api/v1/wardrobe/items. As the
// Next.js route reads it, a parameter that is empty is absent, and of a
// repeated one the first counts.
func WardrobeListQuery(query url.Values) (url.Values, *apierr.Error) {
	v := &validation{issues: new([]apierr.Detail), members: map[string]json.RawMessage{}}
	for _, name := range []string{"category", "limit", "cursor"} {
		if value := query.Get(name); value != "" {
			encoded, _ := json.Marshal(value) // a string always encodes
			v.members[name] = encoded
		}
	}
	out := url.Values{}
	section := map[string]any{}
	v.choice(section, "category", append([]string{"all"}, catalog.Categories...), false)
	if category, ok := section["category"].(string); ok {
		out.Set("category", category)
	}
	limit := listLimitDflt
	if raw := query.Get("limit"); raw != "" {
		if n, ok := v.coercedInteger("limit", raw, listLimitMin, listLimitMax); ok {
			limit = n
		}
	}
	out.Set("limit", strconv.Itoa(limit))
	if cursor, present := v.text("cursor", textRule{optional: true, trim: true, checks: []check{minLength(1, ""), maxLength(idMax, "")}}); present {
		out.Set("cursor", cursor)
	}
	if issues := *v.issues; len(issues) > 0 {
		return nil, apierr.Validation(issues[0].Message, issues[:min(len(issues), 20)]...)
	}
	return out, nil
}

// coercedInteger reads a query value as the validator's z.coerce.number()
// does (JavaScript's Number()), then as a whole number from min to max.
func (v *validation) coercedInteger(name, raw string, min, max int) (int, bool) {
	f := jsNumber(raw)
	switch {
	case math.IsNaN(f):
		v.report(name, msgWrongType("raqam", "NaN"))
		return 0, false
	case math.IsInf(f, 0):
		v.report(name, msgWrongType("raqam", "raqam"))
		return 0, false
	case f != math.Trunc(f):
		v.report(name, msgWrongType("int", "raqam"))
		return 0, false
	}
	ok := true
	if f > maxSafeInteger {
		v.report(name, msgTooBig("int", maxSafeInteger))
		ok = false
	} else if f < -maxSafeInteger {
		v.report(name, msgTooSmall("int", -maxSafeInteger))
		ok = false
	}
	if f < float64(min) {
		v.report(name, msgTooSmall("number", int64(min)))
		ok = false
	}
	if f > float64(max) {
		v.report(name, msgTooBig("number", int64(max)))
		ok = false
	}
	return int(f), ok
}

var jsDecimal = regexp.MustCompile(`^[+-]?(?:Infinity|(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)$`)

// jsNumber is JavaScript's Number(string): white space around is ignored,
// an empty string is 0, a decimal literal (with "Infinity"), or 0x, 0o, 0b
// integers without a sign; anything else is NaN.
func jsNumber(s string) float64 {
	s = strings.TrimFunc(s, isJSWhiteSpace)
	if s == "" {
		return 0
	}
	if len(s) > 2 && s[0] == '0' {
		base := 0
		switch s[1] {
		case 'x', 'X':
			base = 16
		case 'o', 'O':
			base = 8
		case 'b', 'B':
			base = 2
		}
		if base != 0 {
			n, ok := new(big.Int).SetString(s[2:], base)
			if !ok || strings.ContainsAny(s[2:], "+-_") {
				return math.NaN()
			}
			f, _ := new(big.Float).SetInt(n).Float64()
			return f
		}
	}
	if !jsDecimal.MatchString(s) {
		return math.NaN()
	}
	switch strings.TrimLeft(s, "+-") {
	case "Infinity":
		if s[0] == '-' {
			return math.Inf(-1)
		}
		return math.Inf(1)
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil { // out of range: ParseFloat gives ±Inf with the error
		return f
	}
	return f
}

// ItemID is an item id from the path, as the Next.js route reads it:
// trimmed, then 1 to 64 characters.
func ItemID(raw string) (string, *apierr.Error) {
	v := &validation{issues: new([]apierr.Detail), members: map[string]json.RawMessage{}}
	encoded, _ := json.Marshal(raw)
	v.members["id"] = encoded
	id, _ := v.text("id", textRule{trim: true, checks: []check{minLength(1, ""), maxLength(idMax, "")}})
	if issues := *v.issues; len(issues) > 0 {
		return "", apierr.Validation(issues[0].Message, issues...)
	}
	return id, nil
}

var idempotencyKeyPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{8,128}$`)

const msgIdempotencyKey = "Idempotency-Key: 8–128 ta belgi (A-Z, a-z, 0-9, _ yoki -)"

// IdempotencyKey is the request's Idempotency-Key header: absent, or 8 to
// 128 of [A-Za-z0-9_-] (with the white space around it that HTTP allows
// ignored, as the Fetch API ignores it).
func IdempotencyKey(r *http.Request) (key string, present bool, err *apierr.Error) {
	values, ok := r.Header[http.CanonicalHeaderKey("Idempotency-Key")]
	if !ok || len(values) == 0 {
		return "", false, nil
	}
	key = strings.Trim(strings.Join(values, ", "), " \t")
	if !idempotencyKeyPattern.MatchString(key) {
		return "", true, apierr.Validation(msgIdempotencyKey, apierr.Detail{Path: "Idempotency-Key", Message: "must match ^[A-Za-z0-9_-]{8,128}$"})
	}
	return key, true, nil
}
