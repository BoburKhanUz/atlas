//go:build integration

// The session protocol against a real PostgreSQL, ported case by case from
// apps/web/tests/integration/session-protocol.itest.ts (the ids in the test
// names are that file's). Two services on two pools stand in for two app
// instances. Time is the database test clock; waits are condition-based
// (pg_stat_activity), never sleeps.

package session_test

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"lookly/internal/apierr"
	"lookly/internal/auth"
	"lookly/internal/dbtest"
	"lookly/internal/session"
	"lookly/migrations"
)

const day = 24 * time.Hour

// world is one database with its own test clock and two app instances.
type world struct {
	t      *testing.T
	pool   *pgxpool.Pool // setup and assertions
	a, b   *session.Service
	tokens auth.Tokens
	keys   session.Keys
	t0     time.Time
	seq    int
}

func randomKey(t testing.TB) []byte {
	t.Helper()
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatal(err)
	}
	return key
}

// newWorld builds a database with the shared schema. testClock false keeps
// the production atlas_now().
func newWorld(t *testing.T, testClock bool) *world {
	t.Helper()
	ctx := context.Background()
	pool := dbtest.Empty(t)
	if err := migrations.Apply(ctx, pool); err != nil {
		t.Fatal(err)
	}
	// The server's time zone is not UTC, as on a real deployment: every time
	// the protocol stores must be UTC all the same.
	if _, err := pool.Exec(ctx, `DO $$ BEGIN EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'Asia/Tashkent'); END $$`); err != nil {
		t.Fatal(err)
	}
	w := &world{
		t:      t,
		pool:   pool,
		tokens: auth.NewTokens([]byte("protocol-test-secret-protocol-test-secret")),
		keys:   session.Keys{Active: randomKey(t)},
	}
	if testClock {
		dbtest.InstallTestClock(t, pool)
		w.resetClock()
	}
	w.a = w.service(w.keys)
	w.b = w.service(w.keys)
	return w
}

// service is one app instance: its own pool on the database.
func (w *world) service(keys session.Keys, opts ...session.Option) *session.Service {
	w.t.Helper()
	pool, err := pgxpool.New(context.Background(), dbtest.URL(w.pool))
	if err != nil {
		w.t.Fatal(err)
	}
	w.t.Cleanup(pool.Close)
	var zone string
	if err := pool.QueryRow(context.Background(), `SHOW TimeZone`).Scan(&zone); err != nil || zone == "UTC" {
		w.t.Fatalf("the instance's time zone is %q (%v): expected a non-UTC zone", zone, err)
	}
	return session.New(pool, session.Config{
		Tokens:     w.tokens,
		Keys:       keys,
		AccessTTL:  15 * time.Minute,
		RefreshTTL: 30 * day,
		Log:        slog.New(slog.NewTextHandler(io.Discard, nil)),
	}, opts...)
}

// resetClock starts the test clock at a whole second close to real time, so
// that access tokens verify against the system clock.
func (w *world) resetClock() {
	w.t0 = time.Now().UTC().Truncate(time.Second)
	w.clock(0)
}

func (w *world) at(d time.Duration) time.Time { return w.t0.Add(d) }

func (w *world) clock(d time.Duration) { dbtest.SetClock(w.t, w.pool, w.at(d)) }

func (w *world) exec(sql string, args ...any) {
	w.t.Helper()
	if _, err := w.pool.Exec(context.Background(), sql, args...); err != nil {
		w.t.Fatalf("%s: %v", sql, err)
	}
}

func scan[T any](w *world, sql string, args ...any) T {
	w.t.Helper()
	var v T
	if err := w.pool.QueryRow(context.Background(), sql, args...).Scan(&v); err != nil {
		w.t.Fatalf("%s: %v", sql, err)
	}
	return v
}

func (w *world) newUser() session.User {
	w.t.Helper()
	w.seq++
	id := fmt.Sprintf("pu_%d", w.seq)
	w.exec(`INSERT INTO "User" ("id","email","passwordHash","updatedAt") VALUES ($1, $2, 'x', now())`, id, id+"@test.local")
	return session.User{ID: id, Email: id + "@test.local"}
}

type login struct {
	session.Issued
	user session.User
}

func (w *world) login(client session.ClientType) login {
	w.t.Helper()
	user := w.newUser()
	o := session.StartOptions{ClientType: client}
	if client == session.Mobile {
		o.DeviceName = "Pixel 9"
	}
	issued, err := w.a.Start(context.Background(), user, o)
	if err != nil {
		w.t.Fatalf("start: %v", err)
	}
	return login{Issued: issued, user: user}
}

func web(s *session.Service, token string) (session.Refreshed, error) {
	return s.Refresh(context.Background(), token, session.RefreshOptions{ClientType: session.Web})
}

// ok is a refresh that must succeed.
func (w *world) ok(r session.Refreshed, err error) session.Refreshed {
	w.t.Helper()
	if err != nil {
		w.t.Fatalf("expected success, got %v", err)
	}
	return r
}

// code is the contract code of a refused refresh ("" for success).
func code(err error) apierr.Code {
	var e *apierr.Error
	if errors.As(err, &e) {
		return e.Code
	}
	if err != nil {
		return apierr.Code("not an API error: " + err.Error())
	}
	return ""
}

// refused checks that a refresh was refused with the code and gave nothing.
func (w *world) refused(want apierr.Code, r session.Refreshed, err error) {
	w.t.Helper()
	if got := code(err); got != want {
		w.t.Fatalf("got %q (%v), want %s", got, err, want)
	}
	if r != (session.Refreshed{}) {
		w.t.Fatalf("a refused refresh returned %+v", r)
	}
}

type familyState struct {
	RevokedAt    *time.Time
	RevokeReason *string
}

func (w *world) family(id string) familyState {
	w.t.Helper()
	var f familyState
	if err := w.pool.QueryRow(context.Background(), `SELECT "revokedAt", "revokeReason" FROM "SessionFamily" WHERE "id" = $1`, id).
		Scan(&f.RevokedAt, &f.RevokeReason); err != nil {
		w.t.Fatal(err)
	}
	return f
}

// revokedFor checks a family was revoked at the time, for the reason.
func (w *world) revokedFor(familyID, reason string, at time.Time) {
	w.t.Helper()
	f := w.family(familyID)
	if f.RevokedAt == nil || f.RevokeReason == nil || *f.RevokeReason != reason || !f.RevokedAt.Equal(at) {
		w.t.Fatalf("family %s: revokedAt %v, reason %v; want %s at %s", familyID, f.RevokedAt, deref(f.RevokeReason), reason, at)
	}
}

func (w *world) reason(familyID string) string { return deref(w.family(familyID).RevokeReason) }

func (w *world) notRevoked(familyID string) {
	w.t.Helper()
	if f := w.family(familyID); f.RevokedAt != nil {
		w.t.Fatalf("family %s is revoked (%s)", familyID, deref(f.RevokeReason))
	}
}

func deref(s *string) string {
	if s == nil {
		return "<nil>"
	}
	return *s
}

type sessionRow struct {
	ID              string
	RevokedAt       *time.Time
	ReplacedByID    *string
	RotatedAtSource *string
	Enc             bool
}

