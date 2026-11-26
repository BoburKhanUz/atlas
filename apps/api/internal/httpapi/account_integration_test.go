//go:build integration

// The account operations of stage B3 (legal texts and consent, profile,
// password reset, account deletion) through the real router, gate and
// services on a real PostgreSQL. Behaviour: docs/plan/B3.md. Every response
// is checked against the contract.

package httpapi_test

import (
	"context"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"lookly/internal/dbtest"
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

// ─── Profile ─────────────────────────────────────────────────────────────

func getProfile(m mobileSession) call {
	return call{method: http.MethodGet, path: "/api/v1/profile", mobile: true, bearer: m.accessToken}
}

func patchProfile(m mobileSession, body any) call {
	return call{method: http.MethodPatch, path: "/api/v1/profile", mobile: true, bearer: m.accessToken, body: body}
}

// object is the member of a JSON object that is itself an object (nil when
// it is null or missing).
func object(t *testing.T, in map[string]any, path ...string) map[string]any {
	t.Helper()
	var v any = in
	for _, key := range path {
		m, ok := v.(map[string]any)
		if !ok {
			t.Fatalf("%v: not an object at %q", path, key)
		}
		v = m[key]
	}
	m, _ := v.(map[string]any)
	return m
}

func keys(m map[string]any) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	slices.Sort(out)
	return out
}

// The members of the rows as the Next.js API returns them (the columns of
// apps/web/prisma/schema.prisma, models UserProfile and UserPreferences).
var (
	profileRowKeys = []string{"ageRange", "bodyShape", "clothingSize", "colorProfileId", "createdAt", "eyeColor", "gender", "hairColor",
		"height", "id", "preferredFit", "skinTone", "skinUndertone", "typicalBudget", "updatedAt", "userId", "weight"}
	preferencesRowKeys = []string{"createdAt", "dislikedColors", "dislikedStyles", "favoriteColors", "id", "language", "preferredStyles", "updatedAt", "userId"}
	isoMillis          = regexp.MustCompile(`^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$`)
)

func TestTheProfileAfterRegistration(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{})
	m := a.mobileRegister(map[string]any{"name": "Aziza"})
	id := a.userID(m.email)

	got := a.do(getProfile(m))
	a.is(got, http.StatusOK, "")
	if !slices.Equal(keys(got.body), []string{"preferences", "profile", "user"}) {
		t.Fatalf("body %s", got.raw)
	}
	user := object(t, got.body, "user")
	if !slices.Equal(keys(user), []string{"createdAt", "email", "id", "name", "preferences", "profile"}) {
		t.Errorf("user has %v", keys(user))
	}
	if user["id"] != id || user["email"] != m.email || user["name"] != "Aziza" || !isoMillis.MatchString(got.text("user", "createdAt")) {
		t.Errorf("user %v", user)
	}

	// The profile row, twice: under the user and on its own.
	for _, row := range []map[string]any{object(t, got.body, "profile"), object(t, got.body, "user", "profile")} {
		if !slices.Equal(keys(row), profileRowKeys) {
			t.Fatalf("profile row has %v, want %v", keys(row), profileRowKeys)
		}
		for key, value := range row {
			switch key {
			case "id":
				if s, _ := value.(string); len(s) != 25 {
					t.Errorf("profile id %v", value)
				}
			case "userId":
				if value != id {
					t.Errorf("profile userId %v", value)
				}
			case "createdAt", "updatedAt":
				if s, _ := value.(string); !isoMillis.MatchString(s) {
					t.Errorf("profile %s %v", key, value)
				}
			default:
				if value != nil {
					t.Errorf("profile %s is %v after registration, want null", key, value)
				}
			}
		}
	}

	// The preferences: the raw row under the user (lists as JSON text), and
	// with real lists on their own.
	raw := object(t, got.body, "user", "preferences")
	lists := object(t, got.body, "preferences")
	if !slices.Equal(keys(raw), preferencesRowKeys) || !slices.Equal(keys(lists), preferencesRowKeys) {
		t.Fatalf("preferences have %v and %v, want %v", keys(raw), keys(lists), preferencesRowKeys)
	}
	for _, list := range []string{"preferredStyles", "dislikedStyles", "favoriteColors", "dislikedColors"} {
		if raw[list] != "[]" {
			t.Errorf("user.preferences.%s is %v, want the text []", list, raw[list])
		}
		if items, ok := lists[list].([]any); !ok || len(items) != 0 {
			t.Errorf("preferences.%s is %v, want an empty list", list, lists[list])
		}
	}
	if raw["language"] != "uz" || lists["language"] != "uz" || raw["userId"] != id || lists["id"] != raw["id"] {
		t.Errorf("preferences %v / %v", raw, lists)
	}

	// The same through a web session's cookie.
	s := a.webLoginAs(m.email)
	web := a.do(call{method: http.MethodGet, path: "/api/v1/profile", cookies: map[string]string{httpapi.AccessCookie: s.at}})
	a.is(web, http.StatusOK, "")
	if web.text("user", "id") != id {
		t.Errorf("web: %s", web.raw)
	}
}

