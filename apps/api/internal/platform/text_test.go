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

func TestUTF16LengthCountsAsJavaScriptDoes(t *testing.T) {
	t.Parallel()
	// "😀" is outside the basic plane: two units, as "😀".length is 2.
	for in, want := range map[string]int{"": 0, "Aziza": 5, "ўзбек": 5, "😀": 2, "a😀b": 4, "ʻ’": 2} {
		if got := platform.UTF16Length(in); got != want {
			t.Errorf("UTF16Length(%q) = %d, want %d", in, got, want)
		}
	}
}

func TestValidEmailIsTheContractsPattern(t *testing.T) {
	t.Parallel()
	for in, want := range map[string]bool{
		"demo@lookly.uz": true, "a.b+c_d'e-f@sub.example.com": true, "A@B.CO": true,
		"": false, "demo": false, "demo@lookly": false, "demo@lookly.u": false, ".demo@lookly.uz": false,
		"de..mo@lookly.uz": false, "demo.@lookly.uz": false, "de mo@lookly.uz": false, "demo@-lookly.uz": false,
		"demo@lookly.uz ": false, "dëmo@lookly.uz": false,
	} {
		if got := platform.ValidEmail(in); got != want {
			t.Errorf("ValidEmail(%q) = %v, want %v", in, got, want)
		}
	}
}
