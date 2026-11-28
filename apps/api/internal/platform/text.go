package platform

import (
	"regexp"
	"strings"
)

// StripNUL removes the NUL character, which PostgreSQL refuses in text, from
// a value a client sent, so that it can be stored.
func StripNUL(s string) string { return strings.ReplaceAll(s, "\x00", "") }

// UTF16Length is a string's length as JavaScript counts it (the request
// schemas' limits are in those units): a character outside the basic plane
// is two.
func UTF16Length(s string) int {
	n := 0
	for _, r := range s {
		n++
		if r > 0xFFFF {
			n++
		}
	}
	return n
}

// emailPattern is the contract's email pattern (LoginRequest and
// RegisterRequest), split because Go's regular expressions have no
// look-ahead: ValidEmail adds that the address does not start with a dot
// and has no two dots in a row.
var emailPattern = regexp.MustCompile(`^[A-Za-z0-9_'+\-.]*[A-Za-z0-9_+\-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$`)

// ValidEmail reports whether s is an email address the API takes.
func ValidEmail(s string) bool {
	return !strings.HasPrefix(s, ".") && !strings.Contains(s, "..") && emailPattern.MatchString(s)
}
