package httpapi

import (
	"net/http"
	"net/netip"
	"net/url"
	"regexp"
	"strings"
	"unicode/utf8"

	"lookly/internal/auth"
	"lookly/internal/session"
)

// What a request says about its sender, read as the Next.js API reads it
// (apps/web/src/lib/session.ts, rate-limit.ts): testdata/golden/auth-http.json
// holds its decisions and the tests here reproduce them.

const (
	// AccessCookie and RefreshCookie are the web client's HttpOnly cookies.
	AccessCookie  = "atlas_at"
	RefreshCookie = "atlas_rt"
	// ClientHeader selects the response format: "mobile" for tokens in JSON
	// bodies, anything else (or nothing) for cookies. It is not a security
	// boundary: the stored family's client type decides.
	ClientHeader = "X-Atlas-Client"
)

// header is a request header as the Fetch API gives it: every value of the
// name, joined with ", "; present is false when the header was not sent.
func header(r *http.Request, name string) (value string, present bool) {
	values := r.Header.Values(name)
	return strings.Join(values, ", "), len(values) > 0
}

var cookiePairSeparator = regexp.MustCompile(`; *`)

// cookie is the value of a request cookie. Of several with one name the last
// counts; a value that is not valid percent-encoded UTF-8 is skipped; quotes
// are part of the value. (net/http's own parser takes the first and strips
// quotes.)
func cookie(r *http.Request, name string) (value string, present bool) {
	// Several Cookie header lines are one list, as Node joins them.
	all := strings.Join(r.Header.Values("Cookie"), "; ")
	for _, pair := range cookiePairSeparator.Split(all, -1) {
		if pair == "" {
			continue
		}
		key, raw, hasValue := strings.Cut(pair, "=")
		if key != name {
			continue
		}
		if !hasValue {
			raw = "true"
		}
		decoded, err := url.PathUnescape(raw)
		if err != nil || !utf8.ValidString(decoded) {
			continue
		}
		value, present = decoded, true
	}
	return value, present
}

// ClientType is the mode a request asks for.
func ClientType(r *http.Request) session.ClientType {
	value, _ := header(r, ClientHeader)
	if strings.EqualFold(strings.TrimSpace(value), string(session.Mobile)) {
		return session.Mobile
	}
	return session.Web
}

// Via says where a request's access token came from.
type Via string

const (
	ViaNone   Via = ""
	ViaBearer Via = "bearer"
	ViaCookie Via = "cookie"
)

// Credential returns the access token a request presents. An Authorization
// header, when present, is the only credential considered, even if it is
// empty or of another scheme: there is no fallback to the cookie. That is
// what makes requests with the header safe to exempt from the cross-site
// guard (a page of another site cannot add it).
func Credential(r *http.Request) (token string, via Via) {
	if value, present := header(r, "Authorization"); present {
		token, _ = auth.BearerToken(value)
		return token, ViaBearer
	}
	if token, _ := cookie(r, AccessCookie); token != "" {
		return token, ViaCookie
	}
	return "", ViaNone
}

// ClientAddr is the client's address for rate limits, or false when it
// cannot be trusted. Forwarding headers are set by whoever sends the
// request unless a reverse proxy overwrites them, so they are read only
// with trustProxy (TRUST_PROXY=1). The proxy appends the peer it saw to
// X-Forwarded-For: the right-most entry is the one it vouches for.
func ClientAddr(r *http.Request, trustProxy bool) (netip.Addr, bool) {
	if !trustProxy {
		return netip.Addr{}, false
	}
	last := ""
	if forwarded, _ := header(r, "X-Forwarded-For"); forwarded != "" {
		for _, part := range strings.Split(forwarded, ",") {
			if part = strings.TrimSpace(part); part != "" {
				last = part
			}
		}
	}
	if last == "" {
		last, _ = header(r, "X-Real-Ip")
	}
	addr, err := netip.ParseAddr(strings.TrimSpace(last))
	if err != nil {
		return netip.Addr{}, false
	}
	// One spelling per client: 1.2.3.4 whether or not it came IPv4-mapped.
	return addr.Unmap().WithZone(""), true
}

// CrossSiteWrite is the cross-site request guard: a state-changing request
// without an Authorization header whose Origin names another host. Browsers
// send Origin on every cross-site write, form posts included, and a page of
// another site cannot add an Authorization header, so this refuses what
// another site can make a browser send and nothing our own clients send (the
// web app is same-origin; the mobile app sends no Origin).
//
// It does not look at the cookies. The Next.js API guarded only requests
// that carried a session cookie, but those cookies are SameSite=Lax and a
// browser never sends them on a cross-site write; what such a write can
// still do is set them (a posted sign-in form) or clear them (sign-out).
//
// A request without an Origin header passes. An Origin that cannot be read
// as scheme://host, "null" included, is never our own.
func CrossSiteWrite(r *http.Request, trustProxy bool) bool {
	switch r.Method {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
	default:
		return false
	}
	if _, present := header(r, "Authorization"); present {
		return false
	}
	origin, _ := header(r, "Origin")
	if origin == "" {
		return false
	}
	host, ok := originHost(origin)
	return !ok || host != requestHost(r, trustProxy)
}

// originHost is the host[:port] of an Origin header as a browser writes it:
// lower case, without the scheme's default port.
func originHost(origin string) (string, bool) {
	u, err := url.Parse(origin)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return "", false
	}
	host := strings.ToLower(u.Host)
	switch {
	case u.Scheme == "https" && u.Port() == "443":
		host = strings.TrimSuffix(host, ":443")
	case u.Scheme == "http" && u.Port() == "80":
		host = strings.TrimSuffix(host, ":80")
	}
	return host, true
}

// requestHost is the host the client addressed: behind the trusted proxy,
// the first X-Forwarded-Host; otherwise the Host header.
func requestHost(r *http.Request, trustProxy bool) string {
	if trustProxy {
		forwarded, _ := header(r, "X-Forwarded-Host")
		if first, _, _ := strings.Cut(forwarded, ","); strings.TrimSpace(first) != "" {
			return strings.ToLower(strings.TrimSpace(first))
		}
	}
	return strings.ToLower(r.Host)
}
