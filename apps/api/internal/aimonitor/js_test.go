package aimonitor

import (
	"math"
	"slices"
	"testing"
	"time"

	"lookly/internal/golden"
)

// The JavaScript the monitor's output depends on, against what bun gave
// (testdata/golden/ai-monitor.json).

func TestLocaleCompareOverASCII(t *testing.T) {
	t.Parallel()
	c := golden.LoadAIMonitor(t).Collation
	got := slices.Clone(c.Input)
	slices.SortStableFunc(got, compareLocale)
	if !slices.Equal(got, c.Sorted) {
		for i := range got {
			if got[i] != c.Sorted[i] {
				t.Fatalf("at %d: %q, localeCompare put %q there", i, got[i], c.Sorted[i])
			}
		}
	}
}

func TestNumberToStringToFixedAndRound(t *testing.T) {
	t.Parallel()
	for _, n := range golden.LoadAIMonitor(t).Numbers {
		if got := jsNumber(n.Value); got != n.String {
			t.Errorf("String(%v) = %q, want %q", n.Value, got, n.String)
		}
		if got := jsToFixed(n.Value, 1); got != n.Fixed1 {
			t.Errorf("(%v).toFixed(1) = %q, want %q", n.Value, got, n.Fixed1)
		}
		if got := roundTo(n.Value, 1); got != n.Round {
			t.Errorf("Math.round(%v) = %v, want %v", n.Value, got, n.Round)
		}
	}
	// Beyond the recorded values: the signs and what is not a number.
	for x, want := range map[float64]string{math.Copysign(0, -1): "0", -1.5: "-1.5", -1e-7: "-1e-7", math.NaN(): "NaN", math.Inf(1): "Infinity", math.Inf(-1): "-Infinity"} {
		if got := jsNumber(x); got != want {
			t.Errorf("String(%v) = %q, want %q", x, got, want)
		}
	}
	for x, want := range map[float64]string{-0.25: "-0.3", -0.04: "-0.0", math.Copysign(0, -1): "0.0", 0.04: "0.0"} {
		if got := jsToFixed(x, 1); got != want {
			t.Errorf("(%v).toFixed(1) = %q, want %q", x, got, want)
		}
	}
}

func TestRatioRoundsHalfUp(t *testing.T) {
	t.Parallel()
	for _, r := range golden.LoadAIMonitor(t).Ratios {
		got := ratio(r.A, r.B)
		if (got == nil) != (r.Ratio == nil) || (got != nil && *got != *r.Ratio) {
			t.Errorf("ratio(%d, %d) = %v, want %v", r.A, r.B, got, r.Ratio)
		}
	}
}

// The forms outside the ISO format that JavaScriptCore's fallback parser
// reads, and lookly does not (see parseDate): a deliberate difference.
var notISO = map[string]bool{
	"2026Z": true, "2026-10Z": true, "2026-10-06Z": true, "02026-10-06": true, "2026-1-6": true, "2026-10-6": true,
	"Tue, 06 Oct 2026 10:00:00 GMT": true, "2026/10/06": true, "10/06/2026": true, "２０２６-10-06": true,
}

func TestDateParse(t *testing.T) {
	t.Parallel()
	differences := 0
	for _, d := range golden.LoadAIMonitor(t).Dates {
		got, ok := parseDate(d.Text, time.UTC)
		if notISO[d.Text] {
			differences++
			if ok || d.Ms == nil {
				t.Errorf("%q: read %v (%v); recorded %v from the fallback parser", d.Text, got, ok, d.Ms)
			}
			continue
		}
		if ok != (d.Ms != nil) || (ok && got != *d.Ms) {
			t.Errorf("Date.parse(%q) = %v (%v), want %v", d.Text, got, ok, d.Ms)
		}
	}
	if differences != len(notISO) {
		t.Errorf("%d of the %d listed differences are recorded", differences, len(notISO))
	}
	// A date-time without an offset is local time: read in the location.
	tashkent := time.FixedZone("UTC+5", 5*3600)
	if got, ok := parseDate("2026-10-06T10:00:00", tashkent); !ok || got != 1791262800000 {
		t.Errorf("local time: %v %v", got, ok)
	}
	if got, ok := parseDate("2026-10-06", tashkent); !ok || got != 1791244800000 {
		t.Errorf("a date alone is UTC: %v %v", got, ok)
	}
}

func TestObjectEntriesOrder(t *testing.T) {
	t.Parallel()
	var c Counts
	for _, k := range []string{"b", "503", "a", "429", "4294967295", "4294967294", "007", "0", "-1", "1.5", ""} {
		c.inc(k)
	}
	// As bun lists them.
	want := []string{"0", "429", "503", "4294967294", "b", "a", "4294967295", "007", "-1", "1.5", ""}
	if got := c.Keys(); !slices.Equal(got, want) {
		t.Errorf("keys %q, want %q", got, want)
	}
}

func TestToStringOfJSONValues(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		v    any
		want string
	}{
		{"x", "x"}, {2026.0, "2026"}, {true, "true"}, {nil, "null"}, {map[string]any{}, "[object Object]"},
		{[]any{"2026-10-06T11:00:00Z"}, "2026-10-06T11:00:00Z"}, {[]any{1.0, nil, []any{"a", "b"}}, "1,,a,b"}, {[]any{}, ""},
	} {
		if got := jsToString(tc.v); got != tc.want {
			t.Errorf("String(%v) = %q, want %q", tc.v, got, tc.want)
		}
	}
	if !truthy([]any{}, true) || truthy(0.0, true) || truthy("", true) || truthy(nil, true) || truthy(nil, false) {
		t.Error("truthiness")
	}
}
