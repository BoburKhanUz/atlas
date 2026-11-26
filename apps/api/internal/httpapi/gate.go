package httpapi

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"time"

	"lookly/internal/apierr"
	"lookly/internal/auth"
	"lookly/internal/session"
)

// Identity is the authenticated caller of a request.
type Identity struct {
	UserID    string
	Email     string
	SessionID string
}

// Gate is what every request passes before its handler runs, in this order:
//
//  1. the cross-site request guard (CrossSiteWrite): 403 FORBIDDEN;
//  2. for a route that is not public: the access token (Credential) must be
//     ours and unexpired, and its session must still stand: 401 UNAUTHORIZED;
//  3. unless the route is exempt: the user's consent to the legal texts must
//     be current: 403 CONSENT_REQUIRED;
//  4. for a route with a body rule: the body is judged, and the generated
//     decoder then reads its canonical form.
//
// A route that is not in the table is closed: it needs a session and a
// current consent. A test compares the table with the contract.
type Gate struct {
	Tokens interface {
		Verify(token string, now time.Time) (auth.Claims, bool)
	}
	Sessions interface {
		Alive(ctx context.Context, sessionID, userID string) (bool, error)
	}
	Consent interface {
		ConsentRequired(ctx context.Context, userID string) (bool, error)
	}
	// TrustProxy: the server is behind the reverse proxy that sets the
	// forwarding headers (TRUST_PROXY=1).
	TrustProxy bool
	// Now is the clock tokens are checked against (time.Now when nil).
	Now func() time.Time
}

type access int

const (
	// sessionRequired is the zero value on purpose: what is not listed is closed.
	sessionRequired access = iota
	// public routes take no credentials.
	public
	// sessionOptional routes use a valid session when there is one and work
	// without (sign-out is idempotent).
	sessionOptional
)

type routeRule struct {
	access access
	// consentExempt: served although the user's consent is out of date (the
	// routes that let the user see who they are, review and accept the
	// texts, or delete the account).
	consentExempt bool
	// body judges the request body before the generated decoder reads it.
	body BodyRule
	// mobileBodyOnly: the body belongs to mobile mode; in web mode the
	// cookies carry everything and a body is not read at all.
	mobileBodyOnly bool
}

// routes are the rules of the routes served, keyed by the router's pattern.
var routes = map[string]routeRule{
	"GET /api/health":            {access: public},
	"POST /api/v1/auth/register": {access: public, body: RegisterBody},
	"POST /api/v1/auth/login":    {access: public, body: LoginBody},
	"POST /api/v1/auth/refresh":  {access: public, body: RefreshBody, mobileBodyOnly: true},
	"POST /api/v1/auth/logout":   {access: sessionOptional, body: LogoutBody, mobileBodyOnly: true},
	"GET /api/v1/auth/me":        {consentExempt: true},
}

type identityKey struct{}
type requestKey struct{}

// identityFrom is the authenticated caller, when the gate found one.
func identityFrom(ctx context.Context) (Identity, bool) {
	id, ok := ctx.Value(identityKey{}).(Identity)
	return id, ok
}

// requestFrom is the HTTP request behind a handler's context: handlers read
// the client mode, cookies and client details from it.
func requestFrom(ctx context.Context) *http.Request {
	r, _ := ctx.Value(requestKey{}).(*http.Request)
	return r
}

func (g *Gate) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		info := infoFrom(r.Context())
		rule := routes[info.route]

		if CrossSiteWrite(r, g.TrustProxy) {
			info.log.Warn("cross-site write rejected", "requestId", info.id, "method", r.Method, "route", info.route)
			WriteError(w, r, apierr.New(apierr.Forbidden))
			return
		}

		ctx := r.Context()
		if rule.access != public {
			id, ok, err := g.authenticate(r)
			switch {
			case err != nil:
				WriteError(w, r, err)
				return
			case !ok && rule.access != sessionOptional:
				WriteError(w, r, apierr.New(apierr.Unauthorized))
				return
			case ok && rule.access == sessionRequired && !rule.consentExempt:
				required, err := g.Consent.ConsentRequired(ctx, id.UserID)
				if err != nil {
					WriteError(w, r, err)
					return
				}
				if required {
					WriteError(w, r, apierr.New(apierr.ConsentRequired))
					return
				}
			}
			if ok {
				ctx = context.WithValue(ctx, identityKey{}, id)
				info.userID = id.UserID // for the request log
			}
		}

		if rule.body != nil {
			if rule.mobileBodyOnly && ClientType(r) != session.Mobile {
				r.Body = http.NoBody
				r.ContentLength = 0
			} else {
				raw, err := io.ReadAll(r.Body) // bounded by the body limit (Wrap)
				if err != nil {
					var tooLarge *http.MaxBytesError
					if !errors.As(err, &tooLarge) {
						err = apierr.New(apierr.BadRequest) // the body did not arrive whole
					}
					WriteError(w, r, err)
					return
				}
				canonical, refusal := rule.body(raw)
				if refusal != nil {
					WriteError(w, r, refusal)
					return
				}
				r.Body = io.NopCloser(bytes.NewReader(canonical))
				r.ContentLength = int64(len(canonical))
			}
		}

		r = r.WithContext(ctx)
		next.ServeHTTP(w, r.WithContext(context.WithValue(ctx, requestKey{}, r)))
	})
}

// authenticate finds the caller: the token must verify, name a session, and
// that session must still stand. ok is false for "nobody"; err is a failure
// to find out.
func (g *Gate) authenticate(r *http.Request) (Identity, bool, error) {
	token, via := Credential(r)
	if via == ViaNone {
		return Identity{}, false, nil
	}
	now := time.Now
	if g.Now != nil {
		now = g.Now
	}
	claims, ok := g.Tokens.Verify(token, now())
	if !ok {
		return Identity{}, false, nil
	}
	// A token without a session id names no session: Alive answers no.
	alive, err := g.Sessions.Alive(r.Context(), claims.SID, claims.Sub)
	if err != nil || !alive {
		return Identity{}, false, err
	}
	return Identity{UserID: claims.Sub, Email: claims.Email, SessionID: claims.SID}, true, nil
}
