package platform_test

import (
	"math"
	"testing"

	"lookly/internal/platform"
)

func TestRoundHalfUpIsJavaScriptsMathRound(t *testing.T) {
	t.Parallel()
	// Math.round in a JavaScript engine: a half goes towards +∞.
	for x, want := range map[float64]float64{
		0: 0, 0.4: 0, 0.5: 1, 0.6: 1, 1.5: 2, 2.5: 3, -0.4: 0, -0.5: 0, -0.6: -1, -1.5: -1, -2.5: -2, -2.6: -3,
		0.49999999999999994: 0, 6.666666666666667: 7, 1e15 + 0.5: 1e15 + 1, -1e15 - 0.5: -1e15,
	} {
		if got := platform.RoundHalfUp(x); got != want {
			t.Errorf("RoundHalfUp(%v) = %v, want %v", x, got, want)
		}
	}
	if !math.IsNaN(platform.RoundHalfUp(math.NaN())) || !math.IsInf(platform.RoundHalfUp(math.Inf(1)), 1) {
		t.Error("NaN and the infinities are themselves")
	}
}
