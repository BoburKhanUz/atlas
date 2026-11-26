package httpapi

import (
	"log/slog"
	"net/http"
	"time"

	"lookly/internal/httpapi/contract"
)

// Gated wraps next as the router wraps a route of the given pattern: the
// middleware (Wrap), the route's name, then the gate. Tests use it for routes
// later stages add (the gate's default: a session and a current consent).
func Gated(g *Gate, log *slog.Logger, route string, next http.Handler) http.Handler {
	return Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if info := infoFrom(r.Context()); info != nil {
			info.route = route
		}
		g.middleware(next).ServeHTTP(w, r)
	}), log)
}

// IdentityFrom is the caller the gate authenticated.
var IdentityFrom = identityFrom

// RouteRules describes the gate's table: route pattern → "public",
// "optional" or "required", with " exempt" appended for routes served
// although the consent is out of date.
func RouteRules() map[string]string {
	out := map[string]string{}
	for pattern, rule := range routes {
		name := map[access]string{public: "public", sessionOptional: "optional", sessionRequired: "required"}[rule.access]
		if rule.consentExempt {
			name += " exempt"
		}
		out[pattern] = name
	}
	return out
}

// ServedRoutes are the patterns the generated router registers, and the
// media route served by hand.
func ServedRoutes() []string {
	m := &recordingMux{}
	contract.HandlerWithOptions(contract.NewStrictHandler(nil, nil), contract.StdHTTPServerOptions{BaseRouter: m})
	return append(m.patterns, mediaRoute)
}

type recordingMux struct{ patterns []string }

func (m *recordingMux) HandleFunc(pattern string, _ func(http.ResponseWriter, *http.Request)) {
	m.patterns = append(m.patterns, pattern)
}

func (m *recordingMux) ServeHTTP(http.ResponseWriter, *http.Request) {}

// TerminalCodes are the refresh refusals that clear a web client's cookies.
func TerminalCodes() []string {
	var codes []string
	for code := range terminal {
		codes = append(codes, string(code))
	}
	return codes
}

// WrapWithTimeout is Wrap with another request timeout.
func WrapWithTimeout(next http.Handler, log *slog.Logger, timeout time.Duration) http.Handler {
	return wrap(next, log, timeout)
}
