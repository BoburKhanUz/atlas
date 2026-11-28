package wardrobe_test

import (
	"testing"

	"lookly/internal/wardrobe"
)

// Numbers are stored as JavaScript's JSON.stringify writes them (values
// worked out by hand from the ECMAScript rules: plain digits from 1e-6 to
// below 1e21, else the shortest exponent form).
func TestNumbersAreWrittenAsJavaScriptWritesThem(t *testing.T) {
	t.Parallel()
	for v, want := range map[float64]string{
		0: "0", 1: "1", 0.91: "0.91", 0.69: "0.69", 0.123456789: "0.123456789", 0.30000000000000004: "0.30000000000000004",
		0.000001: "0.000001", 0.0000015: "0.0000015", 0.0000001: "1e-7", 1.5e-10: "1.5e-10", 5e-324: "5e-324",
		1e20: "100000000000000000000", 1e21: "1e+21", 1.25e22: "1.25e+22",
	} {
		if got := wardrobe.JSNumberText(v); got != want {
			t.Errorf("%v: %q, want %q", v, got, want)
		}
	}
}
