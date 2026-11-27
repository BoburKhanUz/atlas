package ai

import (
	"strconv"
	"strings"
	"time"

	"lookly/internal/platform"
)

// Kind is why a provider call failed.
type Kind string

// The kinds. Timeout, Network, RateLimited and Unavailable are retried once.
const (
	Timeout           Kind = "timeout"            // the attempt ran past its time limit
	Network           Kind = "network"            // no HTTP answer arrived
	RateLimited       Kind = "rate_limited"       // HTTP 429
	Unavailable       Kind = "unavailable"        // HTTP 500, 502, 503, 504
	Auth              Kind = "auth"               // HTTP 401, 403
	Config            Kind = "config"             // our own configuration
	InvalidRequest    Kind = "invalid_request"    // another HTTP 4xx, or a request we would not send
	MalformedResponse Kind = "malformed_response" // a 2xx answer of another shape, or output that is not JSON
	ContentFiltered   Kind = "content_filtered"   // the provider refused or filtered the content
	Cancelled         Kind = "cancelled"          // the caller gave up
	ProviderError     Kind = "provider_error"     // any other HTTP failure
)

// Error is a failed provider call. Its text never holds a provider's
// answer, a prompt, user content or a key: only the provider, the kind,
// the HTTP status when there was one, and a fixed detail.
type Error struct {
	Kind     Kind
	Provider string
	// Status is the HTTP status (0: none).
	Status int
	// RetryAfter is what a 429 asked us to wait, when it said.
	RetryAfter *time.Duration
	Detail     string
}

func (e *Error) Error() string {
	parts := []string{e.Provider + ": " + string(e.Kind)}
	if e.Status != 0 {
		parts = append(parts, "HTTP "+strconv.Itoa(e.Status))
	}
	if e.Detail != "" {
		parts = append(parts, e.Detail)
	}
	return strings.Join(parts, " — ")
}

// Retryable says whether the failure is safe and likely to pass a second
// time.
func (e *Error) Retryable() bool {
	switch e.Kind {
	case Timeout, Network, RateLimited, Unavailable:
		return true
	}
	return false
}

// isBlank is JavaScript's !s.trim().
func isBlank(s string) bool { return strings.TrimFunc(s, platform.IsJSWhiteSpace) == "" }
