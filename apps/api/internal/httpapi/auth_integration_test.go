//go:build integration

// The five auth operations through the real router, gate and services on a
// real PostgreSQL. The web- and mobile-mode cases are ported from
// apps/web/tests/integration/session-http.itest.ts; the rest come from
// docs/plan/B2.md (what the Go server does differently, on purpose).
// Every response is checked against the contract.

package httpapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"lookly/internal/accounts"
	"lookly/internal/apierr"
	"lookly/internal/auth"
	"lookly/internal/contracttest"
	"lookly/internal/dbtest"
	"lookly/internal/golden"
	"lookly/internal/health"
	"lookly/internal/httpapi"
	"lookly/internal/legal"
	"lookly/internal/ratelimit"
	"lookly/internal/session"
	"lookly/migrations"
)

const password = "parol-1234"

// quickHasher is bcrypt at the lowest costs, so that hundreds of sign-ins
// take seconds: new hashes at cost 5, anything weaker asks for a re-hash (as
// cost 10 does against 12 on the server). It counts what it is asked.
type quickHasher struct {
	mu       sync.Mutex
	verified []string // the hashes passwords were compared with
	hashed   int
}

const quickCost = 5

func (h *quickHasher) Hash(plain string) (string, error) {
	if len(plain) > auth.MaxPasswordBytes {
		return "", auth.ErrPasswordTooLong
	}
	h.mu.Lock()
	h.hashed++
	h.mu.Unlock()
	hash, err := bcrypt.GenerateFromPassword([]byte(plain), quickCost)
	return string(hash), err
}

func (h *quickHasher) Verify(plain, hash string) bool {
	h.mu.Lock()
	h.verified = append(h.verified, hash)
	h.mu.Unlock()
	return auth.VerifyPassword(plain, hash)
}

func (h *quickHasher) NeedsRehash(hash string) bool {
	cost, err := bcrypt.Cost([]byte(hash))
	return err != nil || cost < quickCost
}

// Decoys: one at the test's current cost, one at its "legacy" cost.
func (h *quickHasher) Decoys() (current, legacy string, err error) {
	password := []byte(auth.NewRefreshToken())
	c, err := bcrypt.GenerateFromPassword(password, quickCost)
	if err != nil {
		return "", "", err
	}
	l, err := bcrypt.GenerateFromPassword(password, bcrypt.MinCost)
	return string(c), string(l), err
}

// costsSince are the costs of the hashes compared with since the mark, sorted.
func (h *quickHasher) costsSince(mark int) []int {
	h.mu.Lock()
	defer h.mu.Unlock()
	var costs []int
	for _, hash := range h.verified[mark:] {
		cost, _ := bcrypt.Cost([]byte(hash))
		costs = append(costs, cost)
	}
	slices.Sort(costs)
	return costs
}

func (h *quickHasher) comparisons() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.verified)
}

type apiOptions struct {
	trustProxy   bool
	cookieSecure bool
	hasher       accounts.Hasher
	lockTimeout  time.Duration
}

// api is the server on its own database.
type api struct {
	t        *testing.T
	pool     *pgxpool.Pool
	handler  http.Handler
	tokens   auth.Tokens
	hasher   *quickHasher
	sessions *session.Service
	gate     *httpapi.Gate
	log      *bytes.Buffer
	logMu    *sync.Mutex
	seq      int
}

type lockedWriter struct {
	mu *sync.Mutex
	w  io.Writer
}

func (l lockedWriter) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.w.Write(p)
}

func newAPI(t *testing.T, o apiOptions) *api {
	t.Helper()
	ctx := context.Background()
	pool := dbtest.Empty(t)
	if err := migrations.Apply(ctx, pool); err != nil {
		t.Fatal(err)
	}
	dbtest.InstallTestClock(t, pool) // unset: the real clock, until a test sets it
	a := &api{t: t, pool: pool, tokens: auth.NewTokens([]byte("http-test-secret-http-test-secret-http")), hasher: &quickHasher{}, log: &bytes.Buffer{}, logMu: &sync.Mutex{}}
	log := slog.New(slog.NewJSONHandler(lockedWriter{a.logMu, a.log}, nil))
	var sessionOptions []session.Option
	if o.lockTimeout > 0 {
		sessionOptions = append(sessionOptions, session.WithLockTimeout(o.lockTimeout))
	}
	key := bytes.Repeat([]byte{7}, 32)
	a.sessions = session.New(pool, session.Config{
		Tokens: a.tokens, Keys: session.Keys{Active: key}, AccessTTL: 15 * time.Minute, RefreshTTL: 30 * 24 * time.Hour, Log: log,
	}, sessionOptions...)
	consent := legal.NewService(pool)
	var hasher accounts.Hasher = a.hasher
	if o.hasher != nil {
		hasher = o.hasher
	}
	users := accounts.New(pool, a.sessions, ratelimit.New(pool, []byte("http-test-secret-http-test-secret-http")), consent, hasher, log)
	server := httpapi.NewServer(httpapi.Services{
		Health: health.New(pool, "test", time.Second), Accounts: users, Sessions: a.sessions, Legal: consent,
		CookieSecure: o.cookieSecure, TrustProxy: o.trustProxy,
	})
	a.gate = &httpapi.Gate{Tokens: a.tokens, Sessions: a.sessions, Consent: consent, TrustProxy: o.trustProxy, HTTPSOnly: o.cookieSecure}
	a.handler = httpapi.New(server, log, a.gate)
	return a
}

func (a *api) logs() string {
	a.logMu.Lock()
	defer a.logMu.Unlock()
	return a.log.String()
}

// call is one request.
type call struct {
	method  string // POST by default
	path    string
	body    any    // nil: no body; a string: sent as it is; anything else: as JSON
	mobile  bool   // X-Atlas-Client: mobile
	bearer  string // Authorization: Bearer
	cookies map[string]string
	headers map[string]string
}

type answer struct {
	status  int
	header  http.Header
	raw     []byte
	body    map[string]any
	cookies map[string]*http.Cookie // what the answer sets
}

// knownContractGaps are answers both servers give that the contract does not
// list for the operation: the cross-site guard applies to every write (the
// contract lists FORBIDDEN only where a session is required), and starting a
// session can find the store busy. Their bodies are still checked against
// the error schema. docs/plan/B2.md records the gap.
var knownContractGaps = map[string]bool{
	"POST /api/v1/auth/login 403":    true,
	"POST /api/v1/auth/register 403": true,
	"POST /api/v1/auth/refresh 403":  true,
	"POST /api/v1/auth/login 503":    true,
	"POST /api/v1/auth/register 503": true,
}

func (a *api) do(c call) answer {
	a.t.Helper()
	if c.method == "" {
		c.method = http.MethodPost
	}
	var body io.Reader
	switch b := c.body.(type) {
	case nil:
	case string:
		body = strings.NewReader(b)
	default:
		encoded, err := json.Marshal(b)
		if err != nil {
			a.t.Fatal(err)
		}
		body = bytes.NewReader(encoded)
	}
	r := httptest.NewRequest(c.method, "http://app.example.uz"+c.path, body)
	if c.mobile {
		r.Header.Set("X-Atlas-Client", "mobile")
	}
	if c.bearer != "" {
		r.Header.Set("Authorization", "Bearer "+c.bearer)
	}
	var pairs []string
	for name, value := range c.cookies {
		pairs = append(pairs, name+"="+value)
	}
	if len(pairs) > 0 {
		r.Header.Set("Cookie", strings.Join(pairs, "; "))
	}
	for name, value := range c.headers {
		r.Header.Set(name, value)
	}
	w := httptest.NewRecorder()
	a.handler.ServeHTTP(w, r)

	out := answer{status: w.Code, header: w.Header(), raw: w.Body.Bytes(), cookies: map[string]*http.Cookie{}}
	if gap := fmt.Sprintf("%s %s %d", c.method, c.path, w.Code); knownContractGaps[gap] {
		contracttest.Schema(a.t, "ErrorResponse", out.raw)
	} else {
		contracttest.Response(a.t, c.method, c.path, w.Code, w.Header(), out.raw)
	}
	if err := json.Unmarshal(out.raw, &out.body); err != nil {
		a.t.Fatalf("%s %s: body is not a JSON object: %s", c.method, c.path, out.raw)
	}
	for _, cookie := range w.Result().Cookies() {
		out.cookies[cookie.Name] = cookie
	}
	// Answers that hold tokens are never to be stored. Nothing else carries
	// the header, as with the Next.js API: Chromium keeps a no-store answer
	// "pending" for as long as the page has not read its body, and the web
	// client does not read the body of a successful refresh.
	wantCache := ""
	if _, tokens := out.body["refreshToken"]; tokens {
		wantCache = "no-store"
	}
	if got := w.Header().Get("Cache-Control"); got != wantCache {
		a.t.Errorf("%s %s (%d): Cache-Control %q, want %q", c.method, c.path, w.Code, got, wantCache)
	}
	if w.Code >= 400 && (out.body["requestId"] == "" || out.body["requestId"] != w.Header().Get("X-Request-Id")) {
		a.t.Errorf("%s %s: requestId %v, header %q", c.method, c.path, out.body["requestId"], w.Header().Get("X-Request-Id"))
	}
	return out
}

// is checks the status and, for errors, the code.
func (a *api) is(got answer, status int, code apierr.Code) {
	a.t.Helper()
	gotCode, _ := got.body["code"].(string)
	if got.status != status || gotCode != string(code) {
		a.t.Fatalf("got %d %q, want %d %q\nbody: %s", got.status, gotCode, status, code, got.raw)
	}
}

