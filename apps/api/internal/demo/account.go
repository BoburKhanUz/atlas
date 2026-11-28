package demo

import (
	"errors"
	"log/slog"
	"strconv"
	"strings"

	"lookly/internal/auth"
	"lookly/internal/platform"
)

// MinPasswordLength is the shortest password registration takes, in
// characters as JavaScript counts them.
const MinPasswordLength = 8

// Account is the demo account's e-mail and password. It never prints its
// password: fmt and slog show the e-mail only.
type Account struct {
	Email    string
	Password string
}

func (a Account) String() string { return a.Email + " (password not shown)" }

// GoString is what %#v prints.
func (a Account) GoString() string {
	return "demo.Account{Email: " + strconv.Quote(a.Email) + ", Password: (not shown)}"
}

// LogValue is what slog records.
func (a Account) LogValue() slog.Value { return slog.StringValue(a.String()) }

// Credentials reads the demo account from DEMO_EMAIL and DEMO_PASSWORD, by
// the rules of registration: an e-mail the API takes (stored trimmed and in
// lower case, as sign-in looks it up), a password of at least 8 characters
// and at most 72 bytes (what bcrypt reads). The errors never quote the
// password.
func Credentials(getenv func(string) (string, bool)) (Account, error) {
	raw, _ := getenv("DEMO_EMAIL")
	email := strings.ToLower(strings.TrimSpace(raw))
	if !platform.ValidEmail(email) {
		return Account{}, errors.New("DEMO_EMAIL is missing or not an e-mail address the API takes")
	}
	password, _ := getenv("DEMO_PASSWORD")
	if platform.UTF16Length(password) < MinPasswordLength {
		return Account{}, errors.New("DEMO_PASSWORD is missing or shorter than 8 characters")
	}
	if len(password) > auth.MaxPasswordBytes {
		return Account{}, errors.New("DEMO_PASSWORD is longer than 72 bytes, more than bcrypt reads: choose a shorter one")
	}
	return Account{Email: email, Password: password}, nil
}
