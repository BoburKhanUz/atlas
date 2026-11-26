//go:build integration

package app_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"lookly/internal/app"
	"lookly/internal/config/configtest"
	"lookly/internal/legal"
	"lookly/internal/media"
)

// The served binary, wired as in production: configuration → services →
// gate → router. One account goes through register, "who am I", refresh and
// sign-out over real HTTP, with the real password hasher.
// startServer runs `lookly serve` on the pool's database and returns a
// caller of its API that keeps cookies, and the server's log.
func startServer(t *testing.T, pool *pgxpool.Pool, extra map[string]string) (call func(method, path, body string) (int, map[string]any), stdout *syncBuffer) {
	t.Helper()
	call, stdout, _ = startServerAt(t, pool, extra)
	return call, stdout
}

// startServerAt is startServer that also says where the server listens.
func startServerAt(t *testing.T, pool *pgxpool.Pool, extra map[string]string) (call func(method, path, body string) (int, map[string]any), stdout *syncBuffer, addr string) {
	t.Helper()
	addr = freeAddr(t)
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
		if res.StatusCode >= http.StatusInternalServerError {
			t.Logf("%s %s answered %d; the server's log:\n%s", method, path, res.StatusCode, stdout.String())
		}
		return res.StatusCode, decoded
	}, stdout, addr
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
	// Not parallel: these servers hash passwords at the production cost, and
	// under the race detector several of them at once starve each other
	// past the request time limit.
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
	if status, body := call(http.MethodPost, "/api/v1/auth/login", `{"email":"reset@test.local","password":"yangi-parol-5678"}`); status != http.StatusOK {
		t.Errorf("the new password: %d %v", status, body)
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
	// Not parallel: these servers hash passwords at the production cost, and
	// under the race detector several of them at once starve each other
	// past the request time limit.
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
	// An account is not deleted when its images cannot be queued for removal.
	if status, body := call(http.MethodDelete, "/api/v1/account", ""); status != http.StatusInternalServerError || body["code"] != "INTERNAL" {
		t.Errorf("delete without the queue: %d %v", status, body)
	}
	if status, _ := call(http.MethodGet, "/api/v1/auth/me", ""); status != http.StatusOK {
		t.Errorf("the account after a failed deletion: %d", status)
	}
}

// An account's deletion through everything that is wired in production:
// the server deletes the rows and queues the job; the worker removes the
// account's images from the storage directory, and nobody else's.
func TestAnAccountDeletionRemovesItsImages(t *testing.T) {
	// Not parallel: these servers hash passwords at the production cost, and
	// under the race detector several of them at once starve each other
	// past the request time limit.
	pool := schemaDB(t)
	migrateRiver(t, pool)
	uploads := t.TempDir()
	storage := map[string]string{"STORAGE_LOCAL_DIR": uploads}
	call, stdout := startServer(t, pool, storage)
	other, _ := startServer(t, pool, storage) // a second client: another user
	worker := startWorker(t, pool, storage)

	ids := map[string]string{}
	for email, register := range map[string]func(method, path, body string) (int, map[string]any){"leaving@test.local": call, "staying@test.local": other} {
		status, body := register(http.MethodPost, "/api/v1/auth/register", registrationOf(email))
		if status != http.StatusCreated {
			t.Fatalf("register %s: %d %v", email, status, body)
		}
		ids[email] = body["user"].(map[string]any)["id"].(string)
		dir := filepath.Join(uploads, "users", ids[email])
		if err := os.MkdirAll(dir, 0o700); err != nil {
			t.Fatal(err)
		}
		for _, name := range []string{"a.jpg", "a_display.webp", "a_thumb.webp"} {
			if err := os.WriteFile(filepath.Join(dir, name), []byte("image"), 0o600); err != nil {
				t.Fatal(err)
			}
		}
	}

	if status, body := call(http.MethodDelete, "/api/v1/account", ""); status != http.StatusOK || body["ok"] != true {
		t.Fatalf("delete: %d %v", status, body)
	}
	if status, _ := call(http.MethodGet, "/api/v1/auth/me", ""); status != http.StatusUnauthorized {
		t.Errorf("me after the deletion: %d", status)
	}
	waitFor(t, "the images to be removed", func() bool {
		_, err := os.Stat(filepath.Join(uploads, "users", ids["leaving@test.local"]))
		return os.IsNotExist(err)
	})
	if _, err := os.Stat(filepath.Join(uploads, "users", ids["staying@test.local"], "a.jpg")); err != nil {
		t.Errorf("the other user's images: %v", err)
	}
	if status, _ := other(http.MethodGet, "/api/v1/auth/me", ""); status != http.StatusOK {
		t.Errorf("the other user after the deletion: %d", status)
	}
	waitFor(t, "the job to finish", func() bool {
		return count(t, pool, `SELECT count(*) FROM river.river_job WHERE kind = 'account_purge_images' AND state = 'completed'`) == 1
	})
	for name, log := range map[string]string{"server": stdout.String(), "worker": worker.stdout.String()} {
		if strings.Contains(log, "test.local") {
			t.Errorf("the %s's log holds an e-mail address", name)
		}
	}
	if !strings.Contains(stdout.String(), "account deleted") || !strings.Contains(worker.stdout.String(), "images of a deleted account removed") {
		t.Error("the logs do not record the deletion and the removal of the images")
	}
}

