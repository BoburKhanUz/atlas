package httpapi_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"lookly/internal/auth"
	"lookly/internal/contracttest"
	"lookly/internal/httpapi"
)

// The gate's answers when what it asks fails or says no, with its
// dependencies replaced: the paths the database tests cannot reach.

type sessionsSaying struct {
	alive bool
	err   error
}

func (s sessionsSaying) Alive(context.Context, string, string) (bool, error) { return s.alive, s.err }

type usersSaying struct {
	exists bool
	err    error
	asked  *int
}

func (u usersSaying) Exists(context.Context, string) (bool, error) {
	*u.asked++
	return u.exists, u.err
}

type noConsentNeeded struct{}

func (noConsentNeeded) ConsentRequired(context.Context, string) (bool, error) { return false, nil }

func TestTheGateWhenTheStoreFailsOrTheAccountIsGone(t *testing.T) {
	t.Parallel()
	tokens := auth.NewTokens([]byte("gate-unit-secret-gate-unit-secret-gate"))
	now := time.Now()
	token := tokens.Sign(auth.Claims{Sub: "cuser", Email: "u@test.local", SID: "csession"}, now, now.Add(time.Minute))
	expired := tokens.Sign(auth.Claims{Sub: "cuser", Email: "u@test.local", SID: "csession"}, now.Add(-time.Hour), now.Add(-time.Minute))
	broken := errors.New("the store is down")

	for _, c := range []struct {
		name     string
		route    string
		token    string
		sessions sessionsSaying
		users    usersSaying
		status   int
		code     string
		asked    int // account look-ups
	}{
		{"deleted account, deletion route", "DELETE /api/v1/account", token, sessionsSaying{}, usersSaying{exists: false}, http.StatusNotFound, "NOT_FOUND", 1},
		{"signed out, deletion route", "DELETE /api/v1/account", token, sessionsSaying{}, usersSaying{exists: true}, http.StatusUnauthorized, "UNAUTHORIZED", 1},
		{"account look-up fails", "DELETE /api/v1/account", token, sessionsSaying{}, usersSaying{err: broken}, http.StatusInternalServerError, "INTERNAL", 1},
		{"expired token of a deleted account", "DELETE /api/v1/account", expired, sessionsSaying{}, usersSaying{exists: false}, http.StatusUnauthorized, "UNAUTHORIZED", 0},
		{"deleted account, another route", "GET /api/v1/profile", token, sessionsSaying{}, usersSaying{exists: false}, http.StatusUnauthorized, "UNAUTHORIZED", 0},
		{"session check fails", "GET /api/v1/profile", token, sessionsSaying{err: broken}, usersSaying{}, http.StatusInternalServerError, "INTERNAL", 0},
		{"session check fails, deletion route", "DELETE /api/v1/account", token, sessionsSaying{err: broken}, usersSaying{}, http.StatusInternalServerError, "INTERNAL", 0},
		{"live session, deletion route", "DELETE /api/v1/account", token, sessionsSaying{alive: true}, usersSaying{exists: false}, http.StatusNoContent, "", 0},
	} {
		asked := 0
		c.users.asked = &asked
		gate := &httpapi.Gate{Tokens: tokens, Sessions: c.sessions, Consent: noConsentNeeded{}, Users: c.users}
		reached := false
		h := httpapi.Gated(gate, slog.New(slog.NewJSONHandler(io.Discard, nil)), c.route, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			reached = true
			w.WriteHeader(http.StatusNoContent)
		}))
		method, path, _ := strings.Cut(c.route, " ")
		r := httptest.NewRequest(method, "http://app.example.uz"+path, nil)
		r.Header.Set("Authorization", "Bearer "+c.token)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		var body struct{ Code string }
		_ = json.Unmarshal(w.Body.Bytes(), &body)
		if w.Code != c.status || body.Code != c.code || asked != c.asked || reached != (c.status == http.StatusNoContent) {
			t.Errorf("%s: %d %q, %d look-ups, handler reached %v; want %d %q, %d look-ups", c.name, w.Code, body.Code, asked, reached, c.status, c.code, c.asked)
		}
		if w.Code != http.StatusNoContent {
			contracttest.Response(t, method, path, w.Code, w.Header(), w.Body.Bytes())
		}
	}
}
