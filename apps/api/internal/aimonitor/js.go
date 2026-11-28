package aimonitor

import (
	"math"
	"math/big"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf16"
	"unicode/utf8"

	"lookly/internal/platform"
)

// The JavaScript behaviour the TypeScript monitor relied on, as far as the
// monitor's output depends on it.

// roundTo is Math.round(x * scale) / scale.
func roundTo(x, scale float64) float64 {
	return platform.RoundHalfUp(x*scale) / scale
}

// jsNumber is String(x) for a Number (ECMAScript Number::toString, radix
// 10): the shortest digits that read back as x, in positional notation from
// 1e-6 up to below 1e21 and in exponent notation (1e+21, 1e-7) outside.
func jsNumber(x float64) string {
	switch {
	case math.IsNaN(x):
		return "NaN"
	case math.IsInf(x, 1):
		return "Infinity"
	case math.IsInf(x, -1):
		return "-Infinity"
	case x == 0: // and -0
		return "0"
	case x < 0:
		return "-" + jsNumber(-x)
	}
	// d.ddddde±n: the shortest round-trip digits and the exponent.
	e := strconv.FormatFloat(x, 'e', -1, 64)
	mantissa, exp, _ := strings.Cut(e, "e")
	digits := strings.Replace(mantissa, ".", "", 1)
	power, _ := strconv.Atoi(exp)
	k, n := len(digits), power+1
	switch {
	case k <= n && n <= 21:
		return digits + strings.Repeat("0", n-k)
	case 0 < n && n <= 21:
		return digits[:n] + "." + digits[n:]
	case -6 < n && n <= 0:
		return "0." + strings.Repeat("0", -n) + digits
	}
	sign := "+"
	if n-1 < 0 {
		sign = "-"
	}
	out := digits[:1]
	if k > 1 {
		out += "." + digits[1:]
	}
	return out + "e" + sign + strconv.Itoa(abs(n-1))
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

// jsToFixed is x.toFixed(digits): the exact value of the double, rounded to
// the digits with a tie going to the larger magnitude (Go's 'f' format
// rounds a tie to even: 1.25 is "1.3" here, "1.2" there).
func jsToFixed(x float64, digits int) string {
	if math.IsNaN(x) || math.IsInf(x, 0) || math.Abs(x) >= 1e21 {
		return jsNumber(x)
	}
	sign := ""
	if x < 0 {
		sign, x = "-", -x
	}
	scaled := new(big.Rat).SetFloat64(x)
	scaled.Mul(scaled, new(big.Rat).SetInt(new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(digits)), nil)))
	scaled.Add(scaled, big.NewRat(1, 2))
	n := new(big.Int).Quo(scaled.Num(), scaled.Denom()) // floor: both are positive
	s := n.String()
	if digits == 0 {
		return sign + s
	}
	if len(s) <= digits {
		s = strings.Repeat("0", digits-len(s)+1) + s
	}
	return sign + s[:len(s)-digits] + "." + s[len(s)-digits:]
}

// compareLocale is a.localeCompare(b) as the TypeScript monitor ran it
// (bun, ICU root collation, tertiary strength) for ASCII text, which is what
// the events' codes are made of:
//   - the C0 controls other than TAB, LF, VT, FF and CR, and DEL, are
//     ignored ("a\x01b" equals "ab");
//   - the rest sort by a primary weight: TAB LF VT FF CR, space, then
//     _ - , ; : ! ? . ' " ( ) [ ] { } @ * / \ & # % ` ^ + < = > | ~ $, then
//     the digits, then the letters, a letter's two cases together;
//   - strings equal on that are ordered by case, letter by letter, a lower
//     case letter first ("ab" < "aB" < "Ab" < "AB").
//
// So "outfit_explanation" sorts before "outfit" (_ before |) and "G1"
// between "g1" and "g10", unlike the bytes. Other characters are not ASCII
// and ICU is not replicated for them: they sort after every ASCII one, by
// code point, with no case.
func compareLocale(a, b string) int {
	pa, ta := collationKey(a)
	pb, tb := collationKey(b)
	if c := slices.Compare(pa, pb); c != 0 {
		return c
	}
	return slices.Compare(ta, tb)
}