func (w *world) sessions(familyID string) []sessionRow {
	w.t.Helper()
	rows, err := w.pool.Query(context.Background(),
		`SELECT "id", "revokedAt", "replacedById", "rotatedAtSource", "successorTokenEnc" IS NOT NULL
		   FROM "Session" WHERE "familyId" = $1 ORDER BY "createdAt", "id"`, familyID)
	if err != nil {
		w.t.Fatal(err)
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (sessionRow, error) {
		var s sessionRow
		return s, row.Scan(&s.ID, &s.RevokedAt, &s.ReplacedByID, &s.RotatedAtSource, &s.Enc)
	})
	if err != nil {
		w.t.Fatal(err)
	}
	return out
}

func (w *world) live(familyID string) int {
	n := 0
	for _, s := range w.sessions(familyID) {
		if s.RevokedAt == nil {
			n++
		}
	}
	return n
}

func (w *world) noCiphertexts(familyID string) {
	w.t.Helper()
	for _, s := range w.sessions(familyID) {
		if s.Enc {
			w.t.Fatalf("session %s still holds a successor ciphertext", s.ID)
		}
	}
}

// dump is everything stored about a family, for before/after comparisons.
func (w *world) dump(familyID string) string {
	w.t.Helper()
	return scan[string](w, `
		SELECT json_build_object('f', (SELECT row_to_json(f) FROM "SessionFamily" f WHERE f."id" = $1),
		                         's', (SELECT json_agg(s ORDER BY s."id") FROM "Session" s WHERE s."familyId" = $1))::text`, familyID)
}

// holdFamilyLock holds the family's row lock on its own connection until
// the returned function is called.
func (w *world) holdFamilyLock(familyID string) (release func()) {
	w.t.Helper()
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dbtest.URL(w.pool))
	if err != nil {
		w.t.Fatal(err)
	}
	tx, err := conn.Begin(ctx)
	if err != nil {
		w.t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `SELECT 1 FROM "SessionFamily" WHERE "id" = $1 FOR UPDATE`, familyID); err != nil {
		w.t.Fatal(err)
	}
	done := false
	release = func() {
		w.t.Helper()
		if done {
			return
		}
		done = true
		if err := tx.Commit(ctx); err != nil {
			w.t.Errorf("release the family lock: %v", err)
		}
		conn.Close(ctx)
	}
	w.t.Cleanup(release)
	return release
}

