package aimonitor

import (
	"encoding/json"
	"strconv"
	"strings"
	"unicode/utf8"
)

// ParseLogLines is the ai.call, ai.request and ai.quota events of a log
// text (JSON lines), in order; every other line is ignored.
func ParseLogLines(text string) []Event {
	var out []Event
	for line := range strings.SplitSeq(text, "\n") {
		if e, ok := ParseLine(line); ok {
			out = append(out, e)
		}
	}
	return out
}

// ParseLine is the event of one log line (without its "\n"); ok is false
// for a line that is not JSON or not one of the three events. As before,
// only a line that has `"ai.` in it is decoded.
func ParseLine(line string) (Event, bool) {
	if !strings.Contains(line, `"ai.`) || !json.Valid([]byte(line)) {
		return nil, false
	}
	dec := json.NewDecoder(strings.NewReader(line))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		return nil, false
	}
	object, isObject := numbers(v).(map[string]any)
	if !isObject {
		return nil, false
	}
	switch e := Event(object); e.msg() {
	case eventCall, eventRequest, eventQuota:
		return e, true
	}
	return nil, false
}

// numbers turns the decoded numbers into float64, as JSON.parse reads
// them: one beyond a float64's range is ±Inf (encoding/json would refuse
// the line), one too small is 0.
func numbers(v any) any {
	switch v := v.(type) {
	case json.Number:
		f, _ := strconv.ParseFloat(string(v), 64) // ErrRange: f is ±Inf or 0
		return f
	case map[string]any:
		for k, e := range v {
			v[k] = numbers(e)
		}
		return v
	case []any:
		for i, e := range v {
			v[i] = numbers(e)
		}
		return v
	}
	return v
}

// Text is a file's bytes read as UTF-8 the way the TypeScript monitor read
// them (WHATWG UTF-8 decode, a byte order mark kept): each maximal invalid
// sequence becomes one U+FFFD.
func Text(b []byte) string {
	if utf8.Valid(b) {
		return string(b)
	}
	var s strings.Builder
	s.Grow(len(b) + 16)
	for i := 0; i < len(b); {
		c := b[i]
		if c < utf8.RuneSelf {
			s.WriteByte(c)
			i++
			continue
		}
		need, lower, upper := 0, byte(0x80), byte(0xBF)
		switch {
		case c >= 0xC2 && c <= 0xDF:
			need = 1
		case c == 0xE0:
			need, lower = 2, 0xA0
		case c == 0xED:
			need, upper = 2, 0x9F
		case c >= 0xE1 && c <= 0xEF:
			need = 2
		case c == 0xF0:
			need, lower = 3, 0x90
		case c == 0xF4:
			need, upper = 3, 0x8F
		case c >= 0xF1 && c <= 0xF3:
			need = 3
		default:
			s.WriteRune(utf8.RuneError)
			i++
			continue
		}
		j := i + 1
		complete := true
		for k := range need {
			lo, hi := byte(0x80), byte(0xBF)
			if k == 0 {
				lo, hi = lower, upper
			}
			if j >= len(b) || b[j] < lo || b[j] > hi {
				complete = false
				break
			}
			j++
		}
		if complete {
			s.Write(b[i:j])
		} else {
			s.WriteRune(utf8.RuneError)
		}
		i = j
	}
	return s.String()
}
