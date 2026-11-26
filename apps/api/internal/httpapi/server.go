package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"lookly/internal/accounts"
	"lookly/internal/apierr"
	"lookly/internal/auth"
	"lookly/internal/health"
	"lookly/internal/httpapi/contract"
	"lookly/internal/legal"
	"lookly/internal/media"
	"lookly/internal/profile"
	"lookly/internal/session"
	"lookly/internal/storage"
	"lookly/internal/wardrobe"
)

// Services are the domain services the handlers call, and the settings of
// the HTTP edge.
type Services struct {
	Health   *health.Service
	Accounts *accounts.Service
	Sessions *session.Service
	Legal    *legal.Service
	Profile  *profile.Service
	Wardrobe *wardrobe.Service
	Uploads  *wardrobe.Uploads
	// Media signs and checks the image links; Images holds the images.
	Media  *media.Signer
	Images storage.Store
	// Now is the clock for media links (time.Now when nil).
	Now func() time.Time
	// CookieSecure: auth cookies carry the Secure attribute (COOKIE_SECURE).
	CookieSecure bool
	// TrustProxy: the client's address is read from the reverse proxy's
	// headers (TRUST_PROXY).
	TrustProxy bool
}

// Server implements the generated contract interface. Each method decodes
// nothing itself (the gate and the generated code do), calls one service
// method and encodes the answer.
type Server struct {
	s Services
}

var _ contract.StrictServerInterface = (*Server)(nil)

// NewServer returns the contract implementation over the services.
func NewServer(s Services) *Server { return &Server{s: s} }

func (s *Server) now() time.Time {
	if s.s.Now != nil {
		return s.s.Now()
	}
	return time.Now()
}

// GetHealth: 200 when the database answers, 503 when it does not (the body
// says which; Docker and monitoring read the status). Never cached.
func (s *Server) GetHealth(ctx context.Context, _ contract.GetHealthRequestObject) (contract.GetHealthResponseObject, error) {
	body := contract.HealthResponse{
		Status:   contract.HealthResponseStatusOk,
		Database: contract.HealthResponseDatabaseOk,
		Version:  s.s.Health.Version(),
	}
	status := http.StatusOK
	if err := s.s.Health.CheckDatabase(ctx); err != nil {
		if info := infoFrom(ctx); info != nil {
			info.log.Warn("health check: database unreachable", "requestId", info.id, "err", err.Error())
		}
		body.Status = contract.HealthResponseStatusDegraded
		body.Database = contract.HealthResponseDatabaseUnreachable
		status = http.StatusServiceUnavailable
	}
	return healthResponse{status: status, body: body}, nil
}

// healthResponse adds Cache-Control: no-store, which the generated response
// types cannot carry (the contract documents no headers for health).
type healthResponse struct {
	status int
	body   contract.HealthResponse
}

func (r healthResponse) VisitGetHealthResponse(w http.ResponseWriter) error {
	w.Header().Set("Cache-Control", "no-store")
	return writeJSON(w, r.status, r.body)
}

// client is what the request says about its sender.
func (s *Server) client(r *http.Request, deviceName *string) accounts.Client {
	c := accounts.Client{Type: ClientType(r)}
	c.UserAgent, _ = header(r, "User-Agent")
	if deviceName != nil {
		c.DeviceName = *deviceName
	}
	c.Addr, c.HasAddr = ClientAddr(r, s.s.TrustProxy)
	return c
}

// Register: 201, signed in. Web: cookies and {user}; mobile: the tokens in
// the body and no cookies.
func (s *Server) Register(ctx context.Context, request contract.RegisterRequestObject) (contract.RegisterResponseObject, error) {
	c := s.client(requestFrom(ctx), request.Body.DeviceName)
	user, issued, err := s.s.Accounts.Register(ctx, accounts.RegisterInput{
		Email:        request.Body.Email,
		Password:     request.Body.Password,
		Name:         request.Body.Name,
		LegalVersion: request.Body.AcceptedLegalVersion,
		AgeConfirmed: request.Body.AgeConfirmed,
	}, c)
	if err != nil {
		return nil, err
	}
	return signedIn{status: http.StatusCreated, mode: c.Type, user: user, issued: issued, secure: s.s.CookieSecure}, nil
}

// Login: 200, signed in, in the same two forms as Register.
func (s *Server) Login(ctx context.Context, request contract.LoginRequestObject) (contract.LoginResponseObject, error) {
	c := s.client(requestFrom(ctx), request.Body.DeviceName)
	user, issued, err := s.s.Accounts.Login(ctx, accounts.LoginInput{Email: request.Body.Email, Password: request.Body.Password}, c)
	if err != nil {
		return nil, err
	}
	return signedIn{status: http.StatusOK, mode: c.Type, user: user, issued: issued, secure: s.s.CookieSecure}, nil
}