func (a answer) text(path ...string) string {
	var v any = a.body
	for _, key := range path {
		m, _ := v.(map[string]any)
		v = m[key]
	}
	s, _ := v.(string)
	return s
}

// cleared reports whether the answer deletes the cookie.
func (a answer) cleared(name string) bool {
	c, set := a.cookies[name]
	return set && c.Value == "" && c.MaxAge < 0
}

func (a *api) newEmail() string {
	a.seq++
	return fmt.Sprintf("user%d@test.local", a.seq)
}

func registration(email string) map[string]any {
	return map[string]any{"email": email, "password": password, "acceptedLegalVersion": legal.Version, "ageConfirmed": true}
}

type webSession struct {
	email  string
	at, rt string
	answer answer
}

// webLogin registers an account and signs it in once more, in web mode.
func (a *api) webLogin() webSession {
	a.t.Helper()
	email := a.newEmail()
	a.is(a.do(call{path: "/api/v1/auth/register", body: registration(email)}), http.StatusCreated, "")
	return a.webLoginAs(email)
}

func (a *api) webLoginAs(email string) webSession {
	a.t.Helper()
	got := a.do(call{path: "/api/v1/auth/login", body: map[string]any{"email": email, "password": password}})
	a.is(got, http.StatusOK, "")
	s := webSession{email: email, answer: got}
	if at, rt := got.cookies[httpapi.AccessCookie], got.cookies[httpapi.RefreshCookie]; at != nil && rt != nil {
		s.at, s.rt = at.Value, rt.Value
	}
	if s.at == "" || s.rt == "" {
		a.t.Fatalf("login set cookies %v", got.cookies)
	}
	return s
}

type mobileSession struct {
	email                     string
	accessToken, refreshToken string
	answer                    answer
}

func (a *api) mobileRegister(extra map[string]any) mobileSession {
	a.t.Helper()
	email := a.newEmail()
	body := registration(email)
	for k, v := range extra {
		body[k] = v
	}
	got := a.do(call{path: "/api/v1/auth/register", body: body, mobile: true})
	a.is(got, http.StatusCreated, "")
	return mobileSession{email: email, accessToken: got.text("accessToken"), refreshToken: got.text("refreshToken"), answer: got}
}

func (a *api) refreshWeb(rt string) answer {
	a.t.Helper()
	cookies := map[string]string{}
	if rt != "" {
		cookies[httpapi.RefreshCookie] = rt
	}
	return a.do(call{path: "/api/v1/auth/refresh", cookies: cookies})
}

func (a *api) refreshMobile(token string) answer {
	a.t.Helper()
	return a.do(call{path: "/api/v1/auth/refresh", mobile: true, body: map[string]any{"refreshToken": token}})
}

func (a *api) me(c call) answer {
	a.t.Helper()
	c.method, c.path = http.MethodGet, "/api/v1/auth/me"
	return a.do(c)
}

func query[T any](a *api, sql string, args ...any) T {
	a.t.Helper()
	var v T
	if err := a.pool.QueryRow(context.Background(), sql, args...).Scan(&v); err != nil {
		a.t.Fatalf("%s: %v", sql, err)
	}
	return v
}

func (a *api) exec(sql string, args ...any) {
	a.t.Helper()
	if _, err := a.pool.Exec(context.Background(), sql, args...); err != nil {
		a.t.Fatalf("%s: %v", sql, err)
	}
}

func (a *api) familyOf(refreshToken string) string {
	a.t.Helper()
	return query[string](a, `SELECT "familyId" FROM "Session" WHERE "tokenHash" = $1`, auth.HashToken(refreshToken))
}

func (a *api) revokeReason(family string) string {
	a.t.Helper()
	return query[string](a, `SELECT coalesce("revokeReason", '') FROM "SessionFamily" WHERE "id" = $1`, family)
}

func (a *api) liveIn(family string) int {
	a.t.Helper()
	return query[int](a, `SELECT count(*) FROM "Session" WHERE "familyId" = $1 AND "revokedAt" IS NULL`, family)
}

// ageRotation moves a token's rotation back in time, instead of waiting.
func (a *api) ageRotation(rt string, d time.Duration) {
	a.t.Helper()
	a.exec(`UPDATE "Session" SET "rotatedAt" = "rotatedAt" - $2::interval WHERE "tokenHash" = $1`, auth.HashToken(rt), fmt.Sprintf("%d milliseconds", d.Milliseconds()))
}

// ─── Web mode ────────────────────────────────────────────────────────────

func TestWebLoginSetsCookiesAndPutsNoTokensInTheBody(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{})
	s := a.webLogin()
	user, _ := s.answer.body["user"].(map[string]any)
	if len(s.answer.body) != 1 || len(user) != 3 || user["email"] != s.email || user["name"] != nil || user["id"] == "" {
		t.Fatalf("body %s", s.answer.raw)
	}
	if strings.Contains(string(s.answer.raw), s.at) || strings.Contains(string(s.answer.raw), s.rt) {
		t.Error("a token is in the body of a web answer")
	}
	for name, maxAge := range map[string]int{httpapi.AccessCookie: 900, httpapi.RefreshCookie: 2592000} {
		c := s.answer.cookies[name]
		if c.Path != "/" || !c.HttpOnly || c.SameSite != http.SameSiteLaxMode || c.Secure || c.MaxAge != maxAge || c.Domain != "" {
			t.Errorf("%s: %+v, want Path=/, HttpOnly, SameSite=Lax, not Secure, Max-Age=%d", name, c, maxAge)
		}
	}
	if len(s.answer.cookies) != 2 {
		t.Errorf("cookies %v", s.answer.cookies)
	}
	// Only the token's hash is stored.
	if n := query[int](a, `SELECT count(*) FROM "Session" WHERE "tokenHash" = $1`, auth.HashToken(s.rt)); n != 1 {
		t.Errorf("%d sessions with the token's hash", n)
	}
	if n := query[int](a, `SELECT count(*) FROM "Session" WHERE "tokenHash" = $1`, s.rt); n != 0 {
		t.Error("the refresh token itself is stored")
	}
	if got := query[string](a, `SELECT "clientType" FROM "SessionFamily" WHERE "id" = $1`, a.familyOf(s.rt)); got != "web" || a.revokeReason(a.familyOf(s.rt)) != "" {
		t.Errorf("family: %s", got)
	}
	// The access token names the session; nothing secret reaches the log.
	claims, ok := a.tokens.Verify(s.at, time.Now())
	if !ok || claims.Email != s.email || claims.SID == "" {
		t.Errorf("access token claims %+v %v", claims, ok)
	}
	for _, secret := range []string{password, s.at, s.rt, s.email} {
		if strings.Contains(a.logs(), secret) {
			t.Errorf("the log holds %q", secret)
		}
	}
}

func TestCookiesAreSecureWhenConfigured(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{cookieSecure: true})
	s := a.webLogin()
	for name, c := range s.answer.cookies {
		if !c.Secure {
			t.Errorf("%s is not Secure", name)
		}
	}
	// Where cookies are Secure the site is https: a page served over plain
	// http under our host name (by someone on the network) is another site.
	loginBody := map[string]any{"email": s.email, "password": password}
	a.is(a.do(call{path: "/api/v1/auth/login", headers: map[string]string{"Origin": "http://app.example.uz"}, body: loginBody}), http.StatusForbidden, apierr.Forbidden)
	a.is(a.do(call{path: "/api/v1/auth/login", headers: map[string]string{"Origin": "https://app.example.uz"}, body: loginBody}), http.StatusOK, "")
	// The cookies that clear a session are Secure too.
	out := a.do(call{path: "/api/v1/auth/logout", cookies: map[string]string{httpapi.RefreshCookie: s.rt}})
	for name, c := range out.cookies {
		if !c.Secure {
			t.Errorf("the clearing %s is not Secure", name)
		}
	}
}

func TestRegisterSignsInAndAWrongPasswordDoesNot(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{})
	email := a.newEmail()
	got := a.do(call{path: "/api/v1/auth/register", body: registration(email)})
	a.is(got, http.StatusCreated, "")
	if got.text("user", "email") != email || got.cookies[httpapi.AccessCookie] == nil || got.cookies[httpapi.RefreshCookie] == nil || len(got.body) != 1 {
		t.Fatalf("register: %s, cookies %v", got.raw, got.cookies)
	}

	mark := a.hasher.comparisons()
	wrong := a.do(call{path: "/api/v1/auth/login", body: map[string]any{"email": email, "password": "nope-nope"}})
	a.is(wrong, http.StatusUnauthorized, apierr.Unauthorized)
	if len(wrong.cookies) != 0 || wrong.text("error") != "Email yoki parol noto‘g‘ri" {
		t.Errorf("wrong password: %s, cookies %v", wrong.raw, wrong.cookies)
	}
	wrongWork := a.hasher.costsSince(mark)

	// An unknown email gets the same answer after the same work.
	mark = a.hasher.comparisons()
	unknown := a.do(call{path: "/api/v1/auth/login", body: map[string]any{"email": "nobody@test.local", "password": "nope-nope"}})
	a.is(unknown, http.StatusUnauthorized, apierr.Unauthorized)
	if unknown.text("error") != wrong.text("error") || len(unknown.cookies) != 0 {
		t.Errorf("unknown email: %s", unknown.raw)
	}
	unknownWork := a.hasher.costsSince(mark)

	// So does an account whose hash the old server left (a weaker cost):
	// every account is one of these on the day of the cutover.
	legacyHash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	a.exec(`INSERT INTO "User" ("id","email","passwordHash","updatedAt") VALUES ('u_legacy', 'legacy@test.local', $1, now())`, string(legacyHash))
	mark = a.hasher.comparisons()
	legacy := a.do(call{path: "/api/v1/auth/login", body: map[string]any{"email": "legacy@test.local", "password": "nope-nope"}})
	a.is(legacy, http.StatusUnauthorized, apierr.Unauthorized)
	legacyWork := a.hasher.costsSince(mark)

	// One comparison at the current cost and one at the legacy cost, each time.
	want := []int{bcrypt.MinCost, quickCost}
	for name, work := range map[string][]int{"a wrong password": wrongWork, "an unknown email": unknownWork, "a wrong password on an old hash": legacyWork} {
		if !slices.Equal(work, want) {
			t.Errorf("%s compared against hashes of costs %v, want %v", name, work, want)
		}
	}
	if got := query[string](a, `SELECT "passwordHash" FROM "User" WHERE "id" = 'u_legacy'`); got != string(legacyHash) {
		t.Error("a failed sign-in replaced the stored hash")
	}
	// The email is matched whatever its case.
	upper := a.do(call{path: "/api/v1/auth/login", body: map[string]any{"email": strings.ToUpper(email), "password": password}})
	a.is(upper, http.StatusOK, "")
	if upper.text("user", "email") != email {
		t.Errorf("signed in as %q", upper.text("user", "email"))
	}
}

