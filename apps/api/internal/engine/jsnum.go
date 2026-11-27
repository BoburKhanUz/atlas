package engine

import (
	"math"
	"slices"
	"strconv"
	"strings"
	"unicode/utf16"
)

// The TypeScript engine's arithmetic where JavaScript and Go differ.

// jsRound is Math.round: to the nearest integer, a half towards +∞.
func jsRound(x float64) float64 {
	r := math.Floor(x)
	if x-r >= 0.5 {
		r++
	}
	return r
}

// jsNumberString is String(number): the shortest digits that read back as
// the number, in decimal notation from 1e-6 up to (not including) 1e21 and
// in exponent notation outside.
func jsNumberString(f float64) string {
	switch {
	case math.IsNaN(f):
		return "NaN"
	case f == 0:
		return "0"
	case f < 0:
		return "-" + jsNumberString(-f)
	case math.IsInf(f, 1):
		return "Infinity"
	}
	mantissa, exponent, _ := strings.Cut(strconv.FormatFloat(f, 'e', -1, 64), "e")
	digits := strings.Replace(mantissa, ".", "", 1)
	e, _ := strconv.Atoi(exponent)
	k, n := len(digits), e+1 // the value is 0.digits × 10^n
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
	exp := sign + strconv.Itoa(max(n-1, 1-n))
	if k == 1 {
		return digits + "e" + exp
	}
	return digits[:1] + "." + digits[1:] + "e" + exp
}

// seedHash maps a client's seed onto a number (FNV-1a, 32 bit, over the
// seed as JavaScript writes it). It only picks a window of candidates.
func seedHash(seed float64) uint32 {
	h := uint32(0x811c9dc5)
	for _, unit := range utf16.Encode([]rune(jsNumberString(seed))) {
		h ^= uint32(unit)
		h *= 0x01000193
	}
	return h
}

// compareJS orders strings as JavaScript's < and > do: by UTF-16 code units.
func compareJS(a, b string) int {
	if a == b {
		return 0
	}
	return slices.Compare(utf16.Encode([]rune(a)), utf16.Encode([]rune(b)))
}

// clamp is Math.min(hi, Math.max(lo, v)).
func clamp(v, lo, hi float64) float64 { return math.Min(hi, math.Max(lo, v)) }
