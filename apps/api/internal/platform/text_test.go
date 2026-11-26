package platform_test

import (
	"testing"

	"lookly/internal/platform"
)

func TestStripNUL(t *testing.T) {
	t.Parallel()
	for in, want := range map[string]string{"": "", "Aziza": "Aziza", "A\x00ziza\x00": "Aziza", "\x00": "", "ўзбек\x00 😀": "ўзбек 😀"} {
		if got := platform.StripNUL(in); got != want {
			t.Errorf("StripNUL(%q) = %q, want %q", in, got, want)
		}
	}
}