func TestWebRefreshRotatesAndAnImmediateReplayReturnsTheSameToken(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{})
	s := a.webLogin()
	first := a.refreshWeb(s.rt)
	a.is(first, http.StatusOK, "")
	rt2 := first.cookies[httpapi.RefreshCookie].Value
	if rt2 == s.rt || first.text("user", "email") != s.email || len(first.body) != 1 {
		t.Fatalf("refresh: %s", first.raw)
	}
	again := a.refreshWeb(s.rt)
	a.is(again, http.StatusOK, "")
	if again.cookies[httpapi.RefreshCookie].Value != rt2 {
		t.Error("the replay returned another refresh token")
	}
	claims, ok := a.tokens.Verify(again.cookies[httpapi.AccessCookie].Value, time.Now())
	if successor := query[string](a, `SELECT "id" FROM "Session" WHERE "tokenHash" = $1`, auth.HashToken(rt2)); !ok || claims.SID != successor {
		t.Errorf("the replay's access token is for session %q, want %q", claims.SID, successor)
	}
	if a.liveIn(a.familyOf(s.rt)) != 1 {
		t.Error("the replay rotated again")
	}
	a.is(a.refreshWeb(rt2), http.StatusOK, "")
}

func TestReuseAfterTheGraceWindowEndsThatFamilyAndClearsCookies(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{})
	s := a.webLogin()
	otherDevice := a.webLoginAs(s.email)
	a.is(a.refreshWeb(s.rt), http.StatusOK, "")
	a.ageRotation(s.rt, 61*time.Second)
	got := a.refreshWeb(s.rt)
	a.is(got, http.StatusUnauthorized, apierr.RefreshReused)
	if !got.cleared(httpapi.AccessCookie) || !got.cleared(httpapi.RefreshCookie) {
		t.Errorf("cookies after reuse: %v", got.cookies)
	}
	for _, c := range got.cookies {
		if c.Path != "/" || !c.HttpOnly || c.SameSite != http.SameSiteLaxMode {
			t.Errorf("the clearing cookie %+v would not replace the session cookie", c)
		}
	}
	if a.revokeReason(a.familyOf(s.rt)) != "reuse" {
		t.Errorf("reason %q", a.revokeReason(a.familyOf(s.rt)))
	}
	a.is(a.refreshWeb(otherDevice.rt), http.StatusOK, "")
}

func TestARaceKeepsTheCookies(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{})
	s := a.webLogin()
	a.is(a.refreshWeb(s.rt), http.StatusOK, "")
	// No stored successor: a replay inside the window cannot be served.
	a.exec(`UPDATE "Session" SET "successorTokenEnc" = NULL WHERE "tokenHash" = $1`, auth.HashToken(s.rt))
	got := a.refreshWeb(s.rt)
	a.is(got, http.StatusUnauthorized, apierr.SessionRace)
	if len(got.cookies) != 0 {
		t.Errorf("a race touched the cookies: %v", got.cookies)
	}
}

func TestExpiredUnknownAndMissingRefreshTokens(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{})
	s := a.webLogin()
	a.exec(`UPDATE "Session" SET "expiresAt" = (now() AT TIME ZONE 'UTC') - interval '1 second' WHERE "tokenHash" = $1`, auth.HashToken(s.rt))
	got := a.refreshWeb(s.rt)
	a.is(got, http.StatusUnauthorized, apierr.SessionExpired)
	if !got.cleared(httpapi.AccessCookie) || !got.cleared(httpapi.RefreshCookie) {
		t.Errorf("cookies after expiry: %v", got.cookies)
	}
	missing := a.refreshWeb("")
	a.is(missing, http.StatusUnauthorized, apierr.InvalidToken)
	unknown := a.refreshWeb("not-a-real-token")
	a.is(unknown, http.StatusUnauthorized, apierr.InvalidToken)
	if !unknown.cleared(httpapi.RefreshCookie) || !missing.cleared(httpapi.RefreshCookie) {
		t.Error("an invalid token did not clear the cookie")
	}
	// A body in web mode is not read at all, whatever it holds.
	fresh := a.webLogin()
	ignored := a.do(call{path: "/api/v1/auth/refresh", cookies: map[string]string{httpapi.RefreshCookie: fresh.rt}, body: `{not json`})
	a.is(ignored, http.StatusOK, "")
	token := a.webLogin()
	inBody := a.do(call{path: "/api/v1/auth/refresh", body: map[string]any{"refreshToken": token.rt}})
	a.is(inBody, http.StatusUnauthorized, apierr.InvalidToken) // web mode reads the cookie only
	if a.liveIn(a.familyOf(token.rt)) != 1 || a.revokeReason(a.familyOf(token.rt)) != "" {
		t.Error("a token in a web-mode body was used")
	}
}

func TestLogoutEndsTheFamilyClearsCookiesAndIsIdempotent(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{})
	s := a.webLogin()
	otherDevice := a.webLoginAs(s.email)
	both := map[string]string{httpapi.AccessCookie: s.at, httpapi.RefreshCookie: s.rt}
	got := a.do(call{path: "/api/v1/auth/logout", cookies: both})
	a.is(got, http.StatusOK, "")
	if string(bytes.TrimSpace(got.raw)) != `{"ok":true}` || !got.cleared(httpapi.AccessCookie) || !got.cleared(httpapi.RefreshCookie) {
		t.Fatalf("logout: %s, cookies %v", got.raw, got.cookies)
	}
	if a.revokeReason(a.familyOf(s.rt)) != "logout" {
		t.Errorf("reason %q", a.revokeReason(a.familyOf(s.rt)))
	}
	a.is(a.refreshWeb(s.rt), http.StatusUnauthorized, apierr.SessionRevoked)
	a.is(a.do(call{path: "/api/v1/auth/logout", cookies: both}), http.StatusOK, "")
	a.is(a.do(call{path: "/api/v1/auth/logout"}), http.StatusOK, "")
	a.is(a.refreshWeb(otherDevice.rt), http.StatusOK, "")

	// With the access cookie alone: the session it names is ended.
	b := a.webLogin()
	a.is(a.do(call{path: "/api/v1/auth/logout", cookies: map[string]string{httpapi.AccessCookie: b.at}}), http.StatusOK, "")
	if a.revokeReason(a.familyOf(b.rt)) != "logout" {
		t.Errorf("sign-out by the access token: reason %q", a.revokeReason(a.familyOf(b.rt)))
	}
}

func TestMeWithTheAccessCookie(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{})
	s := a.webLogin()
	got := a.me(call{cookies: map[string]string{httpapi.AccessCookie: s.at}})
	a.is(got, http.StatusOK, "")
	user, _ := got.body["user"].(map[string]any)
	if user["email"] != s.email || user["name"] != nil || got.body["consentRequired"] != false || len(user) != 4 || len(got.body) != 2 {
		t.Fatalf("me: %s", got.raw)
	}
	// The creation time, in UTC, as JavaScript writes it (milliseconds, Z).
	created, err := time.Parse("2006-01-02T15:04:05.000Z", got.text("user", "createdAt"))
	if err != nil || time.Since(created) > time.Minute || time.Since(created) < -time.Minute {
		t.Errorf("createdAt %q (%v)", got.text("user", "createdAt"), err)
	}
	// The request log names the caller by id (never by email), so an
	// incident can be traced to an account; an anonymous request names none.
	claims, _ := a.tokens.Verify(s.at, time.Now())
	if !strings.Contains(a.logs(), `"route":"GET /api/v1/auth/me","status":200`) || !strings.Contains(a.logs(), `"userId":"`+claims.Sub+`"`) || strings.Contains(a.logs(), s.email) {
		t.Errorf("the request log does not name the caller by id:\n%s", a.logs())
	}
	a.is(a.me(call{}), http.StatusUnauthorized, apierr.Unauthorized)
	if strings.Count(a.logs(), `"userId"`) != 1 {
		t.Errorf("an anonymous request has a userId in the log:\n%s", a.logs())
	}
	a.is(a.me(call{cookies: map[string]string{httpapi.AccessCookie: "not-a-token"}}), http.StatusUnauthorized, apierr.Unauthorized)
	// The refresh token is not an access token, in either cookie.
	a.is(a.me(call{cookies: map[string]string{httpapi.RefreshCookie: s.at}}), http.StatusUnauthorized, apierr.Unauthorized)
	a.is(a.me(call{cookies: map[string]string{httpapi.AccessCookie: s.rt}}), http.StatusUnauthorized, apierr.Unauthorized)
}