func TestChangingTheProfile(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{})
	m := a.mobileRegister(map[string]any{"name": "Aziza"})
	other := a.mobileRegister(map[string]any{"name": "Boshqa"})
	id, otherID := a.userID(m.email), a.userID(other.email)
	at := func(table string) time.Time {
		column := `"userId"`
		if table == "User" {
			column = `"id"`
		}
		return query[time.Time](a, `SELECT "updatedAt" FROM "`+table+`" WHERE `+column+` = $1`, id)
	}
	created := [3]time.Time{at("User"), at("UserProfile"), at("UserPreferences")}

	first := time.Now().UTC().Add(2 * time.Minute).Truncate(time.Millisecond)
	dbtest.SetClock(t, a.pool, first)
	got := a.do(patchProfile(m, map[string]any{
		"name": "  Aziza Karimova  ",
		"profile": map[string]any{
			"gender": "female", "ageRange": " 25-34 ", "height": 165, "weight": 58.55, "bodyShape": "hourglass", "skinTone": "medium",
			"skinUndertone": "warm", "hairColor": "qora", "eyeColor": "jigarrang", "clothingSize": "M", "preferredFit": "regular", "typicalBudget": 1_000_000_000,
		},
		"preferences": map[string]any{"preferredStyles": []string{"casual", "minimal"}, "dislikedStyles": []string{}, "favoriteColors": []string{"navy"}, "dislikedColors": []string{"pink", "pink"}, "language": "ru"},
	}))
	a.is(got, http.StatusOK, "")

	// The answer: the user with the raw rows, and nothing else.
	if !slices.Equal(keys(got.body), []string{"user"}) || !slices.Equal(keys(object(t, got.body, "user")), []string{"email", "id", "name", "preferences", "profile"}) {
		t.Fatalf("body %s", got.raw)
	}
	if got.text("user", "name") != "Aziza Karimova" || got.text("user", "email") != m.email || got.text("user", "id") != id {
		t.Errorf("user: %s", got.raw)
	}
	row := object(t, got.body, "user", "profile")
	wantRow := map[string]any{
		"gender": "female", "ageRange": "25-34", "height": 165.0, "weight": 58.55, "bodyShape": "hourglass", "skinTone": "medium",
		"skinUndertone": "warm", "hairColor": "qora", "eyeColor": "jigarrang", "clothingSize": "M", "preferredFit": "regular", "typicalBudget": 1e9,
		"colorProfileId": nil, "userId": id, "updatedAt": first.Format("2006-01-02T15:04:05.000Z"),
	}
	if !slices.Equal(keys(row), profileRowKeys) {
		t.Errorf("profile row has %v", keys(row))
	}
	for key, want := range wantRow {
		if row[key] != want {
			t.Errorf("profile.%s is %v, want %v", key, row[key], want)
		}
	}
	prefs := object(t, got.body, "user", "preferences")
	wantPrefs := map[string]any{
		"preferredStyles": `["casual","minimal"]`, "dislikedStyles": `[]`, "favoriteColors": `["navy"]`, "dislikedColors": `["pink","pink"]`,
		"language": "ru", "userId": id, "updatedAt": first.Format("2006-01-02T15:04:05.000Z"),
	}
	if !slices.Equal(keys(prefs), preferencesRowKeys) {
		t.Errorf("preferences row has %v", keys(prefs))
	}
	for key, want := range wantPrefs {
		if prefs[key] != want {
			t.Errorf("preferences.%s is %v, want %v", key, prefs[key], want)
		}
	}
	if !strings.Contains(string(got.raw), `"weight":58.55,`) || !strings.Contains(string(got.raw), `"height":165,`) || !strings.Contains(string(got.raw), `"typicalBudget":1000000000,`) {
		t.Errorf("numbers are not written as JavaScript writes them: %s", got.raw)
	}

	// Stored: the exact values, and every row's updatedAt moved.
	if w := query[float64](a, `SELECT "weight" FROM "UserProfile" WHERE "userId" = $1`, id); w != 58.55 {
		t.Errorf("stored weight %v", w)
	}
	if name := query[string](a, `SELECT "name" FROM "User" WHERE "id" = $1`, id); name != "Aziza Karimova" {
		t.Errorf("stored name %q", name)
	}
	for i, table := range []string{"User", "UserProfile", "UserPreferences"} {
		if got := at(table); !got.Equal(first) {
			t.Errorf("%s.updatedAt %s, want %s (was %s)", table, got, first, created[i])
		}
	}

	// Reading it back: the lists are lists.
	read := a.do(getProfile(m))
	a.is(read, http.StatusOK, "")
	for list, want := range map[string][]any{
		"preferredStyles": {"casual", "minimal"}, "dislikedStyles": {}, "favoriteColors": {"navy"}, "dislikedColors": {"pink", "pink"},
	} {
		if got, _ := object(t, read.body, "preferences")[list].([]any); !slices.Equal(got, want) {
			t.Errorf("preferences.%s is %v, want %v", list, object(t, read.body, "preferences")[list], want)
		}
	}
	if object(t, read.body, "user", "preferences")["preferredStyles"] != `["casual","minimal"]` || object(t, read.body, "profile")["weight"] != 58.55 {
		t.Errorf("read back: %s", read.raw)
	}

	// One field changed: every other field stays.
	got = a.do(patchProfile(m, map[string]any{"profile": map[string]any{"eyeColor": "yashil"}}))
	a.is(got, http.StatusOK, "")
	row = object(t, got.body, "user", "profile")
	for key, want := range wantRow {
		if key == "eyeColor" {
			want = "yashil"
		}
		if row[key] != want {
			t.Errorf("after changing the eye colour profile.%s is %v, want %v", key, row[key], want)
		}
	}

	// null clears, absent keeps; only the section sent is touched.
	second := first.Add(2 * time.Minute)
	dbtest.SetClock(t, a.pool, second)
	got = a.do(patchProfile(m, map[string]any{"profile": map[string]any{"height": nil, "gender": nil, "hairColor": "", "weight": 60}}))
	a.is(got, http.StatusOK, "")
	row = object(t, got.body, "user", "profile")
	for key, want := range map[string]any{"height": nil, "gender": nil, "hairColor": "", "weight": 60.0, "eyeColor": "yashil", "ageRange": "25-34", "typicalBudget": 1e9, "preferredFit": "regular"} {
		if row[key] != want {
			t.Errorf("after the second change profile.%s is %v, want %v", key, row[key], want)
		}
	}
	if !at("UserProfile").Equal(second) || !at("User").Equal(first) || !at("UserPreferences").Equal(first) {
		t.Errorf("updatedAt: profile %s, user %s, preferences %s", at("UserProfile"), at("User"), at("UserPreferences"))
	}

	// One preference changed: the others stay.
	got = a.do(patchProfile(m, map[string]any{"preferences": map[string]any{"favoriteColors": []string{}}}))
	a.is(got, http.StatusOK, "")
	prefs = object(t, got.body, "user", "preferences")
	if prefs["favoriteColors"] != "[]" || prefs["preferredStyles"] != `["casual","minimal"]` || prefs["language"] != "ru" {
		t.Errorf("preferences %v", prefs)
	}

	// An empty section touches its row; an empty body touches nothing.
	third := second.Add(2 * time.Minute)
	dbtest.SetClock(t, a.pool, third)
	a.is(a.do(patchProfile(m, map[string]any{"profile": map[string]any{}})), http.StatusOK, "")
	if !at("UserProfile").Equal(third) || !at("UserPreferences").Equal(second) {
		t.Errorf("after an empty section: profile %s, preferences %s", at("UserProfile"), at("UserPreferences"))
	}
	fourth := third.Add(2 * time.Minute)
	dbtest.SetClock(t, a.pool, fourth)
	for _, body := range []any{map[string]any{}, nil, map[string]any{"unknown": 1}} {
		got = a.do(patchProfile(m, body))
		a.is(got, http.StatusOK, "")
		if got.text("user", "name") != "Aziza Karimova" {
			t.Errorf("empty change: %s", got.raw)
		}
	}
	if !at("User").Equal(first) || !at("UserProfile").Equal(third) || !at("UserPreferences").Equal(second) {
		t.Error("an empty change touched a row")
	}

	// Nobody else's rows moved.
	if name := query[string](a, `SELECT "name" FROM "User" WHERE "id" = $1`, otherID); name != "Boshqa" {
		t.Errorf("the other user's name is %q", name)
	}
	if n := query[int](a, `SELECT count(*) FROM "UserProfile" WHERE "userId" = $1 AND "gender" IS NULL AND "weight" IS NULL`, otherID); n != 1 {
		t.Error("the other user's profile changed")
	}
	if n := query[int](a, `SELECT count(*) FROM "UserPreferences" WHERE "userId" = $1 AND "language" = 'uz' AND "preferredStyles" = '[]'`, otherID); n != 1 {
		t.Error("the other user's preferences changed")
	}
}