// waitForWaiters returns once n requests are blocked on a lock.
func (w *world) waitForWaiters(n int) {
	w.t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for {
		got := scan[int](w, `SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`)
		if got >= n {
			return
		}
		if time.Now().After(deadline) {
			w.t.Fatalf("%d request(s) blocked on the family lock, want %d", got, n)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

type pending struct {
	r   session.Refreshed
	err error
}

// async starts a refresh that is expected to wait on a lock.
func async(s *session.Service, token string) <-chan pending {
	ch := make(chan pending, 1)
	go func() {
		r, err := web(s, token)
		ch <- pending{r, err}
	}()
	return ch
}

func (w *world) verify(accessToken string) auth.Claims {
	w.t.Helper()
	claims, ok := w.tokens.Verify(accessToken, time.Now())
	if !ok {
		w.t.Fatalf("access token does not verify")
	}
	return claims
}

func tokenExp(t *testing.T, accessToken string) int64 {
	t.Helper()
	raw, err := base64.RawURLEncoding.DecodeString(strings.Split(accessToken, ".")[1])
	if err != nil {
		t.Fatal(err)
	}
	var claims struct {
		Exp int64 `json:"exp"`
	}
	if err := json.Unmarshal(raw, &claims); err != nil {
		t.Fatal(err)
	}
	return claims.Exp
}

// ─── Rotation and grace ──────────────────────────────────────────────────

func TestROT01_LoginCreatesAFamilyAndRefreshRotatesWithinIt(t *testing.T) {
	t.Parallel()
	w := newWorld(t, true)
	s := w.login(session.Web)
	if !s.SessionExpiresAt.Equal(w.at(90*day)) || !s.RefreshTokenExpiresAt.Equal(w.at(30*day)) || !s.AccessTokenExpiresAt.Equal(w.at(15*time.Minute)) || !s.IssuedAt.Equal(w.t0) {
		t.Fatalf("issued %+v at %s", s.Issued, w.t0)
	}
	if got := w.verify(s.AccessToken); got != (auth.Claims{Sub: s.user.ID, Email: s.user.Email, SID: s.SessionID}) {
		t.Errorf("access token claims %+v", got)
	}
	var clientType string
	var absolute, created time.Time
	if err := w.pool.QueryRow(context.Background(), `SELECT "clientType", "absoluteExpiresAt", "createdAt" FROM "SessionFamily" WHERE "id" = $1`, s.FamilyID).
		Scan(&clientType, &absolute, &created); err != nil {
		t.Fatal(err)
	}
	if clientType != "web" || !absolute.Equal(w.at(90*day)) || !created.Equal(w.t0) {
		t.Errorf("family: %s, limit %s, created %s", clientType, absolute, created)
	}
	if got := scan[string](w, `SELECT "tokenHash" FROM "Session" WHERE "id" = $1`, s.SessionID); got != auth.HashToken(s.RefreshToken) {
		t.Errorf("the session stores %q, not the token's hash", got)
	}

	w.clock(time.Second)
	r := w.ok(web(w.a, s.RefreshToken))
	if r.Replay || r.Issued.RefreshToken == s.RefreshToken || r.Issued.FamilyID != s.FamilyID || r.User != s.user {
		t.Fatalf("rotation: %+v", r)
	}
	if got := w.verify(r.Issued.AccessToken).SID; got != r.Issued.SessionID {
		t.Errorf("access token sid %q, want the successor %q", got, r.Issued.SessionID)
	}
	rows := w.sessions(s.FamilyID)
	if len(rows) != 2 {
		t.Fatalf("%d sessions", len(rows))
	}
	old, cur := rows[0], rows[1]
	if old.ID != s.SessionID || deref(old.ReplacedByID) != r.Issued.SessionID || deref(old.RotatedAtSource) != "db" || !old.Enc ||
		old.RevokedAt == nil || !old.RevokedAt.Equal(w.at(time.Second)) {
		t.Errorf("rotated row %+v", old)
	}
	if cur.ID != r.Issued.SessionID || cur.RevokedAt != nil || cur.Enc {
		t.Errorf("successor row %+v", cur)
	}
	if rotated := scan[time.Time](w, `SELECT "rotatedAt" FROM "Session" WHERE "id" = $1`, s.SessionID); !rotated.Equal(w.at(time.Second)) {
		t.Errorf("rotatedAt %s", rotated)
	}
	stored := scan[string](w, `SELECT "successorTokenEnc" FROM "Session" WHERE "id" = $1`, s.SessionID)
	if strings.Contains(stored, r.Issued.RefreshToken) {
		t.Error("the successor token is stored in the clear")
	}
	if n := scan[int](w, `SELECT count(*) FROM "Session" WHERE "tokenHash" = $1`, auth.HashToken(r.Issued.RefreshToken)); n != 1 {
		t.Errorf("%d rows with the successor's hash", n)
	}
	// Ids have the shape Prisma gave them (cuid): the two servers share the tables.
	for _, id := range []string{s.FamilyID, s.SessionID, r.Issued.SessionID} {
		if len(id) != 25 || id[0] != 'c' || strings.Trim(id, "abcdefghijklmnopqrstuvwxyz0123456789") != "" {
			t.Errorf("id %q is not cuid-shaped", id)
		}
	}
}

func TestBND02_ReplayAt60000msIsGrace(t *testing.T) {
	t.Parallel()
	w := newWorld(t, true)
	s := w.login(session.Web)
	r1 := w.ok(web(w.a, s.RefreshToken))
	w.clock(60_000 * time.Millisecond)
	r2 := w.ok(web(w.a, s.RefreshToken))
	if !r2.Replay || r2.Issued.RefreshToken != r1.Issued.RefreshToken || r2.Issued.SessionID != r1.Issued.SessionID {
		t.Fatalf("replay %+v, first %+v", r2, r1)
	}
	if r2.Issued.AccessToken == r1.Issued.AccessToken || !r2.Issued.AccessTokenExpiresAt.Equal(w.at(60*time.Second+15*time.Minute)) {
		t.Errorf("the replay's access token is not a new one valid 15 minutes from the replay")
	}
	if !r2.Issued.RefreshTokenExpiresAt.Equal(r1.Issued.RefreshTokenExpiresAt) || !r2.Issued.IssuedAt.Equal(w.at(60*time.Second)) {
		t.Errorf("replay times %+v", r2.Issued)
	}
	if w.live(s.FamilyID) != 1 || len(w.sessions(s.FamilyID)) != 2 {
		t.Errorf("a replay changed the chain: %+v", w.sessions(s.FamilyID))
	}
}

func TestBND03_ReplayAt60001msIsReuse(t *testing.T) {
	t.Parallel()
	w := newWorld(t, true)
	s := w.login(session.Web)
	r1 := w.ok(web(w.a, s.RefreshToken))
	w.clock(60_001 * time.Millisecond)
	r, err := web(w.a, s.RefreshToken)
	w.refused(apierr.RefreshReused, r, err)
	w.revokedFor(s.FamilyID, "reuse", w.at(60_001*time.Millisecond))
	if w.live(s.FamilyID) != 0 {
		t.Error("a session of the revoked family is still live")
	}
	w.noCiphertexts(s.FamilyID)
	r, err = web(w.a, r1.Issued.RefreshToken)
	w.refused(apierr.SessionRevoked, r, err)
}

func TestBND04_ReplayStartedInTheWindowButHeldOnTheLockPastItStaysGrace(t *testing.T) {
	t.Parallel()
	w := newWorld(t, true)
	s := w.login(session.Web)
	r1 := w.ok(web(w.a, s.RefreshToken))
	release := w.holdFamilyLock(s.FamilyID)
	w.clock(59 * time.Second)
	waiting := async(w.b, s.RefreshToken)
	w.waitForWaiters(1) // it has read its request time and waits for the lock
	w.clock(65 * time.Second)
	release()
	p := <-waiting
	r2 := w.ok(p.r, p.err)
	if !r2.Replay || r2.Issued.RefreshToken != r1.Issued.RefreshToken {
		t.Fatalf("replay %+v", r2)
	}
}

func TestBND05_ReplayStartedAt61sIsReuse(t *testing.T) {
	t.Parallel()
	w := newWorld(t, true)
	s := w.login(session.Web)
	w.ok(web(w.a, s.RefreshToken))
	w.clock(61 * time.Second)
	if _, err := web(w.a, s.RefreshToken); err == nil {
		t.Fatal("accepted")
	}
	if got := w.reason(s.FamilyID); got != "reuse" {
		t.Errorf("reason %s", got)
	}
}

func TestBND06_ReplayThenReuse(t *testing.T) {
	t.Parallel()
	w := newWorld(t, true)
	s := w.login(session.Web)
	w.ok(web(w.a, s.RefreshToken))
	w.clock(59 * time.Second)
	x := w.ok(web(w.a, s.RefreshToken))
	w.clock(61 * time.Second)
	r, err := web(w.a, s.RefreshToken)
	w.refused(apierr.RefreshReused, r, err)
	r, err = web(w.a, x.Issued.RefreshToken)
	w.refused(apierr.SessionRevoked, r, err)
}

func TestBND07_ReuseFirstThenAnEarlierStartedReplayGetsNoTokens(t *testing.T) {
	t.Parallel()
	w := newWorld(t, true)
	s := w.login(session.Web)
	w.ok(web(w.a, s.RefreshToken))
	w.clock(61 * time.Second)
	if _, err := web(w.a, s.RefreshToken); err == nil {
		t.Fatal("accepted")
	}
	w.clock(59 * time.Second)
	r, err := web(w.a, s.RefreshToken)
	w.refused(apierr.SessionRevoked, r, err)
}

func TestBND08_ReplayAndReuseBothWaitingTheFamilyAlwaysEndsRevoked(t *testing.T) {
	t.Parallel()
	w := newWorld(t, true)
	for i := range 50 {
		w.resetClock()
		s := w.login(session.Web)
		w.ok(web(w.a, s.RefreshToken))
		release := w.holdFamilyLock(s.FamilyID)
		first, second := w.a, w.b
		if i%2 == 1 {
			first, second = w.b, w.a
		}
		w.clock(59 * time.Second)
		x := async(first, s.RefreshToken)
		w.waitForWaiters(1)
		w.clock(61 * time.Second)
		y := async(second, s.RefreshToken)
		w.waitForWaiters(2)
		release()
		rx, ry := <-x, <-y
		w.refused(apierr.RefreshReused, ry.r, ry.err)
		if w.reason(s.FamilyID) != "reuse" || w.live(s.FamilyID) != 0 {
			t.Fatalf("round %d: reason %s, %d live", i, w.reason(s.FamilyID), w.live(s.FamilyID))
		}
		if rx.err == nil {
			// The replay won the lock: its tokens stop working with the family.
			r, err := web(w.a, rx.r.Issued.RefreshToken)
			w.refused(apierr.SessionRevoked, r, err)
		} else {
			w.refused(apierr.SessionRevoked, rx.r, rx.err)
		}
	}
}

func TestGRACE02_ACiphertextThatDoesNotMatchTheSuccessorIsARace(t *testing.T) {
	t.Parallel()
	w := newWorld(t, true)
	s := w.login(session.Web)
	r1 := w.ok(web(w.a, s.RefreshToken))
	forged := session.EncryptSuccessor(auth.NewRefreshToken(), session.SuccessorAAD(s.SessionID, r1.Issued.SessionID), w.keys)
	w.exec(`UPDATE "Session" SET "successorTokenEnc" = $2 WHERE "id" = $1`, s.SessionID, forged)
	w.clock(time.Second)
	r, err := web(w.a, s.RefreshToken)
	w.refused(apierr.SessionRace, r, err)

	// A ciphertext copied from another row (other additional data) is refused the same way.
	other := w.login(session.Web)
	w.ok(web(w.a, other.RefreshToken))
	otherEnc := scan[string](w, `SELECT "successorTokenEnc" FROM "Session" WHERE "id" = $1`, other.SessionID)
	w.exec(`UPDATE "Session" SET "successorTokenEnc" = $2 WHERE "id" = $1`, s.SessionID, otherEnc)
	r, err = web(w.a, s.RefreshToken)
	w.refused(apierr.SessionRace, r, err)
	w.notRevoked(s.FamilyID)
	if w.live(s.FamilyID) != 1 {
		t.Error("a race changed the chain")
	}
}

func TestGRACE03_NoReplayOnceTheSuccessorHasRotated(t *testing.T) {
	t.Parallel()
	w := newWorld(t, true)
	s := w.login(session.Web)
	r1 := w.ok(web(w.a, s.RefreshToken))
	w.ok(web(w.a, r1.Issued.RefreshToken))
	w.clock(time.Second)
	r, err := web(w.a, s.RefreshToken)
	w.refused(apierr.SessionRace, r, err)
	w.notRevoked(s.FamilyID)

	// Nor when the successor is past its own expiry, or was revoked alone.
	for _, change := range []string{
		`UPDATE "Session" SET "expiresAt" = atlas_now() WHERE "id" = $1`,
		`UPDATE "Session" SET "revokedAt" = atlas_now() WHERE "id" = $1`,
	} {
		u := w.login(session.Web)
		u1 := w.ok(web(w.a, u.RefreshToken))
		w.exec(change, u1.Issued.SessionID)
		r, err := web(w.a, u.RefreshToken)
		w.refused(apierr.SessionRace, r, err)
		w.notRevoked(u.FamilyID)
	}
}

// The access token carries whole seconds; what the service reports as its
// expiry is what the token says. Refresh expiry keeps the milliseconds.
func TestAccessExpiryIsInWholeSeconds(t *testing.T) {
	t.Parallel()
	w := newWorld(t, true)
	w.clock(1500 * time.Millisecond)
	s := w.login(session.Web)
	if !s.AccessTokenExpiresAt.Equal(w.at(15*time.Minute+time.Second)) || tokenExp(t, s.AccessToken) != s.AccessTokenExpiresAt.Unix() {
		t.Errorf("access expiry %s, token exp %d", s.AccessTokenExpiresAt, tokenExp(t, s.AccessToken))
	}
	if !s.RefreshTokenExpiresAt.Equal(w.at(30*day+1500*time.Millisecond)) || !s.SessionExpiresAt.Equal(w.at(90*day+1500*time.Millisecond)) {
		t.Errorf("refresh expiry %s, family limit %s", s.RefreshTokenExpiresAt, s.SessionExpiresAt)
	}
	w.clock(2700 * time.Millisecond)
	r := w.ok(web(w.a, s.RefreshToken))
	if !r.Issued.AccessTokenExpiresAt.Equal(w.at(15*time.Minute+2*time.Second)) || tokenExp(t, r.Issued.AccessToken) != r.Issued.AccessTokenExpiresAt.Unix() {
		t.Errorf("after a rotation: access expiry %s", r.Issued.AccessTokenExpiresAt)
	}
	// The token is issued "now" by the app clock, as on the old server.
	raw, _ := base64.RawURLEncoding.DecodeString(strings.Split(r.Issued.AccessToken, ".")[1])
	var claims struct {
		Iat int64 `json:"iat"`
	}
	if err := json.Unmarshal(raw, &claims); err != nil || claims.Iat < time.Now().Unix()-60 || claims.Iat > time.Now().Unix() {
		t.Errorf("iat %d (%v)", claims.Iat, err)
	}
}

// Named by the B1 review: the hourly cleanup clears a ciphertext 60 s after
// the rotation. A replay at the edge of the window that finds it gone fails
// closed, and nothing is revoked.
func TestAReplayWhoseCiphertextWasClearedIsARace(t *testing.T) {
	t.Parallel()
	w := newWorld(t, true)
	s := w.login(session.Web)
	r1 := w.ok(web(w.a, s.RefreshToken))
	w.exec(`UPDATE "Session" SET "successorTokenEnc" = NULL WHERE "id" = $1`, s.SessionID)
	w.clock(60 * time.Second)
	before := w.dump(s.FamilyID)
	r, err := web(w.a, s.RefreshToken)
	w.refused(apierr.SessionRace, r, err)
	if after := w.dump(s.FamilyID); after != before {
		t.Errorf("a race changed the family:\n%s\n%s", before, after)
	}
	// The successor itself still works.
	if r := w.ok(web(w.a, r1.Issued.RefreshToken)); r.Replay {
		t.Error("the successor's own refresh was a replay")
	}
}

// ─── Concurrency ─────────────────────────────────────────────────────────

func TestAT01_FiveConcurrentRefreshesOfOneTokenRotateOnce(t *testing.T) {
	t.Parallel()
	w := newWorld(t, true)
	for i := range 50 {
		s := w.login(session.Web)
		release := w.holdFamilyLock(s.FamilyID)
		var waiting []<-chan pending
		for _, instance := range []*session.Service{w.a, w.b, w.a, w.b, w.a} {
			waiting = append(waiting, async(instance, s.RefreshToken))
		}
		w.waitForWaiters(5)
		release()
		rotations := 0
		var first session.Refreshed
		for j, ch := range waiting {
			p := <-ch
			r := w.ok(p.r, p.err)
			if !r.Replay {
				rotations++
			}
			if j == 0 {
				first = r
			}
			if r.Issued.RefreshToken != first.Issued.RefreshToken || r.Issued.SessionID != first.Issued.SessionID {
				t.Fatalf("round %d: two different successors", i)
			}
			if got := w.verify(r.Issued.AccessToken).SID; got != first.Issued.SessionID {
				t.Fatalf("round %d: access token for session %q", i, got)
			}
		}
		if rotations != 1 || w.live(s.FamilyID) != 1 {
			t.Fatalf("round %d: %d rotations, %d live sessions", i, rotations, w.live(s.FamilyID))
		}
		w.notRevoked(s.FamilyID)
	}
}

func TestAT02_ARequestWaitingTooLongOnTheFamilyLockIsBusyWithNoSideEffects(t *testing.T) {
	t.Parallel()
	// The real limits, which this test shortens.
	if session.DefaultLockTimeout != 5*time.Second || session.DefaultStatementTimeout != 10*time.Second {
		t.Fatalf("lock timeout %s, statement timeout %s", session.DefaultLockTimeout, session.DefaultStatementTimeout)
	}
	w := newWorld(t, true)
	const lockTimeout = 400 * time.Millisecond
	impatient := w.service(w.keys, session.WithLockTimeout(lockTimeout))
	s := w.login(session.Web)
	r1 := w.ok(web(w.a, s.RefreshToken))
	before := w.dump(s.FamilyID)

	release := w.holdFamilyLock(s.FamilyID)
	started := time.Now()
	r, err := web(impatient, s.RefreshToken)
	waited := time.Since(started)
	release()
	w.refused(apierr.SessionBusy, r, err)
	if waited < lockTimeout-20*time.Millisecond {
		t.Errorf("gave up after %s, before the lock timeout", waited)
	}
	if after := w.dump(s.FamilyID); after != before {
		t.Errorf("a busy request changed the family:\n%s\n%s", before, after)
	}

	// A shorter wait takes the grace path.
	release = w.holdFamilyLock(s.FamilyID)
	waiting := async(w.b, s.RefreshToken)
	w.waitForWaiters(1)
	release()
	p := <-waiting
	r2 := w.ok(p.r, p.err)
	if !r2.Replay || r2.Issued.RefreshToken != r1.Issued.RefreshToken {
		t.Fatalf("replay %+v", r2)
	}
	w.notRevoked(s.FamilyID)

	// Sign-in and sign-out wait behind the same limits.
	release = w.holdFamilyLock(s.FamilyID)
	if err := impatient.End(context.Background(), session.EndOptions{RefreshToken: r1.Issued.RefreshToken}); code(err) != apierr.SessionBusy {
		t.Errorf("sign-out behind a held lock: %v", err)
	}
	release()
	w.notRevoked(s.FamilyID)
}

func TestAT05_ARotationAndAReuseQueuedOnOneFamilyLeaveNoLiveSession(t *testing.T) {
	t.Parallel()
	w := newWorld(t, true)
	for i := range 50 {
		w.resetClock()
		s := w.login(session.Web)
		r1 := w.ok(web(w.a, s.RefreshToken)) // s rotated at Δ 0; r1 is the live tail
		w.clock(61 * time.Second)
		release := w.holdFamilyLock(s.FamilyID)
		var first, second <-chan pending
		if i%2 == 1 {
			first = async(w.a, r1.Issued.RefreshToken)
			w.waitForWaiters(1)
			second = async(w.b, s.RefreshToken)
		} else {
			first = async(w.b, s.RefreshToken)
			w.waitForWaiters(1)
			second = async(w.a, r1.Issued.RefreshToken)
		}
		w.waitForWaiters(2)
		release()
		<-first
		<-second
		if w.reason(s.FamilyID) != "reuse" || w.live(s.FamilyID) != 0 {
			t.Fatalf("round %d: reason %s, %d live", i, w.reason(s.FamilyID), w.live(s.FamilyID))
		}
	}
}

func TestAT06_ReuseInOneFamilyLeavesTheUsersOtherFamilyWorking(t *testing.T) {
	t.Parallel()
	w := newWorld(t, true)
	s := w.login(session.Web)
	otherDevice, err := w.a.Start(context.Background(), s.user, session.StartOptions{ClientType: session.Web})
	if err != nil {
		t.Fatal(err)
	}
	w.ok(web(w.a, s.RefreshToken))
	w.clock(61 * time.Second)
	if _, err := web(w.a, s.RefreshToken); err == nil {
		t.Fatal("accepted")
	}
	if w.reason(s.FamilyID) != "reuse" {
		t.Errorf("reason %s", w.reason(s.FamilyID))
	}
	w.notRevoked(otherDevice.FamilyID)
	if r := w.ok(web(w.a, otherDevice.RefreshToken)); r.Replay {
		t.Error("the other device's refresh was a replay")
	}
}

func TestAT07_KeyRotationStageSwitchRetire(t *testing.T) {
	t.Parallel()
	w := newWorld(t, true)
	k1, k2 := randomKey(t), randomKey(t)
	// 1. stage: K1 active everywhere, K2 decrypt-only.
	staged := w.service(session.Keys{Active: k1, DecryptOnly: [][]byte{k2}})
	// 2. switch: K2 active, K1 decrypt-only.
	switched := w.service(session.Keys{Active: k2, DecryptOnly: [][]byte{k1}})
	// 3. retire K1.
	retired := w.service(session.Keys{Active: k2})

	start := func(s *session.Service) session.Issued {
		issued, err := s.Start(context.Background(), w.newUser(), session.StartOptions{ClientType: session.Web})
		if err != nil {
			t.Fatal(err)
		}
		return issued
	}
	s1 := start(staged)
	r1 := w.ok(web(staged, s1.RefreshToken)) // encrypted with K1
	s2 := start(switched)
	r2 := w.ok(web(switched, s2.RefreshToken)) // encrypted with K2

	if got := w.ok(web(staged, s2.RefreshToken)); !got.Replay || got.Issued.RefreshToken != r2.Issued.RefreshToken {
		t.Error("an instance with K2 staged cannot replay a K2 ciphertext")
	}
	if got := w.ok(web(switched, s1.RefreshToken)); !got.Replay || got.Issued.RefreshToken != r1.Issued.RefreshToken {
		t.Error("an instance with K1 as decrypt-only cannot replay a K1 ciphertext")
	}
	if got := w.ok(web(retired, s2.RefreshToken)); got.Issued.RefreshToken != r2.Issued.RefreshToken {
		t.Error("after K1 is retired, a K2 ciphertext does not replay")
	}
	// Removing a key that is still needed fails closed: a race, nothing revoked.
	r, err := web(retired, s1.RefreshToken)
	w.refused(apierr.SessionRace, r, err)
	w.notRevoked(s1.FamilyID)
	if w.live(s1.FamilyID) != 1 {
		t.Error("the chain changed")
	}
}

// Pool exhaustion is "busy", as a lock wait is; a request the client gave
// up on is not answered as busy.
func TestAnExhaustedPoolIsBusyAndACancelledRequestIsNot(t *testing.T) {
	t.Parallel()
	w := newWorld(t, true)
	s := w.login(session.Web)

	cfg, err := pgxpool.ParseConfig(dbtest.URL(w.pool))
	if err != nil {
		t.Fatal(err)
	}
	cfg.MaxConns = 1
	small, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer small.Close()
	svc := session.New(small, session.Config{Tokens: w.tokens, Keys: w.keys, AccessTTL: 15 * time.Minute, RefreshTTL: 30 * day,
		Log: slog.New(slog.NewTextHandler(io.Discard, nil))}, session.WithAcquireTimeout(200*time.Millisecond))
	held, err := small.Acquire(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer held.Release() // before the pool closes, also when the test fails early
	before := w.dump(s.FamilyID)
	r, err := web(svc, s.RefreshToken)
	w.refused(apierr.SessionBusy, r, err)
	if _, err := svc.Start(context.Background(), s.user, session.StartOptions{ClientType: session.Web}); code(err) != apierr.SessionBusy {
		t.Errorf("sign-in on an exhausted pool: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := svc.Refresh(ctx, s.RefreshToken, session.RefreshOptions{ClientType: session.Web}); !errors.Is(err, context.Canceled) {
		t.Errorf("cancelled request: %v, want context.Canceled", err)
	}
	// Nor is a request that ran out of its own time while it waited.
	short, cancelShort := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancelShort()
	if _, err := svc.Refresh(short, s.RefreshToken, session.RefreshOptions{ClientType: session.Web}); !errors.Is(err, context.DeadlineExceeded) || code(err) == apierr.SessionBusy {
		t.Errorf("request past its own deadline: %v, want context.DeadlineExceeded", err)
	}
	held.Release()
	if after := w.dump(s.FamilyID); after != before {
		t.Error("a refused request changed the family")
	}
	if got := w.ok(web(svc, s.RefreshToken)); got.Replay {
		t.Error("the refresh after the pool was freed is a replay: an earlier one went through")
	}
}

// ─── Expiry, client binding, revocation stamping ─────────────────────────

func TestAbsoluteLimitCapsAccessAndRefreshExpiry(t *testing.T) {
	t.Parallel()
	w := newWorld(t, true)
	s := w.login(session.Web)
	limit := w.at(5 * time.Minute)
	w.exec(`UPDATE "SessionFamily" SET "absoluteExpiresAt" = $2 WHERE "id" = $1`, s.FamilyID, limit)
	w.clock(time.Second)
	r := w.ok(web(w.a, s.RefreshToken))
	if !r.Issued.AccessTokenExpiresAt.Equal(limit) || !r.Issued.RefreshTokenExpiresAt.Equal(limit) || !r.Issued.SessionExpiresAt.Equal(limit) {
		t.Fatalf("issued %+v, limit %s", r.Issued, limit)
	}
	w.verify(r.Issued.AccessToken)
	if exp := tokenExp(t, r.Issued.AccessToken); exp != limit.Unix() {
		t.Errorf("token exp %d, want %d", exp, limit.Unix())
	}
	if stored := scan[time.Time](w, `SELECT "expiresAt" FROM "Session" WHERE "id" = $1`, r.Issued.SessionID); !stored.Equal(limit) {
		t.Errorf("stored expiry %s", stored)
	}
	// One millisecond before the limit the token still rotates; at it, the family ends.
	w.clock(5*time.Minute - time.Millisecond)
	r2 := w.ok(web(w.a, r.Issued.RefreshToken))
	if !r2.Issued.AccessTokenExpiresAt.Equal(limit) {
		t.Errorf("access expiry %s", r2.Issued.AccessTokenExpiresAt)
	}
	w.clock(5 * time.Minute)
	got, err := web(w.a, r2.Issued.RefreshToken)
	w.refused(apierr.SessionExpired, got, err)
	w.revokedFor(s.FamilyID, "expired", limit)
	if w.live(s.FamilyID) != 0 { // FAM-STAMP-03
		t.Error("a session of the expired family is still live")
	}
}

func TestSessionExpiryAfter30DaysWithoutRefresh(t *testing.T) {
	t.Parallel()
	w := newWorld(t, true)
	s := w.login(session.Web)
	w.clock(30*day - time.Millisecond)
	r1 := w.ok(web(w.a, s.RefreshToken))
	w.clock(60*day - time.Millisecond)
	r, err := web(w.a, r1.Issued.RefreshToken)
	w.refused(apierr.SessionExpired, r, err)
	if w.reason(s.FamilyID) != "expired" {
		t.Errorf("reason %s", w.reason(s.FamilyID))
	}
}

func TestSessionExpiryAtExactly30Days(t *testing.T) {
	t.Parallel()
	w := newWorld(t, true)
	s := w.login(session.Web)
	w.clock(30 * day)
	r, err := web(w.a, s.RefreshToken)
	w.refused(apierr.SessionExpired, r, err)
	w.revokedFor(s.FamilyID, "expired", w.at(30*day))
}

func TestAUTH03_ATokenUsedInTheOtherClientModeIsAMismatchAndChangesNothing(t *testing.T) {
	t.Parallel()
	w := newWorld(t, true)
	webLogin, mobile := w.login(session.Web), w.login(session.Mobile)
	before := w.dump(webLogin.FamilyID) + w.dump(mobile.FamilyID)
	r, err := w.a.Refresh(context.Background(), webLogin.RefreshToken, session.RefreshOptions{ClientType: session.Mobile})
	w.refused(apierr.ClientMismatch, r, err)
	r, err = web(w.a, mobile.RefreshToken)
	w.refused(apierr.ClientMismatch, r, err)
	if after := w.dump(webLogin.FamilyID) + w.dump(mobile.FamilyID); after != before {
		t.Error("a mismatch changed a family")
	}
	ok := w.ok(w.a.Refresh(context.Background(), mobile.RefreshToken, session.RefreshOptions{ClientType: session.Mobile}))
	if got := scan[*string](w, `SELECT "deviceName" FROM "Session" WHERE "id" = $1`, ok.Issued.SessionID); deref(got) != "Pixel 9" {
		t.Errorf("the successor's device name is %s", deref(got))
	}
}

func TestFAMSTAMP01_LogoutRevokesTheFamilyAndStampsEveryLiveSession(t *testing.T) {
	t.Parallel()
	w := newWorld(t, true)
	ctx := context.Background()
	s := w.login(session.Web)
	r := w.ok(web(w.a, s.RefreshToken))
	// An extra live row in the family: stamping covers every live row.
	w.exec(`INSERT INTO "Session" ("id","userId","familyId","tokenHash","expiresAt","createdAt")
	        VALUES ($1, $2, $3, $4, now() + interval '1 day', now() AT TIME ZONE 'UTC')`,
		"extra_"+s.SessionID, s.user.ID, s.FamilyID, auth.HashToken(auth.NewRefreshToken()))
	w.clock(5 * time.Second)
	if err := w.a.End(ctx, session.EndOptions{RefreshToken: r.Issued.RefreshToken}); err != nil {
		t.Fatal(err)
	}
	w.revokedFor(s.FamilyID, "logout", w.at(5*time.Second))
	if w.live(s.FamilyID) != 0 {
		t.Error("a session is still live after sign-out")
	}
	w.noCiphertexts(s.FamilyID)
	// Idempotent: the first revocation stays as it is.
	w.clock(6 * time.Second)
	if err := w.a.End(ctx, session.EndOptions{RefreshToken: r.Issued.RefreshToken}); err != nil {
		t.Fatal(err)
	}
	w.revokedFor(s.FamilyID, "logout", w.at(5*time.Second))
	got, err := web(w.a, r.Issued.RefreshToken)
	w.refused(apierr.SessionRevoked, got, err)
	// An old (rotated) token of a signed-out family is not "reuse".
	w.clock(10 * time.Minute)
	got, err = web(w.a, s.RefreshToken)
	w.refused(apierr.SessionRevoked, got, err)
	if w.reason(s.FamilyID) != "logout" {
		t.Errorf("reason %s", w.reason(s.FamilyID))
	}

	// By the access token's session id, scoped to its user.
	u := w.login(session.Web)
	if err := w.a.End(ctx, session.EndOptions{SID: u.SessionID, UserID: "someone_else"}); err != nil {
		t.Fatal(err)
	}
	w.notRevoked(u.FamilyID)
	if err := w.a.End(ctx, session.EndOptions{SID: u.SessionID}); err != nil {
		t.Fatal(err)
	}
	w.notRevoked(u.FamilyID) // a session id without its user ends nothing
	if err := w.a.End(ctx, session.EndOptions{SID: u.SessionID, UserID: u.user.ID}); err != nil {
		t.Fatal(err)
	}
	if w.reason(u.FamilyID) != "logout" {
		t.Errorf("reason %s", w.reason(u.FamilyID))
	}
	// Nothing to end is not an error; neither is an unknown or oversized token.
	for _, o := range []session.EndOptions{{}, {RefreshToken: auth.NewRefreshToken()}, {RefreshToken: strings.Repeat("x", 129)}} {
		if err := w.a.End(ctx, o); err != nil {
			t.Errorf("%+v: %v", o, err)
		}
	}
	// A refresh token wins over the session id; an unknown one falls back to it.
	v, x := w.login(session.Web), w.login(session.Web)
	if err := w.a.End(ctx, session.EndOptions{RefreshToken: v.RefreshToken, SID: x.SessionID, UserID: x.user.ID}); err != nil {
		t.Fatal(err)
	}
	w.notRevoked(x.FamilyID)
	if w.reason(v.FamilyID) != "logout" {
		t.Error("the refresh token's family was not ended")
	}
	if err := w.a.End(ctx, session.EndOptions{RefreshToken: auth.NewRefreshToken(), SID: x.SessionID, UserID: x.user.ID}); err != nil {
		t.Fatal(err)
	}
	if w.reason(x.FamilyID) != "logout" {
		t.Error("the session id's family was not ended")
	}
}

func TestFAMSTAMP02_ReuseStampsASessionCreatedByAConcurrentRotation(t *testing.T) {
	t.Parallel()
	w := newWorld(t, true)
	s := w.login(session.Web)
	r1 := w.ok(web(w.a, s.RefreshToken))
	w.clock(61 * time.Second)
	release := w.holdFamilyLock(s.FamilyID)
	rotation := async(w.a, r1.Issued.RefreshToken)
	w.waitForWaiters(1)
	reuse := async(w.b, s.RefreshToken)
	w.waitForWaiters(2)
	release()
	<-rotation
	<-reuse
	if w.live(s.FamilyID) != 0 {
		t.Errorf("%d live sessions", w.live(s.FamilyID))
	}
}

func TestUnknownEmptyOrOversizedTokensAreInvalid(t *testing.T) {
	t.Parallel()
	if session.RefreshTokenMaxLength != 128 {
		t.Fatalf("limit %d", session.RefreshTokenMaxLength)
	}
	w := newWorld(t, true)
	s := w.login(session.Web)
	before := w.dump(s.FamilyID)
	for _, token := range []string{"", strings.Repeat("x", 129), auth.NewRefreshToken(), auth.HashToken(s.RefreshToken)} {
		r, err := web(w.a, token)
		w.refused(apierr.InvalidToken, r, err)
	}
	if after := w.dump(s.FamilyID); after != before {
		t.Error("an invalid token changed the family")
	}
}

// Named by the B1 review: the hourly cleanup, or an account deletion, can
// remove a session between the moment a refresh finds it and the moment it
// holds the locks. That is an unknown token, not a server error.
func TestASessionDeletedWhileTheRefreshWaitsIsAnInvalidToken(t *testing.T) {
	t.Parallel()
	w := newWorld(t, true)

	s := w.login(session.Web)
	release := w.holdFamilyLock(s.FamilyID)
	waiting := async(w.b, s.RefreshToken)
	w.waitForWaiters(1)
	w.exec(`DELETE FROM "Session" WHERE "id" = $1`, s.SessionID)
	release()
	p := <-waiting
	w.refused(apierr.InvalidToken, p.r, p.err)
	w.notRevoked(s.FamilyID)

	// The whole account gone (cascade): the family row is not there to lock.
	u := w.login(session.Web)
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dbtest.URL(w.pool))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(ctx)
	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM "User" WHERE "id" = $1`, u.user.ID); err != nil {
		t.Fatal(err)
	}
	waiting = async(w.b, u.RefreshToken) // finds the session, then waits for the deleted family row
	w.waitForWaiters(1)
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	p = <-waiting
	w.refused(apierr.InvalidToken, p.r, p.err)
}

func TestStoredClientDetails(t *testing.T) {
	t.Parallel()
	w := newWorld(t, true)
	ctx := context.Background()
	details := func(sessionID string) (userAgent, deviceName string) {
		var ua, dn *string
		if err := w.pool.QueryRow(ctx, `SELECT "userAgent", "deviceName" FROM "Session" WHERE "id" = $1`, sessionID).Scan(&ua, &dn); err != nil {
			t.Fatal(err)
		}
		return deref(ua), deref(dn)
	}
	long := strings.Repeat("a", 199) + "ўзбек"
	// The limits are JavaScript's string lengths (UTF-16 units), as the old
	// server cut them: 200 for the user agent, 100 for the device name.
	mobile, err := w.a.Start(ctx, w.newUser(), session.StartOptions{ClientType: session.Mobile, UserAgent: long, DeviceName: strings.Repeat("я", 150)})
	if err != nil {
		t.Fatal(err)
	}
	if ua, dn := details(mobile.SessionID); ua != strings.Repeat("a", 199)+"ў" || dn != strings.Repeat("я", 100) {
		t.Errorf("stored %q / %q", ua, dn)
	}
	// A character outside the basic plane counts two and is never cut in half.
	astral, err := w.a.Start(ctx, w.newUser(), session.StartOptions{ClientType: session.Mobile, DeviceName: strings.Repeat("x", 99) + "😀"})
	if err != nil {
		t.Fatal(err)
	}
	if _, dn := details(astral.SessionID); dn != strings.Repeat("x", 99) {
		t.Errorf("device name %q", dn)
	}
	// A web session has no device name, whatever was sent; empty values are stored as none.
	webSession, err := w.a.Start(ctx, w.newUser(), session.StartOptions{ClientType: session.Web, DeviceName: "Pixel 9"})
	if err != nil {
		t.Fatal(err)
	}
	if ua, dn := details(webSession.SessionID); ua != "<nil>" || dn != "<nil>" {
		t.Errorf("web session: %q / %q", ua, dn)
	}
	// Bytes that are not UTF-8, or NUL, never reach the database as they are.
	odd, err := w.a.Start(ctx, w.newUser(), session.StartOptions{ClientType: session.Mobile, UserAgent: "agent\xff\x00/1", DeviceName: "\x00"})
	if err != nil {
		t.Fatalf("odd bytes: %v", err)
	}
	if ua, dn := details(odd.SessionID); ua != "agent"+string(utf8.RuneError)+"/1" || dn != "<nil>" {
		t.Errorf("odd bytes stored as %q / %q", ua, dn)
	}

	// A rotation keeps the device name; a new user agent replaces the old one, none keeps it.
	r1 := w.ok(w.a.Refresh(ctx, mobile.RefreshToken, session.RefreshOptions{ClientType: session.Mobile}))
	if ua, dn := details(r1.Issued.SessionID); ua != strings.Repeat("a", 199)+"ў" || dn != strings.Repeat("я", 100) {
		t.Errorf("after a rotation without a user agent: %q / %q", ua, dn)
	}
	r2 := w.ok(w.a.Refresh(ctx, r1.Issued.RefreshToken, session.RefreshOptions{ClientType: session.Mobile, UserAgent: "Lookly/2.0"}))
	if ua, dn := details(r2.Issued.SessionID); ua != "Lookly/2.0" || dn != strings.Repeat("я", 100) {
		t.Errorf("after a rotation with a user agent: %q / %q", ua, dn)
	}
	if got := scan[time.Time](w, `SELECT "lastUsedAt" FROM "Session" WHERE "id" = $1`, r2.Issued.SessionID); !got.Equal(w.t0) {
		t.Errorf("lastUsedAt %s", got)
	}
}

// ─── Password reset building blocks (used from B3) ───────────────────────

func TestRevokeUserFamiliesEndsEveryLiveFamilyOfTheUserInOneTransaction(t *testing.T) {
	t.Parallel()
	w := newWorld(t, true)
	ctx := context.Background()
	s := w.login(session.Web)
	second, err := w.a.Start(ctx, s.user, session.StartOptions{ClientType: session.Mobile})
	if err != nil {
		t.Fatal(err)
	}
	r := w.ok(web(w.a, s.RefreshToken)) // one family holds a ciphertext
	signedOut, err := w.a.Start(ctx, s.user, session.StartOptions{ClientType: session.Web})
	if err != nil {
		t.Fatal(err)
	}
	w.clock(time.Second)
	if err := w.a.End(ctx, session.EndOptions{RefreshToken: signedOut.RefreshToken}); err != nil {
		t.Fatal(err)
	}
	someoneElse := w.login(session.Web)

	w.clock(2 * time.Second)
	var revoked int
	err = w.a.InTransaction(ctx, func(tx pgx.Tx, at time.Time) error {
		if !at.Equal(w.at(2 * time.Second)) {
			t.Errorf("transaction time %s", at)
		}
		var err error
		revoked, err = session.RevokeUserFamilies(ctx, tx, s.user.ID, at)
		return err
	})
	if err != nil || revoked != 2 {
		t.Fatalf("revoked %d families (%v), want the 2 live ones", revoked, err)
	}
	w.revokedFor(s.FamilyID, "password_reset", w.at(2*time.Second))
	w.revokedFor(second.FamilyID, "password_reset", w.at(2*time.Second))
	w.revokedFor(signedOut.FamilyID, "logout", w.at(time.Second)) // already ended: left as it was
	w.notRevoked(someoneElse.FamilyID)
	for _, family := range []string{s.FamilyID, second.FamilyID} {
		if w.live(family) != 0 {
			t.Errorf("family %s has a live session", family)
		}
		w.noCiphertexts(family)
	}
	got, err := web(w.a, r.Issued.RefreshToken)
	w.refused(apierr.SessionRevoked, got, err)

	// What the caller does in the transaction is undone with it when it fails.
	failed := errors.New("the new password could not be stored")
	err = w.a.InTransaction(ctx, func(tx pgx.Tx, at time.Time) error {
		if _, err := session.RevokeUserFamilies(ctx, tx, someoneElse.user.ID, at); err != nil {
			return err
		}
		return failed
	})
	if !errors.Is(err, failed) {
		t.Fatalf("got %v", err)
	}
	w.notRevoked(someoneElse.FamilyID)

	// Behind a held family lock the transaction is busy, and nothing changes.
	impatient := w.service(w.keys, session.WithLockTimeout(300*time.Millisecond))
	release := w.holdFamilyLock(someoneElse.FamilyID)
	err = impatient.InTransaction(ctx, func(tx pgx.Tx, at time.Time) error {
		_, err := session.RevokeUserFamilies(ctx, tx, someoneElse.user.ID, at)
		return err
	})
	release()
	if code(err) != apierr.SessionBusy {
		t.Errorf("behind a held lock: %v", err)
	}
	w.notRevoked(someoneElse.FamilyID)
}

// ─── Legacy rows (migrated from before the protocol) ─────────────────────

// legacyChain is a migrated chain: old (rotated, legacy) → tail (live).
func (w *world) legacyChain(rotatedAt time.Time) (family, oldToken, tailToken string) {
	w.t.Helper()
	user := w.newUser()
	family = "lf_" + user.ID
	oldToken, tailToken = auth.NewRefreshToken(), auth.NewRefreshToken()
	w.exec(`INSERT INTO "SessionFamily" ("id","userId","clientType","createdAt","absoluteExpiresAt") VALUES ($1, $2, 'web', $3, $4)`,
		family, user.ID, w.at(-day), w.at(89*day))
	w.exec(`INSERT INTO "Session" ("id","userId","familyId","tokenHash","expiresAt","createdAt") VALUES ($1, $2, $3, $4, $5, $6)`,
		family+"_tail", user.ID, family, auth.HashToken(tailToken), w.at(20*day), w.at(-day+time.Second))
	w.exec(`INSERT INTO "Session" ("id","userId","familyId","tokenHash","expiresAt","createdAt","revokedAt","replacedById","rotatedAt","rotatedAtSource")
	        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $7, 'legacy')`,
		family+"_old", user.ID, family, auth.HashToken(oldToken), w.at(20*day), w.at(-day), rotatedAt, family+"_tail")
	return family, oldToken, tailToken
}

func (w *world) setCutover(at time.Time) {
	w.exec(`UPDATE "SystemMarker" SET "value" = $1 WHERE "key" = 'legacyCutoverAt'`, at)
}

func TestLEG01_ALegacyRotatedTokenIsJudgedFromTheCutoverNotItsOwnRotationTime(t *testing.T) {
	t.Parallel()
	w := newWorld(t, true)
	w.setCutover(w.at(0))
	for _, rotatedAt := range []time.Time{
		time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC),
		time.Date(2999, 1, 1, 0, 0, 0, 0, time.UTC),
		w.at(-time.Second),
	} {
		family, oldToken, _ := w.legacyChain(rotatedAt)
		w.clock(60_000 * time.Millisecond)
		r, err := web(w.a, oldToken)
		w.refused(apierr.SessionRace, r, err)
		w.notRevoked(family)
		if w.live(family) != 1 {
			t.Errorf("rotatedAt %s: a race changed the chain", rotatedAt)
		}
		w.clock(60_001 * time.Millisecond)
		r, err = web(w.a, oldToken)
		w.refused(apierr.RefreshReused, r, err)
		if w.reason(family) != "reuse" || w.live(family) != 0 {
			t.Errorf("rotatedAt %s: reason %s, %d live", rotatedAt, w.reason(family), w.live(family))
		}
	}
	// A legacy rotation without the marker cannot be dated: a race, never a revocation.
	w.exec(`DELETE FROM "SystemMarker" WHERE "key" = 'legacyCutoverAt'`)
	family, oldToken, _ := w.legacyChain(w.at(-time.Hour))
	w.clock(time.Hour)
	r, err := web(w.a, oldToken)
	w.refused(apierr.SessionRace, r, err)
	w.notRevoked(family)
}

func TestLEG02_ALegacyLiveTailRotatesNormally(t *testing.T) {
	t.Parallel()
	w := newWorld(t, true)
	w.setCutover(w.at(-day))
	_, _, tailToken := w.legacyChain(w.at(-day + 500*time.Millisecond))
	r := w.ok(web(w.a, tailToken))
	if r.Replay {
		t.Fatal("the first refresh of a legacy tail was a replay")
	}
	w.clock(30 * time.Second)
	replay := w.ok(web(w.a, tailToken))
	if !replay.Replay || replay.Issued.RefreshToken != r.Issued.RefreshToken {
		t.Fatalf("replay %+v", replay)
	}
}

// ─── Real clock ──────────────────────────────────────────────────────────

// A smoke test, not a boundary proof: the production atlas_now().
func TestSMOKE01_RealClock(t *testing.T) {
	t.Parallel()
	w := newWorld(t, false)
	for _, c := range []struct {
		offset string
		grace  bool
	}{{"59 seconds", true}, {"61 seconds", false}} {
		s := w.login(session.Web)
		w.ok(web(w.a, s.RefreshToken))
		w.exec(`UPDATE "Session" SET "rotatedAt" = date_trunc('milliseconds', now() AT TIME ZONE 'UTC') - $2::interval WHERE "id" = $1`, s.SessionID, c.offset)
		r, err := web(w.a, s.RefreshToken)
		if c.grace {
			if got := w.ok(r, err); !got.Replay {
				t.Errorf("%s: not a replay", c.offset)
			}
		} else {
			w.refused(apierr.RefreshReused, r, err)
		}
	}
	// The rows carry UTC wall-clock times although the server's time zone is not UTC.
	if drift := scan[float64](w, `SELECT abs(extract(epoch FROM max("createdAt") - (now() AT TIME ZONE 'UTC')))::float8 FROM "SessionFamily"`); drift > 60 {
		t.Errorf("createdAt is %v s from UTC now", drift)
	}
	if drift := scan[float64](w, `SELECT abs(extract(epoch FROM max("createdAt") - (now() AT TIME ZONE 'UTC')))::float8 FROM "Session"`); drift > 60 {
		t.Errorf("session createdAt is %v s from UTC now", drift)
	}
}