// ─── Mobile mode ─────────────────────────────────────────────────────────

func TestMobileRegisterAndLoginReturnTokensInTheBodyAndNoCookies(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{})
	m := a.mobileRegister(map[string]any{"deviceName": "  iPhone 17 ", "name": "Aziza"})
	if len(m.answer.cookies) != 0 || len(m.answer.body) != 6 || m.accessToken == "" || m.refreshToken == "" || m.answer.text("user", "name") != "Aziza" {
		t.Fatalf("register: %s, cookies %v", m.answer.raw, m.answer.cookies)
	}
	family := a.familyOf(m.refreshToken)
	if got := query[string](a, `SELECT "clientType" FROM "SessionFamily" WHERE "id" = $1`, family); got != "mobile" {
		t.Errorf("client type %s", got)
	}
	if got := query[string](a, `SELECT "deviceName" FROM "Session" WHERE "tokenHash" = $1`, auth.HashToken(m.refreshToken)); got != "iPhone 17" {
		t.Errorf("device name %q", got)
	}
	// Times as JavaScript writes them; the limits of a new session.
	parse := func(field string) time.Time {
		at, err := time.Parse("2006-01-02T15:04:05.000Z", m.answer.text(field))
		if err != nil {
			t.Fatalf("%s %q: %v", field, m.answer.text(field), err)
		}
		return at
	}
	now := time.Now()
	for field, want := range map[string]time.Duration{"accessTokenExpiresAt": 15 * time.Minute, "refreshTokenExpiresAt": 30 * 24 * time.Hour, "sessionExpiresAt": 90 * 24 * time.Hour} {
		if left := parse(field).Sub(now); left > want || left < want-time.Minute {
			t.Errorf("%s is %s from now, want %s", field, left, want)
		}
	}
	if claims, ok := a.tokens.Verify(m.accessToken, now); !ok || claims.Email != m.email {
		t.Errorf("access token %+v %v", claims, ok)
	}

	login := a.do(call{path: "/api/v1/auth/login", mobile: true, body: map[string]any{"email": m.email, "password": password, "deviceName": "iPad"}})
	a.is(login, http.StatusOK, "")
	if len(login.cookies) != 0 || login.text("refreshToken") == "" || login.text("refreshToken") == m.refreshToken {
		t.Errorf("login: %s", login.raw)
	}
	if got := query[string](a, `SELECT "deviceName" FROM "Session" WHERE "tokenHash" = $1`, auth.HashToken(login.text("refreshToken"))); got != "iPad" {
		t.Errorf("device name %q", got)
	}
	// A web sign-in stores no device name, whatever is sent.
	web := a.do(call{path: "/api/v1/auth/login", body: map[string]any{"email": m.email, "password": password, "deviceName": "Chrome"}})
	if n := query[int](a, `SELECT count(*) FROM "Session" WHERE "tokenHash" = $1 AND "deviceName" IS NULL`, auth.HashToken(web.cookies[httpapi.RefreshCookie].Value)); n != 1 {
		t.Error("a web session has a device name")
	}
}

func TestMobileRefreshBearerAccessReplayAndLogout(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{})
	m := a.mobileRegister(nil)
	a.is(a.me(call{bearer: m.accessToken}), http.StatusOK, "")

	r1 := a.refreshMobile(m.refreshToken)
	a.is(r1, http.StatusOK, "")
	if len(r1.cookies) != 0 || r1.text("refreshToken") == m.refreshToken || r1.text("sessionExpiresAt") != m.answer.text("sessionExpiresAt") {
		t.Fatalf("refresh: %s, cookies %v", r1.raw, r1.cookies)
	}
	replay := a.refreshMobile(m.refreshToken)
	a.is(replay, http.StatusOK, "")
	if replay.text("refreshToken") != r1.text("refreshToken") {
		t.Error("the replay returned another refresh token")
	}
	// A refresh cookie is not read in mobile mode; without the token in the body: 400.
	noToken := a.do(call{path: "/api/v1/auth/refresh", mobile: true, cookies: map[string]string{httpapi.RefreshCookie: r1.text("refreshToken")}, body: map[string]any{}})
	a.is(noToken, http.StatusBadRequest, apierr.ValidationError)
	a.is(a.do(call{path: "/api/v1/auth/refresh", mobile: true}), http.StatusBadRequest, apierr.ValidationError)

	out := a.do(call{path: "/api/v1/auth/logout", mobile: true, body: map[string]any{"refreshToken": r1.text("refreshToken")}})
	a.is(out, http.StatusOK, "")
	if len(out.cookies) != 0 || a.revokeReason(a.familyOf(r1.text("refreshToken"))) != "logout" {
		t.Errorf("logout: cookies %v, reason %q", out.cookies, a.revokeReason(a.familyOf(r1.text("refreshToken"))))
	}
	dead := a.refreshMobile(r1.text("refreshToken"))
	a.is(dead, http.StatusUnauthorized, apierr.SessionRevoked)
	if len(dead.cookies) != 0 {
		t.Errorf("a mobile refusal set cookies: %v", dead.cookies)
	}
	// Sign-out with only the access token (no body) ends that session too.
	n := a.mobileRegister(nil)
	a.is(a.do(call{path: "/api/v1/auth/logout", mobile: true, bearer: n.accessToken}), http.StatusOK, "")
	if a.revokeReason(a.familyOf(n.refreshToken)) != "logout" {
		t.Error("sign-out by the bearer token did not end the session")
	}
	a.is(a.do(call{path: "/api/v1/auth/logout", mobile: true, body: map[string]any{"refreshToken": ""}}), http.StatusBadRequest, apierr.ValidationError)
}

func TestAUTH03_ATokenUsedInTheOtherModeIsAMismatch(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{})
	web := a.webLogin()
	viaMobile := a.refreshMobile(web.rt)
	a.is(viaMobile, http.StatusUnauthorized, apierr.ClientMismatch)
	if len(viaMobile.cookies) != 0 {
		t.Errorf("cookies %v", viaMobile.cookies)
	}
	mobile := a.mobileRegister(nil)
	asCookie := a.refreshWeb(mobile.refreshToken)
	a.is(asCookie, http.StatusUnauthorized, apierr.ClientMismatch)
	if !asCookie.cleared(httpapi.RefreshCookie) || a.revokeReason(a.familyOf(mobile.refreshToken)) != "" {
		t.Error("a mismatch must clear the web cookies and revoke nothing")
	}
	// Any other value of the header means web.
	odd := a.do(call{path: "/api/v1/auth/refresh", headers: map[string]string{"X-Atlas-Client": "ios"}, cookies: map[string]string{httpapi.RefreshCookie: web.rt}})
	a.is(odd, http.StatusOK, "")
	if odd.cookies[httpapi.RefreshCookie] == nil {
		t.Error("no cookies for an unknown client value")
	}
}

// ─── What the Go server adds or tightens ─────────────────────────────────

func TestAnAuthorizationHeaderNeverFallsBackToCookies(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{})
	s := a.webLogin()
	cookies := map[string]string{httpapi.AccessCookie: s.at}
	a.is(a.me(call{cookies: cookies}), http.StatusOK, "")
	for name, authorization := range map[string]string{"an invalid bearer token": "Bearer nope", "an empty header": "", "another scheme": "Basic eDp5"} {
		got := a.me(call{cookies: cookies, headers: map[string]string{"Authorization": authorization}})
		if got.status != http.StatusUnauthorized {
			t.Errorf("%s next to a valid cookie: %d", name, got.status)
		}
	}
	// And a valid bearer token wins over another user's cookie.
	other := a.mobileRegister(nil)
	got := a.me(call{cookies: cookies, bearer: other.accessToken})
	if got.text("user", "email") != other.email {
		t.Errorf("signed in as %q, want the bearer's %q", got.text("user", "email"), other.email)
	}
}

func TestASessionThatEndedIsRefusedAtOnce(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{})
	cookieOf := func(at string) call { return call{cookies: map[string]string{httpapi.AccessCookie: at}} }

	// Sign-out: the access token stops working now, not in 15 minutes.
	s := a.webLogin()
	a.is(a.me(cookieOf(s.at)), http.StatusOK, "")
	a.is(a.do(call{path: "/api/v1/auth/logout", cookies: map[string]string{httpapi.RefreshCookie: s.rt}}), http.StatusOK, "")
	a.is(a.me(cookieOf(s.at)), http.StatusUnauthorized, apierr.Unauthorized)

	// A rotation does not end the old access token (requests in flight
	// during a refresh go through) …
	r := a.webLogin()
	rotated := a.refreshWeb(r.rt)
	a.is(a.me(cookieOf(r.at)), http.StatusOK, "")
	a.is(a.me(cookieOf(rotated.cookies[httpapi.AccessCookie].Value)), http.StatusOK, "")
	// … a detected reuse ends both.
	a.ageRotation(r.rt, 61*time.Second)
	a.is(a.refreshWeb(r.rt), http.StatusUnauthorized, apierr.RefreshReused)
	a.is(a.me(cookieOf(r.at)), http.StatusUnauthorized, apierr.Unauthorized)
	a.is(a.me(cookieOf(rotated.cookies[httpapi.AccessCookie].Value)), http.StatusUnauthorized, apierr.Unauthorized)

	// A token must name a session, and that session must be its user's.
	u, v := a.webLogin(), a.webLogin()
	uClaims, _ := a.tokens.Verify(u.at, time.Now())
	vClaims, _ := a.tokens.Verify(v.at, time.Now())
	in := time.Now().Add(time.Minute)
	for name, claims := range map[string]auth.Claims{
		"no session id":            {Sub: uClaims.Sub, Email: uClaims.Email},
		"another user's session":   {Sub: uClaims.Sub, Email: uClaims.Email, SID: vClaims.SID},
		"a session that never was": {Sub: uClaims.Sub, Email: uClaims.Email, SID: "c000000000000000000000000"},
	} {
		forged := a.tokens.Sign(claims, time.Now(), in)
		if got := a.me(cookieOf(forged)); got.status != http.StatusUnauthorized {
			t.Errorf("a correctly signed token with %s: %d", name, got.status)
		}
	}
	// An expired token, and one signed with another secret.
	expired := a.tokens.Sign(uClaims, time.Now().Add(-time.Hour), time.Now().Add(-time.Second))
	a.is(a.me(cookieOf(expired)), http.StatusUnauthorized, apierr.Unauthorized)
	foreign := auth.NewTokens([]byte("another-secret-another-secret-another")).Sign(uClaims, time.Now(), in)
	a.is(a.me(cookieOf(foreign)), http.StatusUnauthorized, apierr.Unauthorized)
	a.is(a.me(cookieOf(u.at)), http.StatusOK, "")

	// A deleted account: its sessions go with it.
	a.exec(`DELETE FROM "User" WHERE "id" = $1`, uClaims.Sub)
	a.is(a.me(cookieOf(u.at)), http.StatusUnauthorized, apierr.Unauthorized)
}

