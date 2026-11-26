package httpapi_test

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"lookly/internal/auth"
	"lookly/internal/golden"
	"lookly/internal/httpapi"
)

// requestOf builds the request a vector describes: the Host header is the
// request's host, as net/http reads it; every other header is added in order.
func requestOf(method string, headers [][2]string) *http.Request {
	r := httptest.NewRequest(method, "http://internal.invalid/api/v1/auth/logout", nil)
	for _, h := range headers {
		if http.CanonicalHeaderKey(h[0]) == "Host" {
			r.Host = h[1]
			continue
		}
		r.Header.Add(h[0], h[1])
	}
	return r
}

// guardStricter: writes from another site that the Next.js API let through
// because they carried no session cookie. It guarded only requests that ride
// on a cookie, but a browser never sends these SameSite=Lax cookies on a
// cross-site write, so in a real browser that guard never fired: another
// site could still post a sign-in form and leave the browser signed in to an
// account of its own choosing, or clear the session cookies through
// sign-out. Go refuses every write whose Origin names another host.
var guardStricter = map[string]bool{
	"another site, no cookie":                             true,
	"another site, an unrelated cookie":                   true,
	"another site, a cookie whose name only starts alike": true,
}

func TestCrossSiteWriteMatchesTheTypeScriptGuard(t *testing.T) {
	t.Parallel()
	g := golden.LoadAuthHTTP(t)
	blocked, passed, stricter := 0, 0, 0
	for _, c := range g.CSRF {
		got := httpapi.CrossSiteWrite(requestOf(c.Method, c.Headers), c.TrustProxy)
		if guardStricter[c.Name] {
			if c.CrossOrigin || !got {
				t.Errorf("%s: listed as stricter in Go; TypeScript refused %v, Go refused %v", c.Name, c.CrossOrigin, got)
			}
			stricter++
			continue
		}
		if got != c.CrossOrigin {
			t.Errorf("%s: refused %v, want %v", c.Name, got, c.CrossOrigin)
		}
		if c.CrossOrigin {
			blocked++
		} else {
			passed++
		}
	}
	if blocked < 10 || passed < 10 || stricter != len(guardStricter) {
		t.Errorf("%d blocked, %d passed and %d of %d stricter vectors", blocked, passed, stricter, len(guardStricter))
	}
}

// Origins a browser never sends, which JavaScript's URL parser would still
// read as our own host. Go refuses them: a guard should fail closed on what
// it does not understand.
func TestOddOriginsAreCrossOrigin(t *testing.T) {
	t.Parallel()
	for _, origin := range []string{
		"https://app.example.uz:0443", // a port with a leading zero
		"https:\\\\app.example.uz",    // backslashes for slashes
		"//app.example.uz",            // no scheme (JavaScript refuses this one too)
		"https://APP.EXAMPLE.UZ:443/", // fine: only here to show the control below works
	} {
		r := requestOf(http.MethodPost, [][2]string{{"host", "app.example.uz"}, {"cookie", "atlas_at=a"}, {"origin", origin}})
		got := httpapi.CrossSiteWrite(r, false)
		want := origin != "https://APP.EXAMPLE.UZ:443/"
		if got != want {
			t.Errorf("origin %q: cross-origin %v, want %v", origin, got, want)
		}
	}
	// A request without a Host (HTTP/1.0) and an Origin without one never
	// meet as "the same, empty, host".
	r := requestOf(http.MethodPost, [][2]string{{"host", ""}, {"cookie", "atlas_at=a"}, {"origin", "file:///etc/passwd"}})
	if !httpapi.CrossSiteWrite(r, false) {
		t.Error("an Origin without a host passed against a request without a Host")
	}
}

func TestClientTypeMatchesTheTypeScriptRule(t *testing.T) {
	t.Parallel()
	g := golden.LoadAuthHTTP(t)
	for _, c := range g.ClientType {
		var headers [][2]string
		if c.Value != nil {
			headers = append(headers, [2]string{"x-atlas-client", *c.Value})
		}
		if got := httpapi.ClientType(requestOf(http.MethodPost, headers)); string(got) != c.ClientType {
			t.Errorf("X-Atlas-Client %v: %q, want %q", c.Value, got, c.ClientType)
		}
	}
	twice := requestOf(http.MethodPost, [][2]string{{"x-atlas-client", "mobile"}, {"x-atlas-client", "mobile"}})
	if got := httpapi.ClientType(twice); string(got) != g.ClientTypeTwice {
		t.Errorf("the header twice: %q, want %q", got, g.ClientTypeTwice)
	}
}

