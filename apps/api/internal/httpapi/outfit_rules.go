package httpapi

import (
	"bytes"
	"encoding/json"
	"math"
	"net/url"
	"strconv"

	"lookly/internal/apierr"
	"lookly/internal/catalog"
)

// The request rules of the outfit and weather routes: the Next.js schemas
// (apps/web/src/server/schemas/requests.ts) with their messages, held to
// them by testdata/golden/outfit-validation.json.

// The limits of the schemas.
const (
	outfitNameMax        = 80
	outfitReasonsMax     = 20
	outfitReasonMax      = 120
	outfitExplanationMax = 2000
	outfitItemsMin       = 1
	outfitItemsMax       = 12
	outfitRoleMax        = 30
	feedbackNoteMax      = 500
	conditionMax         = 40
	msgCoordinates       = "lat va lon parametrlari noto‘g‘ri"
)

var feedbackKinds = []string{"liked", "disliked", "saved", "rejected"}

// numRule is the rule of a member that is a number.
type numRule struct {
	required bool // absent is a mistake
	nullable bool // null is allowed
	whole    bool // a whole number
	bounded  bool // from min to max
	min, max int64
}

// numeric reads a member that is a number, as JavaScript reads it (a
// double). present: there is a value (ok) or an explicit null (isNull).
func (v *validation) numeric(name string, rule numRule) (value float64, ok, isNull bool) {
	raw, has := v.members[name]
	kind := "undefined"
	if has {
		kind = kindOf(raw)
	}
	switch {
	case !has && !rule.required:
		return 0, false, false
	case kind == "null" && rule.nullable:
		return 0, false, true
	case kind != "raqam":
		v.report(name, msgWrongType("raqam", kind))
		return 0, false, false
	}
	// A JSON number is always in ParseFloat's syntax; past the largest
	// double it is an infinity, which is not a number to the validator.
	f, _ := strconv.ParseFloat(string(bytes.TrimSpace(raw)), 64)
	if math.IsInf(f, 0) || math.IsNaN(f) {
		v.report(name, msgWrongType("raqam", "raqam"))
		return 0, false, false
	}
	ok = true
	if rule.whole {
		switch {
		case f != math.Trunc(f):
			v.report(name, msgWrongType("int", "raqam"))
			return 0, false, false
		case f > maxSafeInteger:
			v.report(name, msgTooBig("int", maxSafeInteger))
			ok = false
		case f < -maxSafeInteger:
			v.report(name, msgTooSmall("int", -maxSafeInteger))
			ok = false
		}
	}
	if rule.bounded {
		if f < float64(rule.min) {
			v.report(name, msgTooSmall("number", rule.min))
			ok = false
		}
		if f > float64(rule.max) {
			v.report(name, msgTooBig("number", rule.max))
			ok = false
		}
	}
	return f, ok, false
}

// put reads a number into out (null as nil).
func (v *validation) put(out map[string]any, name string, rule numRule) {
	switch value, ok, isNull := v.numeric(name, rule); {
	case isNull:
		out[name] = nil
	case ok && rule.whole:
		out[name] = int64(value)
	case ok:
		out[name] = value
	}
}

// boolean reads an optional member that is true or false into out.
func (v *validation) boolean(out map[string]any, name string) {
	raw, has := v.members[name]
	if !has {
		return
	}
	if kind := kindOf(raw); kind != "boolean" {
		v.report(name, msgWrongType("boolean", kind))
		return
	}
	out[name] = bytes.TrimSpace(raw)[0] == 't'
}

// list reads a member that is an array; ok is false when it is absent or
// of another type (reported, unless absent and optional).
func (v *validation) list(name string, optional bool) (items []json.RawMessage, ok bool) {
	raw, has := v.members[name]
	if !has && optional {
		return nil, false
	}
	kind := "undefined"
	if has {
		kind = kindOf(raw)
	}
	if kind != "massiv" {
		v.report(name, msgWrongType("massiv", kind))
		return nil, false
	}
	if err := json.Unmarshal(raw, &items); err != nil { // cannot happen: the body is valid JSON and this is an array
		v.report(name, msgWrongType("massiv", "massiv"))
		return nil, false
	}
	return items, true
}