func TestWritesFromAnotherSiteAreRefused(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{})
	s := a.webLogin()
	both := map[string]string{httpapi.AccessCookie: s.at, httpapi.RefreshCookie: s.rt}
	evil := map[string]string{"Origin": "https://evil.example"}

	// Another site cannot sign the user out, or rotate the session …
	a.is(a.do(call{path: "/api/v1/auth/logout", cookies: both, headers: evil}), http.StatusForbidden, apierr.Forbidden)
	a.is(a.do(call{path: "/api/v1/auth/refresh", cookies: both, headers: evil}), http.StatusForbidden, apierr.Forbidden)
	if a.revokeReason(a.familyOf(s.rt)) != "" || a.liveIn(a.familyOf(s.rt)) != 1 {
		t.Fatal("a refused cross-site request changed the session")
	}
	// … or sign the browser in as somebody else (the body is not even read).
	loginBody := map[string]any{"email": s.email, "password": password}
	crossLogin := a.do(call{path: "/api/v1/auth/login", cookies: both, headers: evil, body: loginBody})
	a.is(crossLogin, http.StatusForbidden, apierr.Forbidden)
	a.is(a.do(call{path: "/api/v1/auth/register", cookies: both, headers: evil, body: registration(a.newEmail())}), http.StatusForbidden, apierr.Forbidden)
	a.is(a.do(call{path: "/api/v1/auth/logout", cookies: both, headers: map[string]string{"Origin": "null"}}), http.StatusForbidden, apierr.Forbidden)
	if !strings.Contains(a.logs(), "cross-site write rejected") {
		t.Error("the refusal is not logged")
	}

	// A browser does not send these cookies (SameSite=Lax) on a write from
	// another site, so the real attack carries none: a form on another site
	// posting a sign-in, to leave this browser signed in to the attacker's
	// account. Refused all the same, with nothing set and nobody signed in.
	sessions := query[int](a, `SELECT count(*) FROM "Session"`)
	form := map[string]string{"Origin": "https://evil.example", "Content-Type": "text/plain"}
	crossForm := a.do(call{path: "/api/v1/auth/login", headers: form, body: loginBody})
	a.is(crossForm, http.StatusForbidden, apierr.Forbidden)
	a.is(a.do(call{path: "/api/v1/auth/register", headers: form, body: registration(a.newEmail())}), http.StatusForbidden, apierr.Forbidden)
	// Nor can another site clear the session cookies through sign-out.
	crossOut := a.do(call{path: "/api/v1/auth/logout", headers: form})
	a.is(crossOut, http.StatusForbidden, apierr.Forbidden)
	if len(crossForm.cookies) != 0 || len(crossOut.cookies) != 0 || query[int](a, `SELECT count(*) FROM "Session"`) != sessions {
		t.Errorf("a refused cross-site write set cookies (%v, %v) or started a session", crossForm.cookies, crossOut.cookies)
	}

	// The same site, a request without an Origin (the mobile app sends
	// none) and one with an Authorization header all pass.
	a.is(a.do(call{path: "/api/v1/auth/login", cookies: both, headers: map[string]string{"Origin": "https://app.example.uz"}, body: loginBody}), http.StatusOK, "")
	a.is(a.do(call{path: "/api/v1/auth/login", cookies: both, body: loginBody}), http.StatusOK, "")
	a.is(a.do(call{path: "/api/v1/auth/login", mobile: true, body: loginBody}), http.StatusOK, "")
	m := a.mobileRegister(nil)
	a.is(a.do(call{path: "/api/v1/auth/logout", mobile: true, cookies: both, headers: evil, bearer: m.accessToken}), http.StatusOK, "")
	// Reading is never refused.
	a.is(a.me(call{cookies: both, headers: evil}), http.StatusOK, "")
}

// The consent gate, on a route as later stages add them: not in the gate's
// table, so it needs a session and a current consent.
func TestTheConsentGateAndWhatItExempts(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{})
	var caller httpapi.Identity
	reached := 0
	gated := httpapi.Gated(a.gate, slog.New(slog.NewJSONHandler(io.Discard, nil)), "GET /api/v1/profile", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reached++
		caller, _ = httpapi.IdentityFrom(r.Context())
		w.WriteHeader(http.StatusNoContent)
	}))
	profile := func(at string) (int, string) {
		r := httptest.NewRequest(http.MethodGet, "http://app.example.uz/api/v1/profile", nil)
		if at != "" {
			r.Header.Set("Authorization", "Bearer "+at)
		}
		w := httptest.NewRecorder()
		gated.ServeHTTP(w, r)
		if w.Code == http.StatusNoContent {
			return w.Code, ""
		}
		contracttest.Response(t, http.MethodGet, "/api/v1/profile", w.Code, w.Header(), w.Body.Bytes())
		var body struct{ Code string }
		_ = json.Unmarshal(w.Body.Bytes(), &body)
		return w.Code, body.Code
	}

	m := a.mobileRegister(nil)
	claims, _ := a.tokens.Verify(m.accessToken, time.Now())
	if status, code := profile(""); status != http.StatusUnauthorized || code != "UNAUTHORIZED" || reached != 0 {
		t.Fatalf("no token: %d %s, handler reached %d times", status, code, reached)
	}
	if status, _ := profile(m.accessToken); status != http.StatusNoContent || reached != 1 {
		t.Fatalf("current consent: %d, handler reached %d times", status, reached)
	}
	if caller != (httpapi.Identity{UserID: claims.Sub, Email: m.email, SessionID: claims.SID}) {
		t.Errorf("the handler saw %+v", caller)
	}

	// The texts changed: the consent on record is older than the minimum.
	a.exec(`UPDATE "LegalConsent" SET "version" = '2026-10-17.1-draft' WHERE "userId" = $1`, claims.Sub)
	if status, code := profile(m.accessToken); status != http.StatusForbidden || code != "CONSENT_REQUIRED" || reached != 1 {
		t.Fatalf("outdated consent: %d %s, handler reached %d times", status, code, reached)
	}
	// "Who am I" still answers, and says that consent is required; sign-out works.
	me := a.me(call{bearer: m.accessToken})
	a.is(me, http.StatusOK, "")
	if me.body["consentRequired"] != true {
		t.Errorf("me: %s", me.raw)
	}
	// One valid consent among older ones is enough; none at all is not.
	a.exec(`INSERT INTO "LegalConsent" ("id","userId","version","ageConfirmed") VALUES ('lc_new', $1, $2, true)`, claims.Sub, legal.MinConsentVersion)
	if status, _ := profile(m.accessToken); status != http.StatusNoContent {
		t.Errorf("after accepting the minimum version: %d", status)
	}
	a.exec(`DELETE FROM "LegalConsent" WHERE "userId" = $1`, claims.Sub)
	if status, code := profile(m.accessToken); status != http.StatusForbidden || code != "CONSENT_REQUIRED" {
		t.Errorf("no consent at all: %d %s", status, code)
	}
	a.is(a.do(call{path: "/api/v1/auth/logout", mobile: true, bearer: m.accessToken}), http.StatusOK, "")
	if status, code := profile(m.accessToken); status != http.StatusUnauthorized || code != "UNAUTHORIZED" {
		t.Errorf("after sign-out: %d %s", status, code)
	}
}

