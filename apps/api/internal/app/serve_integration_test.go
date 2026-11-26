//go:build integration

package app_test

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/cookiejar"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"lookly/internal/app"
	"lookly/internal/legal"
)

// The served binary, wired as in production: configuration → services →
// gate → router. One account goes through register, "who am I", refresh and
// sign-out over real HTTP, with the real password hasher.
// startServer runs `lookly serve` on the pool's database and returns a
// caller of its API that keeps cookies, and the server's log.
func startServer(t *testing.T, pool *pgxpool.Pool, extra map[string]string) (call func(method, path, body string) (int, map[string]any), stdout *syncBuffer) {
	t.Helper()
	addr := freeAddr(t)
	ctx, cancel := context.WithCancel(context.Background())
	stdout = &syncBuffer{}
	done := make(chan int, 1)
	vars := map[string]string{"LOOKLY_HTTP_ADDR": addr}
	for k, v := range extra {
		vars[k] = v
	}
	go func() {
		done <- app.Run(ctx, []string{"serve"}, appEnv(pool, vars), stdout, &syncBuffer{})
	}()
	t.Cleanup(func() {
		cancel()
		select {
		case <-done:
		case <-time.After(10 * time.Second):
			t.Error("serve did not stop")
		}
	})
	deadline := time.Now().Add(10 * time.Second)
	for {
		if c, err := net.DialTimeout("tcp", addr, 100*time.Millisecond); err == nil {
			c.Close()
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("server did not start: %s", stdout.String())
		}
		time.Sleep(20 * time.Millisecond)
	}

	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Jar: jar, Timeout: 60 * time.Second}
	base := "http://" + addr
	return func(method, path, body string) (int, map[string]any) {
		t.Helper()
		req, err := http.NewRequest(method, base+path, strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		res, err := client.Do(req)
		if err != nil {
			t.Fatalf("%s %s: %v", method, path, err)
		}
		defer res.Body.Close()
		var decoded map[string]any
		if err := json.NewDecoder(res.Body).Decode(&decoded); err != nil {
			t.Fatalf("%s %s: %d, body is not JSON: %v", method, path, res.StatusCode, err)
		}
		return res.StatusCode, decoded
	}, stdout
}

func registrationOf(email string) string {
	body, _ := json.Marshal(map[string]any{"email": email, "password": "parol-1234", "acceptedLegalVersion": legal.Version, "ageConfirmed": true})
	return string(body)
}

// The served binary, wired as in production: configuration → services →
// gate → router. One account goes through register, "who am I", refresh and
// sign-out over real HTTP, with the real password hasher.
func TestServeRunsTheAuthOperationsEndToEnd(t *testing.T) {
	t.Parallel()
	pool := schemaDB(t)
	call, stdout := startServer(t, pool, nil)

	if status, body := call(http.MethodGet, "/api/v1/auth/me", ""); status != http.StatusUnauthorized || body["code"] != "UNAUTHORIZED" {
		t.Fatalf("me without a session: %d %v", status, body)
	}
	if status, body := call(http.MethodPost, "/api/v1/auth/register", registrationOf("wired@test.local")); status != http.StatusCreated {
		t.Fatalf("register: %d %v", status, body)
	}
	// The cookies the server set (not Secure in the test environment) carry the session.
	status, me := call(http.MethodGet, "/api/v1/auth/me", "")
	user, _ := me["user"].(map[string]any)
	if status != http.StatusOK || user["email"] != "wired@test.local" || me["consentRequired"] != false {
		t.Fatalf("me: %d %v", status, me)
	}
	if status, body := call(http.MethodPost, "/api/v1/auth/refresh", ""); status != http.StatusOK {
		t.Fatalf("refresh: %d %v", status, body)
	}
	if status, body := call(http.MethodPost, "/api/v1/auth/login", `{"email":"wired@test.local","password":"wrong-password"}`); status != http.StatusUnauthorized || body["code"] != "UNAUTHORIZED" {
		t.Fatalf("wrong password: %d %v", status, body)
	}
	if status, body := call(http.MethodPost, "/api/v1/auth/logout", ""); status != http.StatusOK || body["ok"] != true {
		t.Fatalf("logout: %d %v", status, body)
	}
	if status, _ := call(http.MethodGet, "/api/v1/auth/me", ""); status != http.StatusUnauthorized {
		t.Fatalf("me after sign-out: %d", status)
	}
	// Neither the password nor the email reached the log.
	for _, secret := range []string{"parol-1234", "wired@test.local"} {
		if strings.Contains(stdout.String(), secret) {
			t.Errorf("the log holds %q", secret)
		}
	}
	// The stored hash is of the production cost.
	var hash string
	if err := pool.QueryRow(context.Background(), `SELECT "passwordHash" FROM "User" WHERE "email" = 'wired@test.local'`).Scan(&hash); err != nil || !strings.HasPrefix(hash, "$2a$12$") {
		t.Errorf("stored hash %.7q (%v), want bcrypt cost 12", hash, err)
	}
}