// terminal are the refresh refusals after which a client discards its
// tokens: a web client's cookies are cleared with the answer. SESSION_RACE
// and SESSION_BUSY are retried, so the cookies stay.
var terminal = map[apierr.Code]bool{
	apierr.InvalidToken:   true,
	apierr.SessionExpired: true,
	apierr.SessionRevoked: true,
	apierr.RefreshReused:  true,
	apierr.ClientMismatch: true,
}

// RefreshSession rotates the refresh token (web: the atlas_rt cookie;
// mobile: the body), or replays a rotation made moments ago.
func (s *Server) RefreshSession(ctx context.Context, request contract.RefreshSessionRequestObject) (contract.RefreshSessionResponseObject, error) {
	r := requestFrom(ctx)
	mode := ClientType(r)
	token := ""
	if mode == session.Mobile {
		token = request.Body.RefreshToken
	} else {
		token, _ = cookie(r, RefreshCookie)
	}
	userAgent, _ := header(r, "User-Agent")
	refreshed, err := s.s.Sessions.Refresh(ctx, token, session.RefreshOptions{ClientType: mode, UserAgent: userAgent})
	if err != nil {
		var refusal *apierr.Error
		if mode == session.Web && errors.As(err, &refusal) && terminal[refusal.Code] {
			return signedOut{refusal: refusal, info: infoFrom(ctx), secure: s.s.CookieSecure}, nil
		}
		return nil, err
	}
	return signedIn{status: http.StatusOK, mode: mode, user: refreshed.User, issued: refreshed.Issued, secure: s.s.CookieSecure}, nil
}

// Logout ends the session family of the presented refresh token, or of the
// access token's session, and clears a web client's cookies. Idempotent.
func (s *Server) Logout(ctx context.Context, request contract.LogoutRequestObject) (contract.LogoutResponseObject, error) {
	r := requestFrom(ctx)
	mode := ClientType(r)
	token := ""
	if mode == session.Mobile {
		if request.Body != nil && request.Body.RefreshToken != nil {
			token = *request.Body.RefreshToken
		}
	} else {
		token, _ = cookie(r, RefreshCookie)
	}
	id, _ := identityFrom(ctx)
	if err := s.s.Sessions.End(ctx, session.EndOptions{RefreshToken: token, SID: id.SessionID, UserID: id.UserID}); err != nil {
		return nil, err // SESSION_BUSY: nothing ended, the cookies stay
	}
	return loggedOut{clearCookies: mode == session.Web, secure: s.s.CookieSecure}, nil
}

// GetMe is the signed-in user, also when the consent is out of date:
// consentRequired then tells the client to show the texts first.
func (s *Server) GetMe(ctx context.Context, _ contract.GetMeRequestObject) (contract.GetMeResponseObject, error) {
	id, ok := identityFrom(ctx)
	if !ok {
		return nil, apierr.New(apierr.Unauthorized)
	}
	me, err := s.s.Accounts.Me(ctx, id.UserID)
	if err != nil {
		return nil, err
	}
	var body meBody
	body.User.ID, body.User.Email, body.User.Name = me.ID, me.Email, me.Name
	body.User.CreatedAt = isoMillis(me.CreatedAt)
	body.ConsentRequired = me.ConsentRequired
	return meResponse{body}, nil
}

// ─── Responses ───────────────────────────────────────────────────────────
//
// Written by hand rather than with the generated response types: those
// carry one Set-Cookie value (two are needed) and write times in another
// form than the Next.js API (which always sends milliseconds).

type userBody struct {
	ID    string  `json:"id"`
	Email string  `json:"email"`
	Name  *string `json:"name"`
}

type webAuthBody struct {
	User userBody `json:"user"`
}

type mobileAuthBody struct {
	User                  userBody `json:"user"`
	AccessToken           string   `json:"accessToken"`
	AccessTokenExpiresAt  string   `json:"accessTokenExpiresAt"`
	RefreshToken          string   `json:"refreshToken"`
	RefreshTokenExpiresAt string   `json:"refreshTokenExpiresAt"`
	SessionExpiresAt      string   `json:"sessionExpiresAt"`
}

type meBody struct {
	User struct {
		ID        string  `json:"id"`
		Email     string  `json:"email"`
		Name      *string `json:"name"`
		CreatedAt string  `json:"createdAt"`
	} `json:"user"`
	ConsentRequired bool `json:"consentRequired"`
}