func TestRegistrationCreatesTheAccountWithItsCompanionRows(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{})
	body := registration("Aziza.Karimova@Example.UZ")
	body["name"] = "Aziza"
	got := a.do(call{path: "/api/v1/auth/register", body: body})
	a.is(got, http.StatusCreated, "")
	if got.text("user", "email") != "aziza.karimova@example.uz" || got.text("user", "name") != "Aziza" {
		t.Fatalf("user: %s", got.raw)
	}
	id := got.text("user", "id")
	if len(id) != 25 || id[0] != 'c' {
		t.Errorf("id %q", id)
	}
	var email, hash string
	var name *string
	var createdDrift, updatedDrift float64
	if err := a.pool.QueryRow(context.Background(), `
		SELECT "email", "name", "passwordHash",
		       abs(extract(epoch FROM "createdAt" - (now() AT TIME ZONE 'UTC')))::float8,
		       abs(extract(epoch FROM "updatedAt" - (now() AT TIME ZONE 'UTC')))::float8
		  FROM "User" WHERE "id" = $1`, id).Scan(&email, &name, &hash, &createdDrift, &updatedDrift); err != nil {
		t.Fatal(err)
	}
	if email != "aziza.karimova@example.uz" || name == nil || *name != "Aziza" || createdDrift > 60 || updatedDrift > 60 {
		t.Errorf("stored user: %s %v, times %v s and %v s from UTC now", email, name, createdDrift, updatedDrift)
	}
	if hash == password || !auth.VerifyPassword(password, hash) {
		t.Error("the password is not stored as its hash")
	}
	if n := query[int](a, `SELECT count(*) FROM "UserProfile" WHERE "userId" = $1`, id); n != 1 {
		t.Errorf("%d profiles", n)
	}
	if got := query[string](a, `SELECT "preferredStyles" || "dislikedStyles" || "favoriteColors" || "dislikedColors" || "language" FROM "UserPreferences" WHERE "userId" = $1`, id); got != "[][][][]uz" {
		t.Errorf("preferences %q", got)
	}
	if got := query[string](a, `SELECT "version" || ' ' || "ageConfirmed"::text FROM "LegalConsent" WHERE "userId" = $1`, id); got != legal.Version+" true" {
		t.Errorf("consent %q", got)
	}
	if drift := query[float64](a, `SELECT abs(extract(epoch FROM "acceptedAt" - (now() AT TIME ZONE 'UTC')))::float8 FROM "LegalConsent" WHERE "userId" = $1`, id); drift > 60 {
		t.Errorf("consent time is %v s from UTC now", drift)
	}

	// A name with a character PostgreSQL cannot store (NUL) loses it; the
	// registration does not fail on it.
	odd := registration(a.newEmail())
	odd["name"] = "Az\u0000iza"
	stored := a.do(call{path: "/api/v1/auth/register", body: odd})
	a.is(stored, http.StatusCreated, "")
	if stored.text("user", "name") != "Aziza" {
		t.Errorf("name stored as %q", stored.text("user", "name"))
	}
	onlyNUL := registration(a.newEmail())
	onlyNUL["name"] = "\u0000"
	if got := a.do(call{path: "/api/v1/auth/register", body: onlyNUL}); got.status != http.StatusCreated || got.body["user"].(map[string]any)["name"] != nil {
		t.Errorf("a name of NUL alone: %d %s", got.status, got.raw)
	}
	a.exec(`DELETE FROM "User" WHERE "email" <> 'aziza.karimova@example.uz'`)

	// The same email again, in any case: a conflict, with nothing created.
	again := registration("AZIZA.KARIMOVA@example.uz")
	conflict := a.do(call{path: "/api/v1/auth/register", body: again})
	a.is(conflict, http.StatusConflict, apierr.Conflict)
	if conflict.text("error") != "Bu email allaqachon ro‘yxatdan o‘tgan" || len(conflict.cookies) != 0 {
		t.Errorf("conflict: %s", conflict.raw)
	}
	if n := query[int](a, `SELECT count(*) FROM "User"`); n != 1 {
		t.Errorf("%d users", n)
	}
}

func TestTwoRegistrationsOfOneEmailAtOnceGiveOneAccount(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{})
	for round := range 8 {
		email := a.newEmail()
		const racers = 4
		statuses := make(chan int, racers)
		var wg sync.WaitGroup
		for range racers {
			wg.Add(1)
			go func() {
				defer wg.Done()
				r := httptest.NewRequest(http.MethodPost, "http://app.example.uz/api/v1/auth/register", strings.NewReader(mustJSON(registration(email))))
				w := httptest.NewRecorder()
				a.handler.ServeHTTP(w, r)
				statuses <- w.Code
			}()
		}
		wg.Wait()
		close(statuses)
		counts := map[int]int{}
		for status := range statuses {
			counts[status]++
		}
		if counts[http.StatusCreated] != 1 || counts[http.StatusConflict] != racers-1 {
			t.Fatalf("round %d: statuses %v, want one 201 and the rest 409", round, counts)
		}
		for _, table := range []string{"User", "UserProfile", "UserPreferences", "LegalConsent"} {
			column := `"userId"`
			if table == "User" {
				column = `"id"`
			}
			n := query[int](a, fmt.Sprintf(`SELECT count(*) FROM %q WHERE %s IN (SELECT "id" FROM "User" WHERE "email" = $1)`, table, column), email)
			if n != 1 {
				t.Fatalf("round %d: %d rows in %s for the email", round, n, table)
			}
		}
	}
	if n := query[int](a, `SELECT (SELECT count(*) FROM "UserProfile") + (SELECT count(*) FROM "UserPreferences") + (SELECT count(*) FROM "LegalConsent") - 3 * (SELECT count(*) FROM "User")`); n != 0 {
		t.Errorf("rows without their user, or users without their rows: %d", n)
	}
}

func mustJSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return string(b)
}

func TestPasswordsAtRegistrationAreAtMost72Bytes(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{})
	register := func(pw string) answer {
		body := registration(a.newEmail())
		body["password"] = pw
		return a.do(call{path: "/api/v1/auth/register", body: body})
	}
	a.is(register(strings.Repeat("p", 72)), http.StatusCreated, "")
	a.is(register(strings.Repeat("ў", 36)), http.StatusCreated, "") // 36 characters, 72 bytes
	for _, long := range []string{strings.Repeat("p", 73), strings.Repeat("ў", 37), strings.Repeat("p", 200)} {
		got := register(long)
		a.is(got, http.StatusBadRequest, apierr.ValidationError)
		details, _ := got.body["details"].([]any)
		first, _ := details[0].(map[string]any)
		if len(details) != 1 || first["path"] != "password" || first["message"] != accounts.MsgPasswordTooLong || got.text("error") != accounts.MsgPasswordTooLong {
			t.Errorf("%d bytes: %s", len(long), got.raw)
		}
	}
	if n := query[int](a, `SELECT count(*) FROM "User"`); n != 2 {
		t.Errorf("%d users, want the two with passwords of 72 bytes", n)
	}
}

// Accounts of the old server keep signing in, and get a stronger hash.
func TestOldHashesSignInAndAreReplaced(t *testing.T) {
	t.Parallel()
	g := golden.LoadAuth(t)
	a := newAPI(t, apiOptions{hasher: auth.Bcrypt{}}) // the real hasher: cost 12
	insert := func(id, email, hash string) {
		a.exec(`INSERT INTO "User" ("id","email","passwordHash","updatedAt") VALUES ($1, $2, $3, now())`, id, email, hash)
		a.exec(`INSERT INTO "LegalConsent" ("id","userId","version","ageConfirmed") VALUES ($1, $2, $3, true)`, "lc_"+id, id, legal.Version)
	}
	// A password hashed by the old server (bcryptjs, cost 10).
	short := g.Bcrypt[0]
	insert("u_old", "old@test.local", short.Hash)
	wrong := a.do(call{path: "/api/v1/auth/login", body: map[string]any{"email": "old@test.local", "password": short.Password + "x"}})
	a.is(wrong, http.StatusUnauthorized, apierr.Unauthorized)
	if got := query[string](a, `SELECT "passwordHash" FROM "User" WHERE "id" = 'u_old'`); got != short.Hash {
		t.Fatal("a failed sign-in changed the stored hash")
	}
	a.is(a.do(call{path: "/api/v1/auth/login", body: map[string]any{"email": "old@test.local", "password": short.Password}}), http.StatusOK, "")
	stored := query[string](a, `SELECT "passwordHash" FROM "User" WHERE "id" = 'u_old'`)
	if cost, err := bcrypt.Cost([]byte(stored)); err != nil || cost != auth.PasswordCost || stored == short.Hash {
		t.Fatalf("after signing in the hash is %q (cost %d, %v), want a new one at cost %d", stored, cost, err, auth.PasswordCost)
	}
	if !auth.VerifyPassword(short.Password, stored) {
		t.Fatal("the new hash is not of the same password")
	}
	a.is(a.do(call{path: "/api/v1/auth/login", body: map[string]any{"email": "old@test.local", "password": short.Password}}), http.StatusOK, "")
	if again := query[string](a, `SELECT "passwordHash" FROM "User" WHERE "id" = 'u_old'`); again != stored {
		t.Error("a hash of the current cost was replaced again")
	}

	// A password over 72 bytes set under the old server: it still signs in
	// (bcrypt always read its first 72 bytes), and its hash is left alone.
	var long struct{ Password, Hash string }
	for _, c := range g.Bcrypt {
		if c.Bytes > 72 && c.Bytes <= 200 {
			long.Password, long.Hash = c.Password, c.Hash
		}
	}
	if long.Hash == "" {
		t.Fatal("no long password among the vectors")
	}
	insert("u_long", "long@test.local", long.Hash)
	a.is(a.do(call{path: "/api/v1/auth/login", body: map[string]any{"email": "long@test.local", "password": long.Password}}), http.StatusOK, "")
	if got := query[string](a, `SELECT "passwordHash" FROM "User" WHERE "id" = 'u_long'`); got != long.Hash {
		t.Error("the hash of a password over 72 bytes was replaced")
	}
	// Expected, so not a warning: only real failures to re-hash are logged.
	if strings.Contains(a.logs(), "could not be hashed again") || strings.Contains(a.logs(), "could not be stored") {
		t.Errorf("a sign-in logged a re-hash problem:\n%s", a.logs())
	}
}