// asciiPrimary is the primary order of the ASCII characters that have one.
const asciiPrimary = "\t\n\v\f\r _-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$0123456789abcdefghijklmnopqrstuvwxyz"

func collationKey(s string) (primary, tertiary []int) {
	for _, r := range s {
		switch {
		case r >= 'A' && r <= 'Z':
			primary = append(primary, strings.IndexRune(asciiPrimary, r-'A'+'a'))
			tertiary = append(tertiary, 1)
		case r < utf8.RuneSelf:
			p := strings.IndexRune(asciiPrimary, r)
			if p < 0 { // ignorable
				continue
			}
			primary = append(primary, p)
			tertiary = append(tertiary, 0)
		default:
			primary = append(primary, len(asciiPrimary)+int(r))
			tertiary = append(tertiary, 0)
		}
	}
	return primary, tertiary
}

// compareUTF16 is the order of Array.prototype.sort without a comparator:
// by UTF-16 code units.
func compareUTF16(a, b string) int {
	return slices.Compare(utf16.Encode([]rune(a)), utf16.Encode([]rune(b)))
}

// isArrayIndex says whether an object key is an array index (a canonical
// integer from 0 to 2³²−2): Object.entries lists those first, in numeric
// order, and the other keys after them in the order they were added.
func isArrayIndex(k string) bool {
	if k == "0" {
		return true
	}
	if k == "" || len(k) > 10 || k[0] < '1' || k[0] > '9' {
		return false
	}
	for i := 1; i < len(k); i++ {
		if k[i] < '0' || k[i] > '9' {
			return false
		}
	}
	n, err := strconv.ParseUint(k, 10, 64)
	return err == nil && n <= math.MaxUint32-1
}

// jsToString is String(v) for a value decoded from JSON.
func jsToString(v any) string {
	switch v := v.(type) {
	case nil:
		return "null"
	case string:
		return v
	case bool:
		return strconv.FormatBool(v)
	case float64:
		return jsNumber(v)
	case []any:
		parts := make([]string, len(v))
		for i, e := range v {
			if e != nil {
				parts[i] = jsToString(e)
			}
		}
		return strings.Join(parts, ",")
	default:
		return "[object Object]"
	}
}

// truthy is JavaScript's truthiness of a value decoded from JSON (absent
// is undefined: false).
func truthy(v any, present bool) bool {
	switch v := v.(type) {
	case nil:
		return false
	case string:
		return v != ""
	case bool:
		return v
	case float64:
		return v != 0 && !math.IsNaN(v)
	default:
		return present
	}
}

// maxTimeMs is the largest time value a JavaScript Date holds.
const maxTimeMs = 8.64e15

// parseDate is Date.parse for the ECMAScript date-time string format, as
// bun's JavaScriptCore reads it: YYYY, YYYY-MM or YYYY-MM-DD (or a year of
// ±YYYYYY, not -000000), optionally followed by T (or t, or a space) and
// HH:mm, HH:mm:ss or HH:mm:ss.f (any number of fraction digits; the first
// three count), then optionally Z (or z), ±HH:mm or ±HHmm. A date alone is
// UTC; a date-time without an offset is local time, read in loc. 24:00 is
// the end of the day; a day up to 31 is accepted in any month and rolls
// over (2026-02-30 is 2 March), as JavaScriptCore does. ok is false where
// Date.parse gives NaN, and also for the forms outside this format that
// JavaScriptCore's fallback parser reads ("Tue, 06 Oct 2026", "2026/10/06",
// "2026-10-06Z"): the server never writes those, and they are not read.
func parseDate(s string, loc *time.Location) (ms float64, ok bool) {
	p := dateParser{s: s}
	year, ok := p.year()
	if !ok {
		return 0, false
	}
	month, day := 1, 1
	if p.accept('-') {
		if month, ok = p.digits(2); !ok || month < 1 || month > 12 {
			return 0, false
		}
		if p.accept('-') {
			if day, ok = p.digits(2); !ok || day < 1 || day > 31 {
				return 0, false
			}
		}
	}
	if p.done() {
		return clip(utcMillis(year, month, day, 0, 0, 0, 0))
	}
	if !p.accept('T') && !p.accept('t') && !p.accept(' ') {
		return 0, false
	}
	hour, ok1 := p.digits(2)
	ok2 := p.accept(':')
	minute, ok3 := p.digits(2)
	if !ok1 || !ok2 || !ok3 {
		return 0, false
	}
	second, milli := 0, 0
	if p.accept(':') {
		if second, ok = p.digits(2); !ok {
			return 0, false
		}
		if p.accept('.') {
			start := p.i
			for p.i < len(p.s) && isDigit(p.s[p.i]) {
				p.i++
			}
			fraction := p.s[start:p.i]
			if fraction == "" {
				return 0, false
			}
			fraction = (fraction + "00")[:3]
			milli, _ = strconv.Atoi(fraction)
		}
	}
	if minute > 59 || second > 59 || hour > 24 || (hour == 24 && (minute != 0 || second != 0 || milli != 0)) {
		return 0, false
	}
	if p.done() {
		if loc == nil {
			loc = time.UTC
		}
		return clip(float64(time.Date(year, time.Month(month), day, hour, minute, second, milli*int(time.Millisecond), loc).UnixMilli()))
	}
	offset := 0
	switch {
	case p.accept('Z'), p.accept('z'):
	case p.peek('+'), p.peek('-'):
		sign := 1
		if p.accept('-') {
			sign = -1
		} else {
			p.accept('+')
		}
		oh, ok1 := p.digits(2)
		p.accept(':')
		om, ok2 := p.digits(2)
		if !ok1 || !ok2 || oh > 23 || om > 59 {
			return 0, false
		}
		offset = sign * (oh*60 + om)
	default:
		return 0, false
	}
	if !p.done() {
		return 0, false
	}
	return clip(utcMillis(year, month, day, hour, minute, second, milli) - float64(offset)*60_000)
}

