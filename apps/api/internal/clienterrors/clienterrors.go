// Package clienterrors is the apps' error reports (POST
// /api/v1/client-errors): our own crash monitoring, no third party. Each
// report becomes one "client error" line in the server log; nothing is
// stored. The apps scrub reports before sending; the same rules run again
// here, then the Next.js log's redaction, as the Next.js server does
// (apps/web/src/server/client-errors.ts, src/lib/error-scrub.ts,
// src/server/log.ts), held to it by testdata/golden/client-errors.json.
package clienterrors

import (
	"context"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"time"

	"lookly/internal/ratelimit"
)

// Message is the log line's message.
const Message = "client error"

// Report is one error report, as the request rules left it.
type Report struct {
	Platform, AppVersion string
	OSVersion            *string
	Kind                 string
	Fatal                bool
	ErrorType, Message   string
	Stack, Route         *string
	OccurredAt           *time.Time
}

// jsSpace is what JavaScript's \s matches (Go's \s is ASCII only).
const jsSpace = `\t\n\v\f\r \x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}`

// The scrubbing rules (error-scrub.ts): e-mail addresses, Bearer values,
// JWTs, URL query strings and long opaque values.
var (
	scrubEmail  = regexp.MustCompile(`[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}`)
	scrubBearer = regexp.MustCompile(`(?i)Bearer[` + jsSpace + `]+[A-Za-z0-9._~+/=-]+`)
	jwt         = regexp.MustCompile(`eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}`)
	urlQuery    = regexp.MustCompile(`(https?://[^` + jsSpace + `?#"'<>]+)\?[^` + jsSpace + `#"'<>]*`)
	opaque      = regexp.MustCompile(`[A-Za-z0-9_+=-]{32,}`)
	idSegment   = regexp.MustCompile(`^[A-Za-z0-9_-]{16,}$`)

	// The log's own redaction (log.ts).
	logBearer      = regexp.MustCompile(`(?i)Bearer[` + jsSpace + `]+[A-Za-z0-9._-]+`)
	signedURLQuery = regexp.MustCompile(`([?&](?:sig|exp)=)[^&` + jsSpace + `"]+`)
)

// Scrub drops what an error text may quote of a request.
func Scrub(s string) string {
	s = scrubBearer.ReplaceAllLiteralString(s, "Bearer [REDACTED]")
	s = jwt.ReplaceAllLiteralString(s, "[REDACTED_JWT]")
	s = scrubEmail.ReplaceAllLiteralString(s, "[REDACTED_EMAIL]")
	s = urlQuery.ReplaceAllString(s, "${1}?[REDACTED]")
	return opaque.ReplaceAllLiteralString(s, "[REDACTED]")
}

// NormalizeRoute is a screen path without its query or fragment, each id
// (16 or more of A-Z, a-z, 0-9, _ and -) as :id.
func NormalizeRoute(route string) string {
	route, _, _ = strings.Cut(route, "?")
	route, _, _ = strings.Cut(route, "#")
	segments := strings.Split(route, "/")
	for i, s := range segments {
		if idSegment.MatchString(s) {
			segments[i] = ":id"
		}
	}
	return strings.Join(segments, "/")
}

// redact is the Next.js log's redaction of every text it writes.
func redact(s string) string {
	s = logBearer.ReplaceAllLiteralString(s, "Bearer [REDACTED]")
	s = jwt.ReplaceAllLiteralString(s, "[REDACTED_JWT]")
	s = signedURLQuery.ReplaceAllString(s, "${1}[REDACTED]")
	return scrubEmail.ReplaceAllLiteralString(s, "[REDACTED_EMAIL]")
}

// Fields are a report's log fields, in the Next.js order; an absent member
// is not written.
func Fields(r Report) []slog.Attr {
	attrs := []slog.Attr{slog.String("platform", redact(r.Platform)), slog.String("appVersion", redact(r.AppVersion))}
	if r.OSVersion != nil {
		attrs = append(attrs, slog.String("osVersion", redact(*r.OSVersion)))
	}
	attrs = append(attrs, slog.String("kind", redact(r.Kind)), slog.Bool("fatal", r.Fatal),
		slog.String("errorType", redact(Scrub(r.ErrorType))), slog.String("message", redact(Scrub(r.Message))))
	if r.Stack != nil && *r.Stack != "" {
		attrs = append(attrs, slog.String("stack", redact(Scrub(*r.Stack))))
	}
	if r.Route != nil && *r.Route != "" {
		attrs = append(attrs, slog.String("route", redact(NormalizeRoute(*r.Route))))
	}
	if r.OccurredAt != nil {
		attrs = append(attrs, slog.String("occurredAt", r.OccurredAt.UTC().Format(time.RFC3339Nano)))
	}
	return attrs
}

// Log writes one error line per report.
func Log(ctx context.Context, log *slog.Logger, reports []Report) {
	for _, r := range reports {
		log.LogAttrs(ctx, slog.LevelError, Message, Fields(r)...)
	}
}

// The limits (the Next.js route's): an app run sends at most 3 requests, a
// page load at most 10; the limit for everyone keeps a crash loop on many
// devices, or a flood, from pushing everything else out of the log.
var (
	PerAddress = ratelimit.Rule{Name: "client-errors:ip", Limit: 30, Window: 10 * time.Minute}
	ForAll     = ratelimit.Rule{Name: "client-errors:global", Limit: 300, Window: 10 * time.Minute}
)

// LimitedError: too many reports; RetryAfter says how long to wait.
type LimitedError struct{ RetryAfter time.Duration }

func (e *LimitedError) Error() string { return "client errors: too many reports" }

// Limiter counts the reports (*ratelimit.Limiter).
type Limiter interface {
	Take(ctx context.Context, hits ...ratelimit.Hit) (ratelimit.Decision, error)
}

// Service takes the reports.
type Service struct {
	limiter Limiter
	log     *slog.Logger
}

// NewService returns the service.
func NewService(limiter Limiter, log *slog.Logger) *Service {
	return &Service{limiter: limiter, log: log}
}

// Report logs the reports of a request from addr (the client's address,
// when it is known), within the limits.
func (s *Service) Report(ctx context.Context, addr string, reports []Report) error {
	hits := []ratelimit.Hit{ForAll.For("all")}
	if addr != "" {
		hits = append(hits, PerAddress.For(addr))
	}
	decision, err := s.limiter.Take(ctx, hits...)
	if err != nil {
		return fmt.Errorf("client errors: count: %w", err)
	}
	if !decision.Allowed {
		return &LimitedError{RetryAfter: decision.RetryAfter}
	}
	Log(ctx, s.log, reports)
	return nil
}
