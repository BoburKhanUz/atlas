// Package configtest gives tests a complete, valid environment for
// config.Load, so a new required variable is added in one place. The secrets
// are fixed test values, built here and used nowhere else.
package configtest

import (
	"bytes"
	"encoding/base64"
	"strings"
)

// JWTSecret and SessionEncKey are the secrets of Env.
var (
	JWTSecret     = strings.Repeat("test-jwt-", 5)
	SessionEncKey = base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{0x5a}, 32))
)

// Env returns the variables of a valid test configuration with the changes
// applied. A change to "<unset>" removes the variable.
func Env(changes map[string]string) map[string]string {
	vars := map[string]string{
		"LOOKLY_ENV":      "test",
		"DATABASE_URL":    "postgresql://lookly@localhost:5432/lookly",
		"JWT_SECRET":      JWTSecret,
		"SESSION_ENC_KEY": SessionEncKey,
	}
	for k, v := range changes {
		if v == "<unset>" {
			delete(vars, k)
		} else {
			vars[k] = v
		}
	}
	return vars
}

// Getenv is Env in the form config.Load takes.
func Getenv(changes map[string]string) func(string) (string, bool) {
	vars := Env(changes)
	return func(k string) (string, bool) {
		v, ok := vars[k]
		return v, ok
	}
}