// clip is TimeClip: a time value beyond ±8.64e15 ms is no date.
func clip(ms float64) (float64, bool) {
	if math.Abs(ms) > maxTimeMs {
		return 0, false
	}
	return ms, true
}

// utcMillis is the time value of a UTC date and time (day and hour may run
// past the month's or day's end: they roll over). Every term is an exact
// integer in a float64.
func utcMillis(year, month, day, hour, minute, second, milli int) float64 {
	days := daysFromCivil(year, month, 1) + int64(day-1)
	return float64(days)*86_400_000 + float64(hour)*3_600_000 + float64(minute)*60_000 + float64(second)*1000 + float64(milli)
}

// daysFromCivil is the number of days from 1970-01-01 to a date of the
// proleptic Gregorian calendar.
func daysFromCivil(y, m, d int) int64 {
	if m <= 2 {
		y--
	}
	era := y / 400
	if y < 0 && y%400 != 0 {
		era--
	}
	yoe := y - era*400
	mp := (m + 9) % 12
	doy := (153*mp+2)/5 + d - 1
	doe := yoe*365 + yoe/4 - yoe/100 + doy
	return int64(era)*146097 + int64(doe) - 719468
}

type dateParser struct {
	s string
	i int
}

func (p *dateParser) done() bool { return p.i == len(p.s) }

func (p *dateParser) peek(c byte) bool { return p.i < len(p.s) && p.s[p.i] == c }

func (p *dateParser) accept(c byte) bool {
	if p.peek(c) {
		p.i++
		return true
	}
	return false
}

func (p *dateParser) digits(n int) (int, bool) {
	if p.i+n > len(p.s) {
		return 0, false
	}
	v := 0
	for _, c := range []byte(p.s[p.i : p.i+n]) {
		if !isDigit(c) {
			return 0, false
		}
		v = v*10 + int(c-'0')
	}
	p.i += n
	return v, true
}

// year is YYYY or ±YYYYYY (-000000 is not a year).
func (p *dateParser) year() (int, bool) {
	if p.peek('+') || p.peek('-') {
		negative := p.s[p.i] == '-'
		p.i++
		y, ok := p.digits(6)
		if !ok || (negative && y == 0) {
			return 0, false
		}
		if negative {
			y = -y
		}
		return y, true
	}
	return p.digits(4)
}

func isDigit(c byte) bool { return c >= '0' && c <= '9' }

// ValidDate says whether s is a date-time a window can be bounded by:
// Date.parse would not give NaN (loc reads one without an offset).
func ValidDate(s string, loc *time.Location) bool {
	_, ok := parseDate(s, loc)
	return ok
}