// A password reset through everything that is wired in production: the
// server queues the job, the worker makes the link and writes the message
// (to the outbox: no mail is sent from a test), the link sets the password.
func TestAPasswordResetThroughTheQueueAndTheWorker(t *testing.T) {
	t.Parallel()
	pool := schemaDB(t)
	migrateRiver(t, pool)
	outbox := filepath.Join(t.TempDir(), "outbox")
	mail := map[string]string{"MAIL_TRANSPORT": "outbox", "MAIL_OUTBOX_DIR": outbox, "PUBLIC_BASE_URL": "http://127.0.0.1:3100"}
	call, stdout := startServer(t, pool, mail)
	worker := startWorker(t, pool, mail)

	if status, body := call(http.MethodPost, "/api/v1/auth/register", registrationOf("reset@test.local")); status != http.StatusCreated {
		t.Fatalf("register: %d %v", status, body)
	}
	for _, email := range []string{"reset@test.local", "nobody@test.local"} {
		if status, body := call(http.MethodPost, "/api/v1/auth/password/forgot", `{"email":"`+email+`"}`); status != http.StatusOK || body["ok"] != true {
			t.Fatalf("forgot %s: %d %v", email, status, body)
		}
	}
	waitFor(t, "both jobs to finish", func() bool {
		return count(t, pool, `SELECT count(*) FROM river.river_job WHERE kind = 'password_reset_mail' AND state = 'completed'`) == 2
	})
	files, err := os.ReadDir(outbox)
	if err != nil || len(files) != 1 {
		t.Fatalf("%d messages in the outbox (%v), want one: for the account, none for the unknown address", len(files), err)
	}
	raw, err := os.ReadFile(filepath.Join(outbox, files[0].Name()))
	if err != nil {
		t.Fatal(err)
	}
	var message struct{ To, Text, Subject string }
	if err := json.Unmarshal(raw, &message); err != nil {
		t.Fatal(err)
	}
	link := regexp.MustCompile(`http://127\.0\.0\.1:3100/reset-password\?token=([A-Za-z0-9_-]{43})`).FindStringSubmatch(message.Text)
	if message.To != "reset@test.local" || message.Subject != "Lookly: parolni tiklash" || link == nil {
		t.Fatalf("message %+v", message)
	}

	if status, body := call(http.MethodPost, "/api/v1/auth/password/reset", `{"token":"`+link[1]+`","password":"yangi-parol-5678"}`); status != http.StatusOK || body["ok"] != true {
		t.Fatalf("reset: %d %v", status, body)
	}
	// The session from the registration is over; the new password signs in.
	if status, _ := call(http.MethodGet, "/api/v1/auth/me", ""); status != http.StatusUnauthorized {
		t.Errorf("me after the reset: %d", status)
	}
	if status, body := call(http.MethodPost, "/api/v1/auth/login", `{"email":"reset@test.local","password":"parol-1234"}`); status != http.StatusUnauthorized {
		t.Errorf("the old password: %d %v", status, body)
	}
	if status, body := call(http.MethodPost, "/api/v1/auth/login", `{"email":"reset@test.local","password":"yangi-parol-5678"}`); status != http.StatusOK {
		t.Errorf("the new password: %d %v", status, body)
	}
	if status, body := call(http.MethodPost, "/api/v1/auth/password/reset", `{"token":"`+link[1]+`","password":"uchinchi-parol-9"}`); status != http.StatusBadRequest || body["code"] != "RESET_TOKEN_INVALID" {
		t.Errorf("the link a second time: %d %v", status, body)
	}
	// Neither log holds an address, a password or the token; no job does.
	for _, log := range []string{stdout.String(), worker.stdout.String()} {
		for _, secret := range []string{"test.local", "parol-", link[1]} {
			if strings.Contains(log, secret) {
				t.Errorf("a log holds %q", secret)
			}
		}
	}
	if n := count(t, pool, `SELECT count(*) FROM river.river_job WHERE row_to_json(river_job)::text ILIKE '%test.local%'`); n != 0 {
		t.Errorf("%d jobs hold an e-mail address", n)
	}
	if !strings.Contains(worker.stdout.String(), "password reset link sent") {
		t.Errorf("the worker's log does not say that a link was sent:\n%s", worker.stdout.String())
	}
}

// The server starts without the queue's tables. The operations that need
// the queue fail until `lookly migrate river` has run, and the log says so.
func TestServeWithoutTheQueuesTables(t *testing.T) {
	t.Parallel()
	pool := schemaDB(t)
	call, stdout := startServer(t, pool, nil)
	if status, body := call(http.MethodPost, "/api/v1/auth/password/forgot", `{"email":"someone@test.local"}`); status != http.StatusInternalServerError || body["code"] != "INTERNAL" {
		t.Errorf("forgot without the queue: %d %v", status, body)
	}
	if !strings.Contains(stdout.String(), "lookly migrate river") {
		t.Errorf("the log does not say what to run: %s", stdout.String())
	}
	// Everything else works.
	if status, body := call(http.MethodPost, "/api/v1/auth/register", registrationOf("noqueue@test.local")); status != http.StatusCreated {
		t.Errorf("register: %d %v", status, body)
	}
}