// element is the validation of one member of a list that must be an object.
func (v *validation) element(list string, index int, raw json.RawMessage) (*validation, bool) {
	name := list + "." + strconv.Itoa(index)
	if kind := kindOf(raw); kind != "object" {
		v.report(name, msgWrongType("object", kind))
		return nil, false
	}
	e := &validation{prefix: v.prefix + name + ".", issues: v.issues}
	if err := json.Unmarshal(raw, &e.members); err != nil { // cannot happen: the body is valid JSON and this is an object
		v.report(name, msgWrongType("object", "object"))
		return nil, false
	}
	return e, true
}

// occasion reads the optional occasion (or null) into out.
func (v *validation) occasion(out map[string]any) {
	v.choice(out, "occasion", catalog.Occasions, true)
}

// weather reads the optional weather snapshot (or null) into out: all
// seven members, each within its range.
func (v *validation) weather(out map[string]any) {
	const name = "weather"
	if isNull(v.members[name]) {
		out[name] = nil
		return
	}
	w, present := v.section(name)
	if !present {
		return
	}
	snapshot := map[string]any{}
	number := func(member string, min, max int64) {
		w.put(snapshot, member, numRule{required: true, bounded: true, min: min, max: max})
	}
	number("temperature", -90, 70)
	number("feelsLike", -100, 80)
	if condition, ok := w.text("condition", textRule{trim: true, checks: []check{minLength(1, ""), maxLength(conditionMax, "")}}); ok {
		snapshot["condition"] = condition
	}
	number("precipitationProbability", 0, 100)
	number("humidity", 0, 100)
	number("windSpeed", 0, 500)
	number("uvIndex", 0, 30)
	out[name] = snapshot
}

// OutfitGenerateBody is the body of POST /api/v1/outfits/generate: every
// member optional; the occasion, the weather and the coordinates may be null.
func OutfitGenerateBody(raw []byte) ([]byte, *apierr.Error) {
	v, err := readObject(raw)
	if err != nil {
		return nil, err
	}
	out := map[string]any{}
	v.occasion(out)
	v.weather(out)
	v.put(out, "lat", numRule{nullable: true, bounded: true, min: -90, max: 90})
	v.put(out, "lon", numRule{nullable: true, bounded: true, min: -180, max: 180})
	v.put(out, "seed", numRule{})
	v.put(out, "topN", numRule{whole: true, bounded: true, min: 1, max: 5})
	return v.result(out)
}

// OutfitSaveBody is the body of POST /api/v1/outfits: the items (1 to 12,
// each an item id and a role) and what the generation gave with them.
func OutfitSaveBody(raw []byte) ([]byte, *apierr.Error) {
	v, err := readObject(raw)
	if err != nil {
		return nil, err
	}
	out := map[string]any{}
	v.occasion(out)
	v.weather(out)
	v.nullableText(out, "name", outfitNameMax)
	v.put(out, "score", numRule{nullable: true, bounded: true, min: 0, max: 100})
	if reasons, ok := v.list("reasons", true); ok {
		values := make([]string, 0, len(reasons))
		for i, r := range reasons {
			e := &validation{members: map[string]json.RawMessage{strconv.Itoa(i): r}, prefix: v.prefix + "reasons.", issues: v.issues}
			if reason, ok := e.text(strconv.Itoa(i), textRule{checks: []check{maxLength(outfitReasonMax, "")}}); ok {
				values = append(values, reason)
			}
		}
		if len(reasons) > outfitReasonsMax {
			v.report("reasons", msgTooManyItems(outfitReasonsMax))
		}
		out["reasons"] = values
	}
	if isNull(v.members["explanation"]) {
		out["explanation"] = nil
	} else if explanation, ok := v.text("explanation", textRule{optional: true, checks: []check{maxLength(outfitExplanationMax, "")}}); ok {
		out["explanation"] = explanation
	}
	v.boolean(out, "isSaved")
	if items, ok := v.list("items", false); ok {
		values := make([]map[string]any, 0, len(items))
		for i, raw := range items {
			e, ok := v.element("items", i, raw)
			if !ok {
				continue
			}
			item := map[string]any{}
			if id, ok := e.text("itemId", textRule{trim: true, checks: []check{minLength(1, ""), maxLength(idMax, "")}}); ok {
				item["itemId"] = id
			}
			if role, ok := e.text("role", textRule{trim: true, checks: []check{minLength(1, ""), maxLength(outfitRoleMax, "")}}); ok {
				item["role"] = role
			}
			values = append(values, item)
		}
		if len(items) < outfitItemsMin {
			v.report("items", msgTooFewItems(outfitItemsMin))
		}
		if len(items) > outfitItemsMax {
			v.report("items", msgTooManyItems(outfitItemsMax))
		}
		out["items"] = values
	}
	return v.result(out)
}