// Accounts from before registration made the two rows have none: reading
// answers null, and a change creates the row with the defaults.
func TestProfileRowsAreCreatedWhenMissing(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{})
	m := a.mobileRegister(nil)
	id := a.userID(m.email)
	a.exec(`DELETE FROM "UserProfile" WHERE "userId" = $1`, id)
	a.exec(`DELETE FROM "UserPreferences" WHERE "userId" = $1`, id)

	got := a.do(getProfile(m))
	a.is(got, http.StatusOK, "")
	user := object(t, got.body, "user")
	if got.body["profile"] != nil || got.body["preferences"] != nil || user["profile"] != nil || user["preferences"] != nil || user["name"] != nil {
		t.Fatalf("no rows: %s", got.raw)
	}
	// A change of the name alone creates neither.
	got = a.do(patchProfile(m, map[string]any{"name": "Aziza"}))
	a.is(got, http.StatusOK, "")
	if user := object(t, got.body, "user"); user["profile"] != nil || user["preferences"] != nil || user["name"] != "Aziza" {
		t.Fatalf("name only: %s", got.raw)
	}

	got = a.do(patchProfile(m, map[string]any{"profile": map[string]any{"gender": "male"}}))
	a.is(got, http.StatusOK, "")
	row := object(t, got.body, "user", "profile")
	if row["gender"] != "male" || row["userId"] != id || row["height"] != nil || got.body["user"].(map[string]any)["preferences"] != nil {
		t.Errorf("created profile: %s", got.raw)
	}
	if rowID, _ := row["id"].(string); len(rowID) != 25 || rowID[0] != 'c' {
		t.Errorf("profile id %v is not shaped as the ids Prisma makes", row["id"])
	}

	got = a.do(patchProfile(m, map[string]any{"preferences": map[string]any{"favoriteColors": []string{"red"}}}))
	a.is(got, http.StatusOK, "")
	prefs := object(t, got.body, "user", "preferences")
	for key, want := range map[string]any{"favoriteColors": `["red"]`, "preferredStyles": "[]", "dislikedStyles": "[]", "dislikedColors": "[]", "language": "uz", "userId": id} {
		if prefs[key] != want {
			t.Errorf("created preferences.%s is %v, want %v", key, prefs[key], want)
		}
	}
	if n := query[int](a, `SELECT (SELECT count(*) FROM "UserProfile" WHERE "userId" = $1) + (SELECT count(*) FROM "UserPreferences" WHERE "userId" = $1)`, id); n != 2 {
		t.Errorf("%d rows, want one of each", n)
	}
}

