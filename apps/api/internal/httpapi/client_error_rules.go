package httpapi

import (
	"regexp"
	"time"

	"lookly/internal/apierr"
)

// The request rule of POST /api/v1/client-errors: the Next.js
// ClientErrorsRequest (apps/web/src/server/schemas/requests.ts) with its
// messages, held to it by testdata/golden/client-errors.json.

const (
	clientReportsMin = 1
	clientReportsMax = 10
	msgNotADateTime  = "Noto‘g‘ri ISO sana va vaqti"
)

var (
	clientPlatforms = []string{"android", "ios", "web"}
	clientKinds     = []string{"flutter", "dart", "android_java", "android_native", "android_anr", "web_error", "web_rejection", "react"}
	// isoDateTime is the validator's datetime (zod 4 z.iso.datetime()): a
	// real calendar date, hours and minutes, optional seconds with any
	// fraction, in UTC (Z) only.
	isoDateTime = regexp.MustCompile(`^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))T(?:(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z))$`)
)

// clientText is a report's text member's limits.
type clientText struct {
	name     string
	min, max int
	optional bool
}

// ClientErrorsBody is the body of POST /api/v1/client-errors: 1 to 10
// reports. A report's device time is written in one form (RFC 3339 with
// seconds, as Go reads a time): the validator takes it without seconds too.
func ClientErrorsBody(raw []byte) ([]byte, *apierr.Error) {
	v, err := readObject(raw)
	if err != nil {
		return nil, err
	}
	out := map[string]any{}
	if reports, ok := v.list("reports", false); ok {
		values := make([]map[string]any, 0, len(reports))
		for i, r := range reports {
			e, ok := v.element("reports", i, r)
			if !ok {
				continue
			}
			values = append(values, e.clientReport())
		}
		if len(reports) < clientReportsMin {
			v.report("reports", msgTooFewItems(clientReportsMin))
		}
		if len(reports) > clientReportsMax {
			v.report("reports", msgTooManyItems(clientReportsMax))
		}
		out["reports"] = values
	}
	return v.result(out)
}

// clientReport reads one report, its members in the schema's order.
func (v *validation) clientReport() map[string]any {
	out := map[string]any{}
	// A choice that must be there: missing is "not one of" too.
	required := func(name string, allowed []string) {
		if _, has := v.members[name]; !has {
			v.report(name, msgNotOneOf(allowed))
			return
		}
		v.choice(out, name, allowed, false)
	}
	required("platform", clientPlatforms)
	text := func(t clientText) {
		checks := []check{maxLength(t.max, "")}
		if t.min > 0 {
			checks = []check{minLength(t.min, ""), maxLength(t.max, "")}
		}
		if value, ok := v.text(t.name, textRule{optional: t.optional, checks: checks}); ok {
			out[t.name] = value
		}
	}
	text(clientText{name: "appVersion", min: 1, max: 40})
	text(clientText{name: "osVersion", max: 120, optional: true})
	required("kind", clientKinds)
	v.boolean(out, "fatal")
	text(clientText{name: "errorType", min: 1, max: 200})
	text(clientText{name: "message", max: 1000})
	text(clientText{name: "stack", max: 4000, optional: true})
	text(clientText{name: "route", max: 200, optional: true})
	if at, ok := v.text("occurredAt", textRule{optional: true, checks: []check{func(s string) string {
		if !isoDateTime.MatchString(s) {
			return msgNotADateTime
		}
		return ""
	}}}); ok && isoDateTime.MatchString(at) {
		out["occurredAt"] = rfc3339(at)
	}
	return out
}

// rfc3339 writes a time the validator took (UTC) with its seconds, as Go
// reads one; a time without seconds is at :00.
func rfc3339(s string) string {
	if len(s) == len("2006-01-02T15:04Z") {
		s = s[:len(s)-1] + ":00Z"
	}
	t, _ := time.Parse(time.RFC3339Nano, s) // the pattern lets only times RFC 3339 reads through
	return t.UTC().Format(time.RFC3339Nano)
}
