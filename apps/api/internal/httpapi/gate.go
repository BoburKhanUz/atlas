package httpapi

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"lookly/internal/accounts"
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
//     ours and unexpired, and its session must still stand: 401 UNAUTHORIZED
//     (on the account deletion, 404 NOT_FOUND when the session is gone with
//     its account: goneIsNotFound);
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
	// Users says whether an account still exists (see goneIsNotFound).
	Users interface {
		Exists(ctx context.Context, userID string) (bool, error)
	}
	// TrustProxy: the server is behind the reverse proxy that sets the
	// forwarding headers (TRUST_PROXY=1).
	TrustProxy bool
	// HTTPSOnly: the site is served over https only (its cookies are
	// Secure), so a write from an http page of our own host name is refused
	// as another site's.
	HTTPSOnly bool
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
	// bodyLimit and timeout replace DefaultBodyLimit and RequestTimeout for
	// the route (zero: the defaults).
	bodyLimit int64
	timeout   time.Duration
	// request judges the request's headers before anything of it is read.
	request func(*http.Request) *apierr.Error
	// itemID: the path ends in an id, judged (ItemID) before the query and
	// the body, as the Next.js routes do.
	itemID bool
	// query judges the query string and rewrites it in canonical form
	// before the generated decoder reads it.
	query QueryRule
	// body judges the request body before the generated decoder reads it.
	body BodyRule
	// mobileBodyOnly: the body belongs to mobile mode; in web mode the
	// cookies carry everything and a body is not read at all.
	mobileBodyOnly bool
	// goneIsNotFound: a token of ours whose session is gone because its
	// account was deleted is answered NOT_FOUND, not UNAUTHORIZED. The
	// account deletion only: the app asks again after a lost answer, and
	// "the account is gone" is what lets it clear the user's data (the
	// Next.js API, which did not check sessions, answered so for as long as
	// the token lived).
	goneIsNotFound bool
}

// routes are the rules of the routes served, keyed by the router's pattern.
var routes = map[string]routeRule{
	"GET /api/health":                   {access: public},
	"POST /api/v1/auth/register":        {access: public, body: RegisterBody},
	"POST /api/v1/auth/login":           {access: public, body: LoginBody},
	"POST /api/v1/auth/refresh":         {access: public, body: RefreshBody, mobileBodyOnly: true},
	"POST /api/v1/auth/logout":          {access: sessionOptional, body: LogoutBody, mobileBodyOnly: true},
	"GET /api/v1/auth/me":               {consentExempt: true},
	"POST /api/v1/auth/password/forgot": {access: public, body: PasswordForgotBody},
	"POST /api/v1/auth/password/reset":  {access: public, body: PasswordResetBody},
	"GET /api/v1/legal":                 {access: public},
	"POST /api/v1/legal/consent":        {consentExempt: true, body: LegalConsentBody},
	"DELETE /api/v1/account":            {consentExempt: true, goneIsNotFound: true},
	"GET /api/v1/profile":               {},
	"PATCH /api/v1/profile":             {body: ProfilePatchBody},
	mediaRoute:                          {access: public}, // the signed link is the credential

	"GET /api/v1/wardrobe/items":         {query: WardrobeListQuery},
	"POST /api/v1/wardrobe/items":        {request: UploadHeaders, bodyLimit: UploadBodyLimit, timeout: UploadTimeout},
	"GET /api/v1/wardrobe/items/{id}":    {itemID: true},
	"PATCH /api/v1/wardrobe/items/{id}":  {itemID: true, body: WardrobePatchBody},
	"DELETE /api/v1/wardrobe/items/{id}": {itemID: true},
	"GET /api/v1/weather/current":        {query: WeatherQuery},
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

		if CrossSiteWrite(r, g.TrustProxy, g.HTTPSOnly) {
			info.log.Warn("cross-site write rejected", "requestId", info.id, "method", r.Method, "route", info.route)
			WriteError(w, r, apierr.New(apierr.Forbidden))
			return
		}

		ctx := r.Context()
		if rule.access != public {
			id, ok, orphan, err := g.authenticate(r)
			switch {
			case err != nil:
				WriteError(w, r, err)
				return
			case !ok && rule.goneIsNotFound && orphan != "":
				// The token is ours and unexpired; only its session is gone.
				refusal := apierr.New(apierr.Unauthorized)
				exists, err := g.Users.Exists(ctx, orphan)
				switch {
				case err != nil:
					WriteError(w, r, err)
					return
				case !exists:
					refusal = apierr.With(apierr.NotFound, accounts.MsgUserNotFound)
				}
				WriteError(w, r, refusal)
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

		if rule.request != nil {
			if refusal := rule.request(r); refusal != nil {
				WriteError(w, r, refusal)
				return
			}
		}
		if rule.itemID {
			// The id is the last path segment. The router has matched it as
			// one segment, so the escaped path holds it whole.
			escaped := r.URL.EscapedPath()
			raw, err := url.PathUnescape(escaped[strings.LastIndexByte(escaped, '/')+1:])
			if err != nil {
				WriteError(w, r, apierr.New(apierr.BadRequest))
				return
			}
			if _, refusal := ItemID(raw); refusal != nil {
				WriteError(w, r, refusal)
				return
			}
		}
		if rule.query != nil {
			canonical, refusal := rule.query(r.URL.Query())
			if refusal != nil {
				WriteError(w, r, refusal)
				return
			}
			r.URL.RawQuery = canonical.Encode()
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
// to find out. orphan is the user id of a token that verifies but whose
// session is gone (goneIsNotFound needs it); such a token is never an
// identity.
func (g *Gate) authenticate(r *http.Request) (id Identity, ok bool, orphan string, err error) {
	token, via := Credential(r)
	if via == ViaNone {
		return Identity{}, false, "", nil
	}
	now := time.Now
	if g.Now != nil {
		now = g.Now
	}
	claims, verified := g.Tokens.Verify(token, now())
	if !verified {
		return Identity{}, false, "", nil
	}
	// A token without a session id names no session: Alive answers no.
	alive, err := g.Sessions.Alive(r.Context(), claims.SID, claims.Sub)
	switch {
	case err != nil:
		return Identity{}, false, "", err
	case !alive:
		return Identity{}, false, claims.Sub, nil
	}
	return Identity{UserID: claims.Sub, Email: claims.Email, SessionID: claims.SID}, true, "", nil
}