func TestSignInAttemptsAreLimitedPerAccountOnFailuresOnly(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{})
	t0 := time.Now().UTC().Truncate(time.Second)
	dbtest.SetClock(t, a.pool, t0)
	victim, bystander := a.newEmail(), a.newEmail()
	for _, email := range []string{victim, bystander} {
		a.is(a.do(call{path: "/api/v1/auth/register", body: registration(email)}), http.StatusCreated, "")
	}
	attempt := func(email, pw string) answer {
		return a.do(call{path: "/api/v1/auth/login", body: map[string]any{"email": email, "password": pw}})
	}
	// Successes are not counted, however many.
	for range 15 {
		a.is(attempt(victim, password), http.StatusOK, "")
	}
	// Ten failures pass (as failures); the eleventh attempt is refused, even
	// with the right password, until the window ends.
	for i := 1; i <= 10; i++ {
		a.is(attempt(strings.ToUpper(victim), "wrong-password"), http.StatusUnauthorized, apierr.Unauthorized)
		if i == 5 {
			a.is(attempt(victim, password), http.StatusOK, "") // a success in between clears nothing
		}
	}
	dbtest.SetClock(t, a.pool, t0.Add(4*time.Minute+500*time.Millisecond))
	for _, pw := range []string{"wrong-password", password} {
		limited := attempt(victim, pw)
		a.is(limited, http.StatusTooManyRequests, apierr.RateLimited)
		if got := limited.header.Get("Retry-After"); got != "660" { // 10 min 59.5 s left, rounded up
			t.Errorf("Retry-After %q, want 660", got)
		}
		if len(limited.cookies) != 0 {
			t.Error("a limited attempt set cookies")
		}
	}
	before := a.hasher.comparisons()
	attempt(victim, password)
	if a.hasher.comparisons() != before {
		t.Error("a limited attempt still compared the password")
	}
	// Another account is not affected, nor is an unknown email.
	a.is(attempt(bystander, password), http.StatusOK, "")
	a.is(attempt("nobody@test.local", "x"), http.StatusUnauthorized, apierr.Unauthorized)
	// The window ends on the database clock.
	dbtest.SetClock(t, a.pool, t0.Add(15*time.Minute-time.Millisecond))
	a.is(attempt(victim, password), http.StatusTooManyRequests, apierr.RateLimited)
	dbtest.SetClock(t, a.pool, t0.Add(15*time.Minute))
	a.is(attempt(victim, password), http.StatusOK, "")

	// Neither the email nor anything computed from it alone is stored.
	rows, err := a.pool.Query(context.Background(), `SELECT "key" FROM "RateLimitBucket"`)
	if err != nil {
		t.Fatal(err)
	}
	keys, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil || len(keys) == 0 {
		t.Fatalf("keys %v (%v)", keys, err)
	}
	for _, key := range keys {
		if strings.Contains(key, "@") || strings.Contains(key, victim) || key == auth.HashToken(victim) || len(key) != 64 {
			t.Errorf("stored key %q", key)
		}
	}
}

func TestSignInAttemptsAreLimitedPerAddressBehindTheTrustedProxy(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{trustProxy: true})
	from := func(address, email string) answer {
		return a.do(call{path: "/api/v1/auth/login", headers: map[string]string{"X-Forwarded-For": "10.0.0.1, " + address}, body: map[string]any{"email": email, "password": "wrong-password"}})
	}
	// Fifty failures from one address, spread over many accounts.
	for i := range 50 {
		a.is(from("203.0.113.7", fmt.Sprintf("spray%d@test.local", i)), http.StatusUnauthorized, apierr.Unauthorized)
	}
	limited := from("203.0.113.7", "one-more@test.local")
	a.is(limited, http.StatusTooManyRequests, apierr.RateLimited)
	if seconds, err := strconv.Atoi(limited.header.Get("Retry-After")); err != nil || seconds < 1 || seconds > 900 {
		t.Errorf("Retry-After %q", limited.header.Get("Retry-After"))
	}
	// The refused attempt did not use up that account's own attempts, and
	// another address goes on.
	a.is(from("198.51.100.4", "one-more@test.local"), http.StatusUnauthorized, apierr.Unauthorized)
	// Addresses of one IPv6 network (/64) count together; another network apart.
	for i := range 50 {
		a.is(from(fmt.Sprintf("2001:db8:1:2::%x", i+1), fmt.Sprintf("v6-%d@test.local", i)), http.StatusUnauthorized, apierr.Unauthorized)
	}
	a.is(from("2001:db8:1:2:ffff::1", "v6-more@test.local"), http.StatusTooManyRequests, apierr.RateLimited)
	a.is(from("2001:db8:1:3::1", "v6-more@test.local"), http.StatusUnauthorized, apierr.Unauthorized)
}

func TestRegistrationsAreLimited(t *testing.T) {
	t.Parallel()
	t.Run("per address behind the trusted proxy", func(t *testing.T) {
		t.Parallel()
		a := newAPI(t, apiOptions{trustProxy: true})
		from := func(address string, body map[string]any) answer {
			return a.do(call{path: "/api/v1/auth/register", headers: map[string]string{"X-Forwarded-For": address}, body: body})
		}
		taken := a.newEmail()
		a.is(from("203.0.113.7", registration(taken)), http.StatusCreated, "")
		// Every attempt that reaches the service counts, also one that finds
		// the email taken (the answer says whether an email is registered).
		for i := 2; i <= 10; i++ {
			body := registration(a.newEmail())
			want := http.StatusCreated
			if i%2 == 0 {
				body, want = registration(taken), http.StatusConflict
			}
			if got := from("203.0.113.7", body); got.status != want {
				t.Fatalf("attempt %d: %d, want %d", i, got.status, want)
			}
		}
		limited := from("203.0.113.7", registration(a.newEmail()))
		a.is(limited, http.StatusTooManyRequests, apierr.RateLimited)
		if seconds, err := strconv.Atoi(limited.header.Get("Retry-After")); err != nil || seconds < 3500 || seconds > 3600 {
			t.Errorf("Retry-After %q, want about an hour", limited.header.Get("Retry-After"))
		}
		// A body that fails validation is not counted; another address is not limited.
		invalid := registration("not-an-email")
		for range 15 {
			a.is(from("198.51.100.4", invalid), http.StatusBadRequest, apierr.ValidationError)
		}
		a.is(from("198.51.100.4", registration(a.newEmail())), http.StatusCreated, "")
	})
	t.Run("in one shared bucket when the address is unknown", func(t *testing.T) {
		t.Parallel()
		a := newAPI(t, apiOptions{})
		// Forwarding headers are not believed without the trusted proxy.
		for i := range 100 {
			got := a.do(call{path: "/api/v1/auth/register", headers: map[string]string{"X-Forwarded-For": fmt.Sprintf("203.0.113.%d", i)}, body: registration(a.newEmail())})
			if got.status != http.StatusCreated {
				t.Fatalf("registration %d: %d %s", i+1, got.status, got.raw)
			}
		}
		a.is(a.do(call{path: "/api/v1/auth/register", body: registration(a.newEmail())}), http.StatusTooManyRequests, apierr.RateLimited)
		// Sign-in has no shared bucket: nobody can lock everyone out.
		a.is(a.do(call{path: "/api/v1/auth/login", body: map[string]any{"email": "user1@test.local", "password": password}}), http.StatusOK, "")
	})
}

func TestABusySessionStoreAnswers503AndKeepsTheCookies(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{lockTimeout: 300 * time.Millisecond})
	s := a.webLogin()
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dbtest.URL(a.pool))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(ctx)
	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `SELECT 1 FROM "SessionFamily" WHERE "id" = $1 FOR UPDATE`, a.familyOf(s.rt)); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/api/v1/auth/refresh", "/api/v1/auth/logout"} {
		busy := a.do(call{path: path, cookies: map[string]string{httpapi.RefreshCookie: s.rt}})
		a.is(busy, http.StatusServiceUnavailable, apierr.SessionBusy)
		if busy.header.Get("Retry-After") != "1" || len(busy.cookies) != 0 {
			t.Errorf("%s: Retry-After %q, cookies %v", path, busy.header.Get("Retry-After"), busy.cookies)
		}
	}
	if err := tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	a.is(a.refreshWeb(s.rt), http.StatusOK, "")
}

// Starting a session can find the store busy too. Both servers then answer
// 503 on sign-in and registration, which the contract does not list for
// those operations (knownContractGaps).
func TestABusyStoreAtSignInAnswers503(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{lockTimeout: 300 * time.Millisecond})
	known := a.newEmail()
	a.is(a.do(call{path: "/api/v1/auth/register", body: registration(known)}), http.StatusCreated, "")
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dbtest.URL(a.pool))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(ctx)
	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `LOCK TABLE "SessionFamily" IN ACCESS EXCLUSIVE MODE`); err != nil {
		t.Fatal(err)
	}
	busyLogin := a.do(call{path: "/api/v1/auth/login", body: map[string]any{"email": known, "password": password}})
	fresh := a.newEmail()
	busyRegister := a.do(call{path: "/api/v1/auth/register", body: registration(fresh)})
	for name, busy := range map[string]answer{"login": busyLogin, "register": busyRegister} {
		a.is(busy, http.StatusServiceUnavailable, apierr.SessionBusy)
		if busy.header.Get("Retry-After") != "1" || len(busy.cookies) != 0 {
			t.Errorf("%s: Retry-After %q, cookies %v", name, busy.header.Get("Retry-After"), busy.cookies)
		}
	}
	if err := tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	// The sign-in works once the store is free. The registration had
	// already created its account (as on the Next.js API, the session
	// starts after it): the same request again is a conflict, and the
	// person signs in instead.
	a.is(a.do(call{path: "/api/v1/auth/login", body: map[string]any{"email": known, "password": password}}), http.StatusOK, "")
	a.is(a.do(call{path: "/api/v1/auth/register", body: registration(fresh)}), http.StatusConflict, apierr.Conflict)
	a.is(a.do(call{path: "/api/v1/auth/login", body: map[string]any{"email": fresh, "password": password}}), http.StatusOK, "")
}