func TestAProfileChangeIsAllOrNothing(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{})
	m := a.mobileRegister(map[string]any{"name": "Aziza"})
	id := a.userID(m.email)
	// The last of the three writes fails.
	a.exec(`CREATE FUNCTION refuse_preferences() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'preferences are closed'; END $$`)
	a.exec(`CREATE TRIGGER refuse BEFORE INSERT OR UPDATE ON "UserPreferences" FOR EACH ROW EXECUTE FUNCTION refuse_preferences()`)

	got := a.do(patchProfile(m, map[string]any{"name": "Boshqa", "profile": map[string]any{"gender": "male"}, "preferences": map[string]any{"language": "en"}}))
	a.is(got, http.StatusInternalServerError, "INTERNAL")
	if strings.Contains(string(got.raw), "closed") {
		t.Errorf("the cause reached the client: %s", got.raw)
	}
	if !strings.Contains(a.logs(), "preferences are closed") {
		t.Error("the cause is not in the log")
	}
	if name := query[string](a, `SELECT "name" FROM "User" WHERE "id" = $1`, id); name != "Aziza" {
		t.Errorf("the name changed to %q although the change failed", name)
	}
	if n := query[int](a, `SELECT count(*) FROM "UserProfile" WHERE "userId" = $1 AND "gender" IS NULL`, id); n != 1 {
		t.Error("the profile changed although the change failed")
	}
}

