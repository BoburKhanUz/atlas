package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"lookly/internal/platform"
)

const (
	// maxRetryAfter caps what a Retry-After header may ask.
	maxRetryAfter = 60 * time.Second
	// maxAnswerBytes bounds what is read of a provider's answer (a real one
	// is a few kilobytes).
	maxAnswerBytes = 8 << 20
)

var wholeSeconds = regexp.MustCompile(`^[0-9]+$`)

// parseRetryAfter reads a Retry-After header: whole seconds, or a date
// (RFC 9110; RFC 3339 too, as JavaScript's Date.parse reads it). Anything
// else is no value.
func parseRetryAfter(value string, now time.Time) *time.Duration {
	trimmed := strings.TrimFunc(value, platform.IsJSWhiteSpace)
	if trimmed == "" {
		return nil
	}
	wait := maxRetryAfter
	if wholeSeconds.MatchString(trimmed) {
		if seconds, err := strconv.ParseInt(trimmed, 10, 64); err == nil && seconds < int64(maxRetryAfter/time.Second) {
			wait = time.Duration(seconds) * time.Second
		}
		return &wait
	}
	at, err := http.ParseTime(trimmed)
	if err != nil {
		if at, err = time.Parse(time.RFC3339, trimmed); err != nil {
			return nil
		}
	}
	wait = min(max(0, at.Sub(now)), maxRetryAfter)
	return &wait
}

// errorForStatus classifies an HTTP status that is not a success.
func errorForStatus(provider string, status int, retryAfter string, now time.Time) *Error {
	switch {
	case status == http.StatusTooManyRequests:
		return &Error{Kind: RateLimited, Provider: provider, Status: status, RetryAfter: parseRetryAfter(retryAfter, now)}
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		return &Error{Kind: Auth, Provider: provider, Status: status}
	case status == 500 || status == 502 || status == 503 || status == 504:
		return &Error{Kind: Unavailable, Provider: provider, Status: status}
	case status >= 400 && status < 500:
		return &Error{Kind: InvalidRequest, Provider: provider, Status: status}
	}
	return &Error{Kind: ProviderError, Provider: provider, Status: status}
}

// transport posts JSON to a provider: one attempt with a time limit.
type transport struct {
	client *http.Client
	now    func() time.Time
}

func newTransport() transport {
	return transport{
		now: time.Now,
		client: &http.Client{
			// A provider answers where it is asked: an answer that sends us
			// elsewhere is a failure (the key would follow it).
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
	}
}

// encode is JSON.stringify of a request body: Go's encoding without its
// escaping of <, > and &. One difference stays, in bytes only: Go writes
// U+2028 and U+2029 as \u2028 and \u2029 (JSON.stringify writes them as
// they are); the provider reads the same text (docs/plan/B6.md).
func encode(body any) ([]byte, error) {
	var b bytes.Buffer
	e := json.NewEncoder(&b)
	e.SetEscapeHTML(false)
	if err := e.Encode(body); err != nil {
		return nil, err
	}
	return bytes.TrimSuffix(b.Bytes(), []byte("\n")), nil
}

// postJSON posts body as JSON and returns the body of a 2xx answer, which
// the adapter decodes. A caller that has given up, or an attempt past its
// time limit, sends nothing more and is that failure. The answer is never
// copied into an error (it can repeat the prompt).
func (t transport) postJSON(ctx context.Context, provider, url string, headers [][2]string, body any, timeout time.Duration) (json.RawMessage, error) {
	payload, err := encode(body)
	if err != nil {
		return nil, &Error{Kind: InvalidRequest, Provider: provider, Detail: "the request cannot be encoded"}
	}
	attempt, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	// failure classifies an error of the exchange: the caller gave up, the
	// attempt's time ran out, or the network failed.
	failure := func(otherwise *Error) *Error {
		switch {
		case ctx.Err() != nil:
			return &Error{Kind: Cancelled, Provider: provider}
		case attempt.Err() != nil:
			return &Error{Kind: Timeout, Provider: provider}
		}
		return otherwise
	}
	request, err := http.NewRequestWithContext(attempt, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return nil, &Error{Kind: Config, Provider: provider, Detail: "the provider's address is not valid"}
	}
	request.Header.Set("Content-Type", "application/json")
	for _, h := range headers {
		request.Header.Set(h[0], h[1])
	}
	response, err := t.client.Do(request)
	if err != nil {
		return nil, failure(&Error{Kind: Network, Provider: provider})
	}
	defer func() { _ = response.Body.Close() }() // nothing to do about a failed close
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return nil, errorForStatus(provider, response.StatusCode, response.Header.Get("Retry-After"), t.now())
	}
	// What is past the bound is not read: the adapters find what is left
	// to be no JSON.
	answer, err := io.ReadAll(io.LimitReader(response.Body, maxAnswerBytes))
	if err != nil {
		return nil, failure(notJSON(provider))
	}
	return answer, nil
}

// notJSON: a 2xx answer that is not JSON.
func notJSON(provider string) *Error {
	return &Error{Kind: MalformedResponse, Provider: provider, Detail: "response is not JSON"}
}

// jsonOutput checks that a model's text is JSON (structured output) and
// returns it compact.
func jsonOutput(provider, text string) (json.RawMessage, error) {
	var compact bytes.Buffer
	if err := json.Compact(&compact, []byte(text)); err != nil {
		return nil, &Error{Kind: MalformedResponse, Provider: provider, Detail: "output is not valid JSON"}
	}
	return compact.Bytes(), nil
}

// The loose reading of a provider's answer, as JavaScript reads it: a
// member of something that is no object is absent.

func member(v any, name string) any {
	if object, ok := v.(map[string]any); ok {
		return object[name]
	}
	return nil
}

func list(v any) ([]any, bool) {
	items, ok := v.([]any)
	return items, ok
}

// truthy is JavaScript's truthiness of a decoded JSON value.
func truthy(v any) bool {
	switch value := v.(type) {
	case nil:
		return false
	case bool:
		return value
	case float64:
		return value != 0 // JSON has no NaN
	case string:
		return value != ""
	}
	return true
}

// count is a token count: a number that is not negative.
func count(v any) *float64 {
	if n, ok := v.(float64); ok && n >= 0 {
		return &n
	}
	return nil
}

// encodeURIComponent is JavaScript's.
func encodeURIComponent(s string) string {
	const upper = "0123456789ABCDEF"
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= 'A' && c <= 'Z', c >= 'a' && c <= 'z', c >= '0' && c <= '9', strings.IndexByte("-_.!~*'()", c) >= 0:
			b.WriteByte(c)
		default:
			b.WriteByte('%')
			b.WriteByte(upper[c>>4])
			b.WriteByte(upper[c&15])
		}
	}
	return b.String()
}
