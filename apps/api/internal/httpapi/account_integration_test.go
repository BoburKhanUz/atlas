//go:build integration

// The account operations of stage B3 (legal texts and consent, profile,
// password reset, account deletion) through the real router, gate and
// services on a real PostgreSQL. Behaviour: docs/plan/B3.md. Every response
// is checked against the contract.

package httpapi_test

import (
	"context"
	"net/http"
	"sync"
	"testing"
	"time"

	"lookly/internal/httpapi"
	"lookly/internal/legal"
)

// outdatedVersion is older than the minimum version that still counts.
const outdatedVersion = "2020-01-01.1"

func (a *api) userID(email string) string {
	a.t.Helper()
	return query[string](a, `SELECT "id" FROM "User" WHERE "email" = $1`, email)
}

func (a *api) consents(userID, version string) int {
	a.t.Helper()
	return query[int](a, `SELECT count(*) FROM "LegalConsent" WHERE "userId" = $1 AND "version" = $2`, userID, version)
}

func consent(m mobileSession, body any) call {
	return call{path: "/api/v1/legal/consent", mobile: true, bearer: m.accessToken, body: body}
}

// vanish removes the user's row and leaves the sessions standing: what a
// handler sees when the account's deletion commits after the gate let the
// request in. (The foreign keys' cascade is switched off for this one
// transaction; the test database's role may do that.)
func (a *api) vanish(userID string) {
	a.t.Helper()
	ctx := context.Background()
	tx, err := a.pool.Begin(ctx)
	if err != nil {
		a.t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	for _, sql := range []string{`SET LOCAL session_replication_role = replica`, `DELETE FROM "User" WHERE "id" = '` + userID + `'`} {
		if _, err := tx.Exec(ctx, sql); err != nil {
			a.t.Fatalf("%s: %v", sql, err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		a.t.Fatal(err)
	}
}

var currentConsent = map[string]any{"acceptedLegalVersion": legal.Version, "ageConfirmed": true}

// ─── Legal texts ─────────────────────────────────────────────────────────

func TestTheLegalTextsArePublic(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{})
	got := a.do(call{method: http.MethodGet, path: "/api/v1/legal"})
	a.is(got, http.StatusOK, "")
	if got.text("version") != legal.Version {
		t.Errorf("version %q, want %q", got.text("version"), legal.Version)
	}
	documents, _ := got.body["documents"].([]any)
	if len(documents) != 2 {
		t.Fatalf("documents: %s", got.raw)
	}
	if string(got.raw) != string(legal.Documents()) {
		t.Error("the answer is not the embedded copy of the texts")
	}
	// A signed-in user whose consent is out of date reads them too.
	m := a.mobileRegister(nil)
	a.exec(`UPDATE "LegalConsent" SET "version" = $2 WHERE "userId" = $1`, a.userID(m.email), outdatedVersion)
	a.is(a.do(call{method: http.MethodGet, path: "/api/v1/legal", mobile: true, bearer: m.accessToken}), http.StatusOK, "")
}

// ─── Consent ─────────────────────────────────────────────────────────────

func TestAcceptingTheCurrentTextsEndsConsentRequired(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{})
	m := a.mobileRegister(nil)
	user := a.userID(m.email)
	a.exec(`UPDATE "LegalConsent" SET "version" = $2 WHERE "userId" = $1`, user, outdatedVersion)
	if me := a.me(call{bearer: m.accessToken}); me.body["consentRequired"] != true {
		t.Fatalf("before: %s", me.raw)
	}

	before := time.Now().Add(-time.Second)
	got := a.do(consent(m, currentConsent))
	a.is(got, http.StatusOK, "")
	if got.body["ok"] != true {
		t.Errorf("body %s", got.raw)
	}
	if me := a.me(call{bearer: m.accessToken}); me.body["consentRequired"] != false {
		t.Errorf("after: %s", me.raw)
	}
	if n := a.consents(user, legal.Version); n != 1 {
		t.Fatalf("%d consents to the current version, want 1", n)
	}
	if n := a.consents(user, outdatedVersion); n != 1 {
		t.Errorf("the earlier consent was not kept (%d rows)", n)
	}
	if !query[bool](a, `SELECT "ageConfirmed" FROM "LegalConsent" WHERE "userId" = $1 AND "version" = $2`, user, legal.Version) {
		t.Error("the age confirmation was not recorded")
	}
	if at := query[time.Time](a, `SELECT "acceptedAt" FROM "LegalConsent" WHERE "userId" = $1 AND "version" = $2`, user, legal.Version); at.Before(before) || at.After(time.Now().Add(time.Second)) {
		t.Errorf("acceptedAt %s", at)
	}
	if id := query[string](a, `SELECT "id" FROM "LegalConsent" WHERE "userId" = $1 AND "version" = $2`, user, legal.Version); len(id) != 25 || id[0] != 'c' {
		t.Errorf("consent id %q is not shaped as the ids Prisma makes", id)
	}

	// A repeat changes nothing.
	a.is(a.do(consent(m, currentConsent)), http.StatusOK, "")
	if n := a.consents(user, legal.Version); n != 1 {
		t.Errorf("%d consents after a repeat, want 1", n)
	}
}

func TestConsentInWebModeWithCookies(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{})
	s := a.webLogin()
	user := a.userID(s.email)
	a.exec(`DELETE FROM "LegalConsent" WHERE "userId" = $1`, user)
	cookies := map[string]string{httpapi.AccessCookie: s.at}
	a.is(a.do(call{path: "/api/v1/legal/consent", cookies: cookies, body: currentConsent, headers: map[string]string{"Origin": "http://app.example.uz"}}), http.StatusOK, "")
	if n := a.consents(user, legal.Version); n != 1 {
		t.Errorf("%d consents, want 1", n)
	}
	// Another site cannot accept in the user's name.
	a.exec(`DELETE FROM "LegalConsent" WHERE "userId" = $1`, user)
	a.is(a.do(call{path: "/api/v1/legal/consent", cookies: cookies, body: currentConsent, headers: map[string]string{"Origin": "https://evil.example"}}), http.StatusForbidden, "FORBIDDEN")
	if n := a.consents(user, legal.Version); n != 0 {
		t.Errorf("a cross-site request recorded %d consents", n)
	}
}