// The worker removes images and the server serves them: neither starts
// without the directory they are in.
func TestServerAndWorkerRefuseToStartWithoutTheStorageDirectory(t *testing.T) {
	t.Parallel()
	pool := schemaDB(t)
	migrateRiver(t, pool)
	for _, command := range []string{"worker", "serve"} {
		var stderr bytes.Buffer
		missing := filepath.Join(t.TempDir(), "not-there")
		code := app.Run(context.Background(), []string{command}, appEnv(pool, map[string]string{"STORAGE_LOCAL_DIR": missing}), &bytes.Buffer{}, &stderr)
		if code != 2 || !strings.Contains(stderr.String(), "STORAGE_LOCAL_DIR") {
			t.Errorf("%s: exit %d, stderr %q", command, code, stderr.String())
		}
	}
}

// r2Env points the storage at a bucket of the given service.
func r2Env(endpoint string) map[string]string {
	return map[string]string{
		"STORAGE_DRIVER": "r2", "R2_ENDPOINT": endpoint, "R2_BUCKET": "lookly-test",
		"R2_ACCESS_KEY_ID": "test-access-key-id", "R2_SECRET_ACCESS_KEY": "test-secret-access-key-never-printed",
	}
}

// A bucket that refuses the request (a wrong key, a wrong name) is a
// setting to fix: neither the server nor the worker starts, and what they
// say names the settings, never the secret.
func TestServerAndWorkerRefuseToStartWhenTheBucketRefusesThem(t *testing.T) {
	t.Parallel()
	pool := schemaDB(t)
	migrateRiver(t, pool)
	for status, code := range map[int]string{http.StatusForbidden: "SignatureDoesNotMatch", http.StatusNotFound: "NoSuchBucket"} {
		var asked atomic.Int32
		bucket := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			asked.Add(1)
			w.WriteHeader(status)
			fmt.Fprintf(w, "<Error><Code>%s</Code></Error>", code)
		}))
		for _, command := range []string{"serve", "worker"} {
			var stdout, stderr bytes.Buffer
			exit := app.Run(context.Background(), []string{command}, appEnv(pool, r2Env(bucket.URL)), &stdout, &stderr)
			said := stdout.String() + stderr.String()
			if exit != 2 || !strings.Contains(stderr.String(), "R2_BUCKET") || !strings.Contains(stderr.String(), code) {
				t.Errorf("%s with %s: exit %d, stderr %q", command, code, exit, stderr.String())
			}
			if strings.Contains(said, "never-printed") || strings.Contains(said, "Signature=") {
				t.Errorf("%s with %s shows the credentials: %s", command, code, said)
			}
		}
		if asked.Load() != 2 {
			t.Errorf("%s: the bucket was asked %d times", code, asked.Load())
		}
		bucket.Close()
	}
}

// A bucket that does not answer right now may come back: the server starts
// and says so.
func TestServerStartsWhenTheBucketDoesNotAnswer(t *testing.T) {
	t.Parallel()
	pool := schemaDB(t)
	migrateRiver(t, pool)
	down := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer down.Close()
	call, stdout := startServer(t, pool, r2Env(down.URL))
	if status, _ := call(http.MethodGet, "/api/health", ""); status != http.StatusOK {
		t.Fatalf("health %d", status)
	}
	if log := stdout.String(); !strings.Contains(log, "the image bucket does not answer") || !strings.Contains(log, "status 503") || strings.Contains(log, "never-printed") {
		t.Errorf("log: %s", log)
	}
	if !strings.Contains(stdout.String(), `"storageDriver":"r2"`) {
		t.Errorf("the start line does not say where the images are: %s", stdout.String())
	}
}

// With a bucket that answers, the server serves its images from it.
func TestServerServesImagesFromTheBucket(t *testing.T) {
	t.Parallel()
	pool := schemaDB(t)
	migrateRiver(t, pool)
	const key = "users/u_one/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d_display.webp"
	bucket := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/lookly-test" && r.URL.Query().Get("list-type") == "2":
			fmt.Fprint(w, "<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>")
		case r.URL.Path == "/lookly-test/"+key && r.Header.Get("Authorization") != "":
			fmt.Fprint(w, "image bytes from the bucket")
		default:
			w.WriteHeader(http.StatusNotFound)
			fmt.Fprint(w, "<Error><Code>NoSuchKey</Code></Error>")
		}
	}))
	defer bucket.Close()
	vars := r2Env(bucket.URL)
	vars["MEDIA_SIGNING_SECRET"] = configtest.MediaSigningSecret
	_, _, addr := startServerAt(t, pool, vars)
	link, _ := media.NewSigner([]byte(configtest.MediaSigningSecret), time.Hour, "").Sign(key, time.Now())
	res, err := http.Get("http://" + addr + link)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	if res.StatusCode != http.StatusOK || string(body) != "image bytes from the bucket" || res.Header.Get("Content-Type") != "image/webp" {
		t.Fatalf("%d %q %s", res.StatusCode, body, res.Header.Get("Content-Type"))
	}
}
