//go:build integration

package app_test

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/cookiejar"
	"strings"
	"testing"
	"time"

	"lookly/internal/app"
	"lookly/internal/legal"
)

// The served binary, wired as in production: configuration → services →
// gate → router. One account goes through register, "who am I", refresh and
// sign-out over real HTTP, with the real password hasher.
func TestServeRunsTheAuthOperationsEndToEnd(t *testing.T) {
	t.Parallel()
	pool := schemaDB(t)
	addr := freeAddr(t)
	ctx, cancel := context.WithCancel(context.Background())
	stdout := &syncBuffer{}
	done := make(chan int, 1)
	go func() {
		done <- app.Run(ctx, []string{"serve"}, appEnv(pool, map[string]string{"LOOKLY_HTTP_ADDR": addr}), stdout, &syncBuffer{})
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
	call := func(method, path, body string) (int, map[string]any) {
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
	}

	if status, body := call(http.MethodGet, "/api/v1/auth/me", ""); status != http.StatusUnauthorized || body["code"] != "UNAUTHORIZED" {
		t.Fatalf("me without a session: %d %v", status, body)
	}
	registration, _ := json.Marshal(map[string]any{
		"email": "wired@test.local", "password": "parol-1234", "acceptedLegalVersion": legal.Version, "ageConfirmed": true,
	})
	if status, body := call(http.MethodPost, "/api/v1/auth/register", string(registration)); status != http.StatusCreated {
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
