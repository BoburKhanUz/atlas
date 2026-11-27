package platform

import "math"

// RoundHalfUp is JavaScript's Math.round: to the nearest integer, a half
// towards +∞ (Go's math.Round takes a half away from zero). The Next.js
// API rounded this way; what is computed for both servers must agree.
func RoundHalfUp(x float64) float64 {
	r := math.Floor(x)
	if x-r >= 0.5 {
		r++
	}
	return r
}