func TestProfileRefusals(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{})
	m := a.mobileRegister(map[string]any{"name": "Aziza"})
	id := a.userID(m.email)

	a.is(a.do(call{method: http.MethodGet, path: "/api/v1/profile", mobile: true}), http.StatusUnauthorized, "UNAUTHORIZED")
	a.is(a.do(call{method: http.MethodPatch, path: "/api/v1/profile", mobile: true, body: map[string]any{"name": "x"}}), http.StatusUnauthorized, "UNAUTHORIZED")

	// A refused body changes nothing and names the field.
	got := a.do(patchProfile(m, map[string]any{"name": "Boshqa", "profile": map[string]any{"height": 10}}))
	a.is(got, http.StatusBadRequest, "VALIDATION_ERROR")
	details, _ := got.body["details"].([]any)
	if len(details) != 1 || details[0].(map[string]any)["path"] != "profile.height" || got.text("error") != "Juda kichik: kutilgan number >=50" {
		t.Errorf("details %s", got.raw)
	}
	a.is(a.do(patchProfile(m, "{")), http.StatusBadRequest, "BAD_REQUEST")
	if name := query[string](a, `SELECT "name" FROM "User" WHERE "id" = $1`, id); name != "Aziza" {
		t.Errorf("a refused change stored the name %q", name)
	}

	// A character the database cannot store is dropped, not a server error.
	got = a.do(patchProfile(m, `{"name":"Az\u0000iza","profile":{"hairColor":"qo\u0000ra"}}`))
	a.is(got, http.StatusOK, "")
	if got.text("user", "name") != "Aziza" || object(t, got.body, "user", "profile")["hairColor"] != "qora" {
		t.Errorf("after a NUL character: %s", got.raw)
	}
	got = a.do(patchProfile(m, `{"name":"\u0000"}`))
	a.is(got, http.StatusOK, "")
	if got.text("user", "name") != "Aziza" {
		t.Errorf("a name of nothing storable replaced the name: %s", got.raw)
	}

	// Another site, with the user's cookie.
	s := a.webLoginAs(m.email)
	cross := call{method: http.MethodPatch, path: "/api/v1/profile", cookies: map[string]string{httpapi.AccessCookie: s.at}, body: map[string]any{"name": "Evil"}, headers: map[string]string{"Origin": "https://evil.example"}}
	a.is(a.do(cross), http.StatusForbidden, "FORBIDDEN")
	cross.headers = map[string]string{"Origin": "http://app.example.uz"}
	a.is(a.do(cross), http.StatusOK, "")
	a.is(a.do(patchProfile(m, map[string]any{"name": "Aziza"})), http.StatusOK, "")

	// Consent out of date: the profile is closed, reading and changing.
	a.exec(`UPDATE "LegalConsent" SET "version" = $2 WHERE "userId" = $1`, id, outdatedVersion)
	a.is(a.do(getProfile(m)), http.StatusForbidden, "CONSENT_REQUIRED")
	a.is(a.do(patchProfile(m, map[string]any{"name": "Boshqa"})), http.StatusForbidden, "CONSENT_REQUIRED")
	if name := query[string](a, `SELECT "name" FROM "User" WHERE "id" = $1`, id); name != "Aziza" {
		t.Errorf("without consent the name became %q", name)
	}
	a.is(a.do(consent(m, currentConsent)), http.StatusOK, "")
	a.is(a.do(getProfile(m)), http.StatusOK, "")

	// The account was deleted while the request was on its way.
	a.vanish(id)
	a.is(a.do(getProfile(m)), http.StatusNotFound, "NOT_FOUND")
	a.is(a.do(patchProfile(m, map[string]any{"name": "Boshqa"})), http.StatusUnauthorized, "UNAUTHORIZED")
	a.is(a.do(patchProfile(m, map[string]any{"profile": map[string]any{"gender": "male"}})), http.StatusUnauthorized, "UNAUTHORIZED")
	if n := query[int](a, `SELECT count(*) FROM "UserProfile" WHERE "userId" = $1 AND "gender" = 'male'`, id); n != 0 {
		t.Error("a profile was written for an account that is gone")
	}
	// The same for an account that had no rows: none is made for it.
	legacy := a.mobileRegister(nil)
	legacyID := a.userID(legacy.email)
	a.exec(`DELETE FROM "UserProfile" WHERE "userId" = $1`, legacyID)
	a.exec(`DELETE FROM "UserPreferences" WHERE "userId" = $1`, legacyID)
	a.vanish(legacyID)
	a.is(a.do(patchProfile(legacy, map[string]any{"profile": map[string]any{"gender": "male"}, "preferences": map[string]any{"language": "ru"}})), http.StatusUnauthorized, "UNAUTHORIZED")
	if n := query[int](a, `SELECT (SELECT count(*) FROM "UserProfile" WHERE "userId" = $1) + (SELECT count(*) FROM "UserPreferences" WHERE "userId" = $1)`, legacyID); n != 0 {
		t.Errorf("%d rows were made for an account that is gone", n)
	}
}

// Stored lists are JSON text until the cutover. Text that is not a list of
// strings is a server error with the cause in the log, not an empty list.
func TestAMalformedStoredListIsAServerError(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{})
	m := a.mobileRegister(nil)
	id := a.userID(m.email)
	for _, stored := range []string{"oops", `["casual", 5]`, `{"0":"casual"}`, "null", `"casual"`, ""} {
		a.exec(`UPDATE "UserPreferences" SET "favoriteColors" = $2 WHERE "userId" = $1`, id, stored)
		got := a.do(getProfile(m))
		a.is(got, http.StatusInternalServerError, "INTERNAL")
		if !strings.Contains(a.logs(), "favoriteColors") {
			t.Errorf("stored %q: the log does not name the column", stored)
		}
	}
	// A change of that list repairs it.
	a.is(a.do(patchProfile(m, map[string]any{"preferences": map[string]any{"favoriteColors": []string{"red"}}})), http.StatusOK, "")
	a.is(a.do(getProfile(m)), http.StatusOK, "")
}
