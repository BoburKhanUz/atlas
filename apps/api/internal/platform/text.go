package platform

import "strings"

// StripNUL removes the NUL character, which PostgreSQL refuses in text, from
// a value a client sent, so that it can be stored.
func StripNUL(s string) string { return strings.ReplaceAll(s, "\x00", "") }