func TestConsentRefusals(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{})
	m := a.mobileRegister(nil)
	user := a.userID(m.email)
	a.exec(`DELETE FROM "LegalConsent" WHERE "userId" = $1`, user)

	a.is(a.do(call{path: "/api/v1/legal/consent", mobile: true, body: currentConsent}), http.StatusUnauthorized, "UNAUTHORIZED")
	a.is(a.do(call{path: "/api/v1/legal/consent", mobile: true, bearer: "not-a-token", body: currentConsent}), http.StatusUnauthorized, "UNAUTHORIZED")

	const outdated = "Foydalanish shartlari yangilangan. Ularni qayta ko‘rib chiqing va tasdiqlang."
	const missing = "Davom etish uchun Foydalanish shartlari va Maxfiylik siyosatiga rozilik bering."
	for _, c := range []struct {
		name    string
		body    any
		message string
	}{
		{"an older version", map[string]any{"acceptedLegalVersion": legal.MinConsentVersion + "x", "ageConfirmed": true}, outdated},
		{"age not confirmed", map[string]any{"acceptedLegalVersion": legal.Version, "ageConfirmed": false}, "18 yoshdan kattaligingizni tasdiqlang."},
		{"nothing", map[string]any{}, missing},
		{"no body", nil, missing},
	} {
		got := a.do(consent(m, c.body))
		a.is(got, http.StatusBadRequest, "VALIDATION_ERROR")
		if got.text("error") != c.message {
			t.Errorf("%s: %q, want %q", c.name, got.text("error"), c.message)
		}
	}
	a.is(a.do(consent(m, "{not json")), http.StatusBadRequest, "BAD_REQUEST")
	if n := query[int](a, `SELECT count(*) FROM "LegalConsent" WHERE "userId" = $1`, user); n != 0 {
		t.Errorf("refused requests recorded %d consents", n)
	}

	// An account deleted while the request was on its way: nothing recorded.
	gone := a.mobileRegister(nil)
	goneID := a.userID(gone.email)
	a.exec(`DELETE FROM "LegalConsent" WHERE "userId" = $1`, goneID)
	a.vanish(goneID)
	a.is(a.do(consent(gone, currentConsent)), http.StatusUnauthorized, "UNAUTHORIZED")
	if n := query[int](a, `SELECT count(*) FROM "LegalConsent" WHERE "userId" = $1`, goneID); n != 0 {
		t.Errorf("%d consents recorded for an account that is gone", n)
	}
	// An account that is gone has no session: its token is refused.
	a.exec(`DELETE FROM "User" WHERE "id" = $1`, user)
	a.is(a.do(consent(m, currentConsent)), http.StatusUnauthorized, "UNAUTHORIZED")
}

func TestTwoAcceptancesAtOnceRecordOneConsent(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{})
	m := a.mobileRegister(nil)
	user := a.userID(m.email)
	a.exec(`DELETE FROM "LegalConsent" WHERE "userId" = $1`, user)

	const parallel = 8
	statuses := make([]int, parallel)
	var wg sync.WaitGroup
	for i := range parallel {
		wg.Add(1)
		go func() {
			defer wg.Done()
			statuses[i] = a.do(consent(m, currentConsent)).status
		}()
	}
	wg.Wait()
	for i, status := range statuses {
		if status != http.StatusOK {
			t.Errorf("request %d: %d", i, status)
		}
	}
	if n := a.consents(user, legal.Version); n != 1 {
		t.Errorf("%d consents after %d requests at once, want 1", n, parallel)
	}
}