// addressStricter: where the Next.js API used the forwarded text whatever it
// was, Go uses it only when it is an address (it names a rate-limit bucket).
var addressStricter = map[string]bool{"trusted: not an address at all": true}

func TestClientAddrMatchesTheTypeScriptRule(t *testing.T) {
	t.Parallel()
	g := golden.LoadAuthHTTP(t)
	stricter := 0
	for _, c := range g.ClientIP {
		addr, ok := httpapi.ClientAddr(requestOf(http.MethodPost, c.Headers), c.TrustProxy)
		if addressStricter[c.Name] {
			if c.IP == nil || ok {
				t.Errorf("%s: listed as stricter in Go; TypeScript %v, Go %v %v", c.Name, c.IP, addr, ok)
			}
			stricter++
			continue
		}
		switch {
		case c.IP == nil && ok:
			t.Errorf("%s: %s, want none", c.Name, addr)
		case c.IP != nil && (!ok || addr.String() != *c.IP):
			t.Errorf("%s: %v %v, want %s", c.Name, addr, ok, *c.IP)
		}
	}
	if stricter != len(addressStricter) {
		t.Errorf("%d of %d stricter cases are in the vectors", stricter, len(addressStricter))
	}
}

func TestCredentialMatchesTheTypeScriptAuthentication(t *testing.T) {
	t.Parallel()
	g := golden.LoadAuthHTTP(t)
	tokens := auth.NewTokens([]byte(g.JWTSecret))
	now := time.Unix(g.GeneratedAtSeconds, 0)
	seen := map[string]int{}
	for _, c := range g.Auth {
		token, via := httpapi.Credential(requestOf(http.MethodGet, c.Headers))
		wantVia := ""
		if c.Via != nil {
			wantVia = *c.Via
		}
		if string(via) != wantVia {
			t.Errorf("%s: via %q, want %q", c.Name, via, wantVia)
		}
		claims, ok := tokens.Verify(token, now)
		switch {
		case c.User == nil && ok:
			t.Errorf("%s: authenticated as %+v, want nobody", c.Name, claims)
		case c.User != nil && (!ok || claims.Sub != c.User.Sub || claims.Email != c.User.Email || claims.SID != c.User.SID):
			t.Errorf("%s: %+v %v, want %+v", c.Name, claims, ok, *c.User)
		}
		seen[wantVia]++
	}
	if seen["bearer"] == 0 || seen["cookie"] == 0 || seen[""] == 0 {
		t.Errorf("the vectors do not reach every source: %v", seen)
	}
}

// Whatever the Cookie and Authorization headers hold, reading them never
// panics, and a credential is only ever taken from one of them.
func FuzzCredential(f *testing.F) {
	g := golden.LoadAuthHTTP(f)
	for _, c := range g.Auth {
		authorization, cookie := "\x00", ""
		for _, h := range c.Headers {
			switch h[0] {
			case "authorization":
				authorization = h[1]
			case "cookie":
				cookie = h[1]
			}
		}
		f.Add(authorization, cookie)
	}
	f.Fuzz(func(t *testing.T, authorization, cookie string) {
		r := httptest.NewRequest(http.MethodGet, "http://internal.invalid/", nil)
		if authorization != "\x00" { // the seed's mark for "no Authorization header"
			r.Header.Add("Authorization", authorization)
		}
		r.Header.Add("Cookie", cookie)
		token, via := httpapi.Credential(r)
		switch via {
		case httpapi.ViaBearer:
			if authorization == "\x00" {
				t.Fatal("a bearer credential without an Authorization header")
			}
		case httpapi.ViaCookie:
			if authorization != "\x00" || token == "" {
				t.Fatalf("a cookie credential %q next to an Authorization header %q", token, authorization)
			}
		case httpapi.ViaNone:
			if token != "" {
				t.Fatalf("a token %q from nowhere", token)
			}
		default:
			t.Fatalf("via %q", via)
		}
		httpapi.CrossSiteWrite(r, true)
	})
}