// OutfitPatchBody is the body of PATCH /api/v1/outfits/{id}.
func OutfitPatchBody(raw []byte) ([]byte, *apierr.Error) {
	v, err := readObject(raw)
	if err != nil {
		return nil, err
	}
	out := map[string]any{}
	v.boolean(out, "isSaved")
	v.nullableText(out, "name", outfitNameMax)
	return v.result(out)
}

// OutfitFeedbackBody is the body of POST /api/v1/outfits/{id}/feedback.
func OutfitFeedbackBody(raw []byte) ([]byte, *apierr.Error) {
	v, err := readObject(raw)
	if err != nil {
		return nil, err
	}
	out := map[string]any{}
	if kind, ok := oneOf(v.members["feedback"], feedbackKinds); ok {
		out["feedback"] = kind
	} else {
		v.report("feedback", msgNotOneOf(feedbackKinds))
	}
	if note, ok := v.text("note", textRule{optional: true, trim: true, checks: []check{maxLength(feedbackNoteMax, "")}}); ok {
		out["note"] = note
	}
	return v.result(out)
}

// OutfitListQuery is the query of GET /api/v1/outfits: "saved", when it is
// not empty, is one of 0, 1, true and false.
func OutfitListQuery(query url.Values) (url.Values, *apierr.Error) {
	v := &validation{issues: new([]apierr.Detail), members: map[string]json.RawMessage{}}
	if value := query.Get("saved"); value != "" {
		encoded, _ := json.Marshal(value) // a string always encodes
		v.members["saved"] = encoded
	}
	section := map[string]any{}
	v.choice(section, "saved", []string{"0", "1", "true", "false"}, false)
	if issues := *v.issues; len(issues) > 0 {
		return nil, apierr.Validation(issues[0].Message, issues...)
	}
	out := url.Values{}
	if saved, ok := section["saved"].(string); ok {
		out.Set("saved", saved)
	}
	return out, nil
}

// WeatherQuery is the query of GET /api/v1/weather/current: lat and lon,
// read as JavaScript's Number() reads a string, within their ranges.
func WeatherQuery(query url.Values) (url.Values, *apierr.Error) {
	v := &validation{issues: new([]apierr.Detail)}
	out := url.Values{}
	for _, c := range []struct {
		name string
		max  int64
	}{{"lat", 90}, {"lon", 180}} {
		raw := query.Get(c.name)
		f := math.NaN() // a missing or empty parameter is no number
		if raw != "" {
			f = jsNumber(raw)
		}
		switch {
		case math.IsNaN(f) || math.IsInf(f, 0):
			v.report(c.name, msgCoordinates)
			continue
		case f < float64(-c.max):
			v.report(c.name, msgTooSmall("number", -c.max))
		case f > float64(c.max):
			v.report(c.name, msgTooBig("number", c.max))
		}
		out.Set(c.name, strconv.FormatFloat(f+0, 'g', -1, 64)) // -0 as 0
	}
	if issues := *v.issues; len(issues) > 0 {
		return nil, apierr.Validation(issues[0].Message, issues...)
	}
	return out, nil
}
