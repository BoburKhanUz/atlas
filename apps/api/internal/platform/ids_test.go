package platform_test

import (
	"strings"
	"testing"

	"lookly/internal/platform"
)

func TestNewID(t *testing.T) {
	t.Parallel()
	seen := map[string]bool{}
	used := map[rune]bool{}
	for range 2000 {
		id := platform.NewID()
		if len(id) != 25 || id[0] != 'c' || strings.Trim(id, "abcdefghijklmnopqrstuvwxyz0123456789") != "" {
			t.Fatalf("id %q", id)
		}
		if seen[id] {
			t.Fatalf("id %q twice", id)
		}
		seen[id] = true
		for _, r := range id[1:] {
			used[r] = true
		}
	}
	// 48 000 random characters use the whole alphabet.
	if len(used) != 36 {
		t.Errorf("%d of 36 characters used", len(used))
	}
}