// isoMillis is a time as JavaScript's toISOString writes it.
func isoMillis(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }

// writeJSON writes a JSON answer. It sets no caching header, as the Next.js
// API sets none: a browser keeps a "no-store" answer pending for as long as
// the page has not read its body, and the web client does not read every
// body (a successful refresh, a sign-out). Answers that must not be stored
// say so themselves (health, and tokens in a body).
func writeJSON(w http.ResponseWriter, status int, body any) error {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	return json.NewEncoder(w).Encode(body)
}

// signedIn answers a registration, a sign-in or a refresh.
type signedIn struct {
	status int
	mode   session.ClientType
	user   session.User
	issued session.Issued
	secure bool
}

func (r signedIn) write(w http.ResponseWriter) error {
	user := userBody{ID: r.user.ID, Email: r.user.Email, Name: r.user.Name}
	if r.mode == session.Mobile {
		// Tokens in a body: never to be stored (RFC 6749, 5.1). The mobile
		// client is not a browser and reads every body.
		w.Header().Set("Cache-Control", "no-store")
		return writeJSON(w, r.status, mobileAuthBody{
			User:                  user,
			AccessToken:           r.issued.AccessToken,
			AccessTokenExpiresAt:  isoMillis(r.issued.AccessTokenExpiresAt),
			RefreshToken:          r.issued.RefreshToken,
			RefreshTokenExpiresAt: isoMillis(r.issued.RefreshTokenExpiresAt),
			SessionExpiresAt:      isoMillis(r.issued.SessionExpiresAt),
		})
	}
	setSessionCookies(w, r.issued, r.secure)
	return writeJSON(w, r.status, webAuthBody{User: user})
}

func (r signedIn) VisitRegisterResponse(w http.ResponseWriter) error       { return r.write(w) }
func (r signedIn) VisitLoginResponse(w http.ResponseWriter) error          { return r.write(w) }
func (r signedIn) VisitRefreshSessionResponse(w http.ResponseWriter) error { return r.write(w) }

// signedOut answers a web refresh that ended the session for good: the
// error envelope, and the cookies cleared.
type signedOut struct {
	refusal *apierr.Error
	info    *requestInfo
	secure  bool
}

func (r signedOut) VisitRefreshSessionResponse(w http.ResponseWriter) error {
	clearSessionCookies(w, r.secure)
	writeEnvelope(w, r.info, r.refusal)
	return nil
}

type loggedOut struct {
	clearCookies bool
	secure       bool
}

func (r loggedOut) VisitLogoutResponse(w http.ResponseWriter) error {
	if r.clearCookies {
		clearSessionCookies(w, r.secure)
	}
	return writeJSON(w, http.StatusOK, contract.OkResponse{Ok: true})
}

type meResponse struct{ body meBody }

func (r meResponse) VisitGetMeResponse(w http.ResponseWriter) error {
	return writeJSON(w, http.StatusOK, r.body)
}

// ─── Cookies ─────────────────────────────────────────────────────────────

// sessionCookie is an auth cookie: HttpOnly, SameSite=Lax, Path=/, Secure by
// configuration. A lifetime of zero or less deletes it.
func sessionCookie(name, value string, maxAge int, secure bool) *http.Cookie {
	c := &http.Cookie{Name: name, Value: value, Path: "/", HttpOnly: true, Secure: secure, SameSite: http.SameSiteLaxMode, MaxAge: maxAge}
	if maxAge <= 0 {
		c.MaxAge = -1 // net/http writes "Max-Age=0" for a negative value, and nothing at all for zero
	}
	return c
}

// setSessionCookies gives a web client its tokens. Lifetimes are counted
// from the database time the tokens were issued at, rounded up: a cookie
// may outlive its token by less than a second, never the reverse.
func setSessionCookies(w http.ResponseWriter, issued session.Issued, secure bool) {
	http.SetCookie(w, sessionCookie(AccessCookie, issued.AccessToken, auth.SecondsBetween(issued.IssuedAt, issued.AccessTokenExpiresAt), secure))
	http.SetCookie(w, sessionCookie(RefreshCookie, issued.RefreshToken, auth.SecondsBetween(issued.IssuedAt, issued.RefreshTokenExpiresAt), secure))
}

func clearSessionCookies(w http.ResponseWriter, secure bool) {
	http.SetCookie(w, sessionCookie(AccessCookie, "", 0, secure))
	http.SetCookie(w, sessionCookie(RefreshCookie, "", 0, secure))
}