// Bodies through the real router: the gate judges them before the generated
// decoder (the vectors of auth-validation.json cover the rules themselves).
func TestRequestBodiesThroughTheRouter(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{})
	g := golden.LoadAuthValidation(t)
	for _, section := range []struct {
		path   string
		mobile bool
		cases  []golden.ValidationCase
	}{
		{"/api/v1/auth/login", false, g.Login},
		{"/api/v1/auth/register", false, g.Register},
		{"/api/v1/auth/refresh", true, g.Refresh},
		{"/api/v1/auth/logout", true, g.Logout},
	} {
		refused := 0
		for _, c := range section.cases {
			if c.OK {
				continue
			}
			refused++
			got := a.do(call{path: section.path, mobile: section.mobile, body: c.Body})
			if got.status != c.Status || got.text("code") != c.Code || got.text("error") != c.Error {
				t.Errorf("%s, %s: %d %s %q, want %d %s %q", section.path, c.Name, got.status, got.text("code"), got.text("error"), c.Status, c.Code, c.Error)
			}
		}
		if refused < 10 {
			t.Errorf("%s: %d refused vectors", section.path, refused)
		}
	}
	if n := query[int](a, `SELECT count(*) FROM "User"`); n != 0 {
		t.Errorf("an invalid request created %d users", n)
	}
	// Over the body limit: 413, whatever the body says.
	big := `{"email":"a@test.local","password":"` + strings.Repeat("p", httpapi.DefaultBodyLimit) + `"}`
	a.is(a.do(call{path: "/api/v1/auth/login", body: big}), http.StatusRequestEntityTooLarge, apierr.PayloadTooLarge)
	// The client mode header twice is refused by the generated router (the
	// Next.js API read it as web mode).
	r := httptest.NewRequest(http.MethodPost, "http://app.example.uz/api/v1/auth/logout", nil)
	r.Header.Add("X-Atlas-Client", "mobile")
	r.Header.Add("X-Atlas-Client", "mobile")
	w := httptest.NewRecorder()
	a.handler.ServeHTTP(w, r)
	if w.Code != http.StatusBadRequest {
		t.Errorf("the client header twice: %d", w.Code)
	}
}

// ─── Client recovery vectors ─────────────────────────────────────────────

// docs/api/client-recovery-vectors.json tells the clients (web and mobile)
// what to do after each answer of POST /auth/refresh. This test makes the
// server give every answer the vectors name, in both modes, and checks what
// the clients rely on: the code, Retry-After, and what happens to the web
// cookies (set on success, cleared on a terminal code, untouched otherwise).
func TestTheServerGivesTheRefreshAnswersOfTheRecoveryVectors(t *testing.T) {
	t.Parallel()
	raw, err := os.ReadFile(contracttest.RepoPath("docs/api/client-recovery-vectors.json"))
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Rules struct {
			TerminalCodes []string `json:"terminalCodes"`
		} `json:"rules"`
		Vectors []struct {
			ID               string `json:"id"`
			RefreshResponses []struct {
				Status            int    `json:"status"`
				Code              string `json:"code"`
				RetryAfterSeconds int    `json:"retryAfterSeconds"`
				Network           string `json:"network"`
			} `json:"refreshResponses"`
		} `json:"vectors"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	// The codes after which a client discards its tokens are the ones after
	// which the server clears the web cookies.
	want, got := slices.Sorted(slices.Values(doc.Rules.TerminalCodes)), slices.Sorted(slices.Values(httpapi.TerminalCodes()))
	if !slices.Equal(want, got) || len(want) != 5 {
		t.Fatalf("terminal codes: the vectors say %v, the server clears cookies on %v", want, got)
	}

	a := newAPI(t, apiOptions{lockTimeout: 300 * time.Millisecond})
	for _, mobile := range []bool{false, true} {
		mode := map[bool]string{false: "web", true: "mobile"}[mobile]
		// signIn gives a fresh session's refresh token; refresh presents one.
		signIn := func() string {
			if mobile {
				return a.mobileRegister(nil).refreshToken
			}
			return a.webLogin().rt
		}
		refresh := func(token string) answer {
			if mobile {
				return a.refreshMobile(token)
			}
			return a.refreshWeb(token)
		}
		// next is the refresh token a successful answer carries.
		next := func(ok answer) string {
			if mobile {
				return ok.text("refreshToken")
			}
			return ok.cookies[httpapi.RefreshCookie].Value
		}
		lockFamily := func(token string) (release func()) {
			ctx := context.Background()
			conn, err := pgx.Connect(ctx, dbtest.URL(a.pool))
			if err != nil {
				t.Fatal(err)
			}
			tx, err := conn.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := tx.Exec(ctx, `SELECT 1 FROM "SessionFamily" WHERE "id" = $1 FOR UPDATE`, a.familyOf(token)); err != nil {
				t.Fatal(err)
			}
			return func() {
				_ = tx.Rollback(ctx)
				conn.Close(ctx)
			}
		}

		// Each situation returns the answer under test and, when the session
		// must still work afterwards, the token that proves it.
		situations := map[string]func() (answer, string){
			"200": func() (answer, string) {
				ok := refresh(signIn())
				return ok, next(ok)
			},
			"401 SESSION_RACE": func() (answer, string) {
				token := signIn()
				rotated := refresh(token)
				a.exec(`UPDATE "Session" SET "successorTokenEnc" = NULL WHERE "tokenHash" = $1`, auth.HashToken(token))
				return refresh(token), next(rotated) // V03: the next refresh, with the current token, succeeds
			},
			"503 SESSION_BUSY": func() (answer, string) {
				token := signIn()
				release := lockFamily(token)
				defer release()
				// V07: three in a row, and nothing changes.
				refresh(token)
				refresh(token)
				return refresh(token), token // V06: once the store is free, the same token works
			},
			"401 INVALID_TOKEN": func() (answer, string) { return refresh(auth.NewRefreshToken()), "" },
			"401 SESSION_EXPIRED": func() (answer, string) {
				token := signIn()
				a.exec(`UPDATE "Session" SET "expiresAt" = (now() AT TIME ZONE 'UTC') - interval '1 second' WHERE "tokenHash" = $1`, auth.HashToken(token))
				return refresh(token), ""
			},
			"401 SESSION_REVOKED": func() (answer, string) {
				token := signIn()
				if err := a.sessions.End(context.Background(), session.EndOptions{RefreshToken: token}); err != nil {
					t.Fatal(err)
				}
				return refresh(token), ""
			},
			"401 REFRESH_REUSED": func() (answer, string) {
				token := signIn()
				refresh(token)
				a.ageRotation(token, 61*time.Second)
				return refresh(token), ""
			},
			"401 CLIENT_MISMATCH": func() (answer, string) {
				if mobile {
					return refresh(a.webLogin().rt), ""
				}
				return refresh(a.mobileRegister(nil).refreshToken), ""
			},
		}

		seen := map[string]bool{}
		for _, vector := range doc.Vectors {
			for _, response := range vector.RefreshResponses {
				if response.Network != "" {
					continue // no answer at all: nothing for the server to give
				}
				codes := []string{response.Code}
				if response.Code == "<each terminal code>" {
					codes = doc.Rules.TerminalCodes
				}
				for _, code := range codes {
					key := strings.TrimSpace(fmt.Sprintf("%d %s", response.Status, code))
					if seen[key] {
						continue
					}
					seen[key] = true
					situation, known := situations[key]
					if !known {
						t.Errorf("%s (%s): no situation makes the server answer %s", vector.ID, mode, key)
						continue
					}
					got, stillGood := situation()
					if got.status != response.Status || got.text("code") != code {
						t.Errorf("%s (%s): got %d %q, want %s", vector.ID, mode, got.status, got.text("code"), key)
						continue
					}
					if response.RetryAfterSeconds > 0 && got.header.Get("Retry-After") != strconv.Itoa(response.RetryAfterSeconds) {
						t.Errorf("%s (%s): Retry-After %q, want %d", vector.ID, mode, got.header.Get("Retry-After"), response.RetryAfterSeconds)
					}
					terminalCode := slices.Contains(doc.Rules.TerminalCodes, code)
					switch {
					case mobile && len(got.cookies) != 0:
						t.Errorf("%s (mobile): cookies %v", vector.ID, got.cookies)
					case mobile && response.Status == http.StatusOK && (got.text("accessToken") == "" || got.text("refreshToken") == ""):
						t.Errorf("%s (mobile): no tokens in %s", vector.ID, got.raw)
					case !mobile && response.Status == http.StatusOK && (got.cookies[httpapi.AccessCookie] == nil || got.cookies[httpapi.RefreshCookie] == nil || got.cleared(httpapi.RefreshCookie)):
						t.Errorf("%s (web): a successful refresh set %v", vector.ID, got.cookies)
					case !mobile && terminalCode && !(got.cleared(httpapi.AccessCookie) && got.cleared(httpapi.RefreshCookie)):
						t.Errorf("%s (web): %s did not clear the cookies: %v", vector.ID, code, got.cookies)
					case !mobile && response.Status != http.StatusOK && !terminalCode && len(got.cookies) != 0:
						t.Errorf("%s (web): %s touched the cookies: %v", vector.ID, code, got.cookies)
					}
					if stillGood != "" {
						if after := refresh(stillGood); after.status != http.StatusOK {
							t.Errorf("%s (%s): after %s the session's token answers %d %s", vector.ID, mode, key, after.status, after.text("code"))
						}
					}
				}
			}
		}
		if len(seen) != len(situations) {
			t.Errorf("%s: the vectors name %d answers, the test has %d situations", mode, len(seen), len(situations))
		}
	}
}
