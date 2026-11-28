package app_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"lookly/internal/app"
	"lookly/internal/config/configtest"
)

// syncBuffer is written by the server goroutine and read by the test.
type syncBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *syncBuffer) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.Write(p)
}

func (s *syncBuffer) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.String()
}

func env(vars map[string]string) func(string) (string, bool) {
	return func(k string) (string, bool) {
		v, ok := vars[k]
		return v, ok
	}
}

func freeAddr(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := l.Addr().String()
	l.Close()
	return addr
}

// blackhole accepts connections and never answers: a database that hangs.
// accepted receives a value for each connection (the server is pinging).
func blackhole(t *testing.T) (addr string, accepted <-chan struct{}) {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	var conns []net.Conn
	var mu sync.Mutex
	ch := make(chan struct{}, 16)
	go func() {
		for {
			c, err := l.Accept()
			if err != nil {
				return
			}
			mu.Lock()
			conns = append(conns, c)
			mu.Unlock()
			select {
			case ch <- struct{}{}:
			default:
			}
		}
	}()
	t.Cleanup(func() {
		l.Close()
		mu.Lock()
		defer mu.Unlock()
		for _, c := range conns {
			c.Close()
		}
	})
	return l.Addr().String(), ch
}

func TestUsage(t *testing.T) {
	t.Parallel()
	for _, args := range [][]string{nil, {"bogus"}, {"migrate"}, {"migrate", "public"}, {"serve", "extra"}} {
		var stderr bytes.Buffer
		code := app.Run(context.Background(), args, env(nil), &bytes.Buffer{}, &stderr)
		if code != 2 || !strings.Contains(stderr.String(), "usage: lookly serve | worker | health | migrate river") {
			t.Errorf("%v: exit %d, stderr %q", args, code, stderr.String())
		}
	}
}

func TestServeRefusesInvalidConfigurationWithoutListening(t *testing.T) {
	t.Parallel()
	addr := freeAddr(t)
	var stderr bytes.Buffer
	code := app.Run(context.Background(), []string{"serve"},
		env(map[string]string{"LOOKLY_HTTP_ADDR": addr, "DATABASE_URL": "postgresql://u:s3cret-pass@db/x"}),
		&bytes.Buffer{}, &stderr)
	if code != 2 {
		t.Fatalf("exit %d", code)
	}
	if !strings.Contains(stderr.String(), "LOOKLY_ENV") || strings.Contains(stderr.String(), "s3cret-pass") {
		t.Errorf("stderr %q", stderr.String())
	}
	if c, err := net.DialTimeout("tcp", addr, 200*time.Millisecond); err == nil {
		c.Close()
		t.Error("something listens on the address")
	}
}

type started struct {
	addr   string
	stdout *syncBuffer
	cancel context.CancelFunc
	done   chan int
}

func serve(t *testing.T, databaseHost, grace string) started {
	t.Helper()
	addr := freeAddr(t)
	ctx, cancel := context.WithCancel(context.Background())
	s := started{addr: addr, stdout: &syncBuffer{}, cancel: cancel, done: make(chan int, 1)}
	go func() {
		s.done <- app.Run(ctx, []string{"serve"}, configtest.Getenv(map[string]string{
			"LOOKLY_HTTP_ADDR":      addr,
			"DATABASE_URL":          "postgresql://lookly@" + databaseHost + "/lookly",
			"LOOKLY_SHUTDOWN_GRACE": grace,
			"STORAGE_LOCAL_DIR":     t.TempDir(), // serve opens it
		}), s.stdout, &syncBuffer{})
	}()
	t.Cleanup(cancel)
	deadline := time.Now().Add(5 * time.Second)
	for {
		if c, err := net.DialTimeout("tcp", addr, 100*time.Millisecond); err == nil {
			c.Close()
			return s
		}
		if time.Now().After(deadline) {
			t.Fatalf("server did not start: %s", s.stdout.String())
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestServeAnswersAndStopsCleanly(t *testing.T) {
	t.Parallel()
	s := serve(t, "127.0.0.1:1", "5s") // nothing listens: the database is down
	resp, err := http.Get("http://" + s.addr + "/api/health")
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]string
	_ = json.NewDecoder(resp.Body).Decode(&body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusServiceUnavailable || body["database"] != "unreachable" || body["version"] != "dev" {
		t.Fatalf("health: %d %v", resp.StatusCode, body)
	}
	s.cancel()
	select {
	case code := <-s.done:
		if code != 0 {
			t.Fatalf("exit %d: %s", code, s.stdout.String())
		}
	case <-time.After(10 * time.Second):
		t.Fatal("did not stop")
	}
	if c, err := net.DialTimeout("tcp", s.addr, 200*time.Millisecond); err == nil {
		c.Close()
		t.Error("still listening after shutdown")
	}
	out := s.stdout.String()
	for _, want := range []string{`"msg":"starting"`, `"version":"dev"`, `"msg":"stopped"`} {
		if !strings.Contains(out, want) {
			t.Errorf("log lacks %s: %s", want, out)
		}
	}
	if strings.Contains(out, "lookly@127.0.0.1") {
		t.Errorf("the log shows the database URL: %s", out)
	}
}

func TestAStopSignalLetsARunningRequestFinish(t *testing.T) {
	t.Parallel()
	// The database accepts and never answers: health takes its full ping
	// timeout (2 s), during which the stop signal arrives.
	db, pinging := blackhole(t)
	s := serve(t, db, "5s")
	result := make(chan int, 1)
	sent := time.Now()
	go func() {
		resp, err := http.Get("http://" + s.addr + "/api/health")
		if err != nil {
			result <- -1
			return
		}
		resp.Body.Close()
		result <- resp.StatusCode
	}()
	select {
	case <-pinging: // the request is in its handler
	case <-time.After(5 * time.Second):
		t.Fatal("the request never reached the database")
	}
	s.cancel()
	time.Sleep(300 * time.Millisecond) // draining: the request still runs (its ping takes 2 s)
	if c, err := net.DialTimeout("tcp", s.addr, 200*time.Millisecond); err == nil {
		c.Close()
		t.Error("a new connection was accepted while draining")
	}
	select {
	case status := <-result:
		if status != http.StatusServiceUnavailable {
			t.Fatalf("the running request got %d, want its 503 answer", status)
		}
		// It ran to its own end (the 2 s ping timeout): the stop signal did
		// not cancel it.
		if took := time.Since(sent); took < 1800*time.Millisecond {
			t.Errorf("the request ended after %s: the stop signal cancelled it", took)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the running request never finished")
	}
	if code := <-s.done; code != 0 {
		t.Fatalf("exit %d", code)
	}
}

func TestARequestLongerThanTheGracePeriodDoesNotKeepTheProcessAlive(t *testing.T) {
	t.Parallel()
	// The request needs 2 s (the ping timeout); the grace period is 1 s.
	db, pinging := blackhole(t)
	s := serve(t, db, "1s")
	go func() {
		if resp, err := http.Get("http://" + s.addr + "/api/health"); err == nil {
			resp.Body.Close()
		}
	}()
	<-pinging
	stopped := time.Now()
	s.cancel()
	select {
	case code := <-s.done:
		if code != 1 {
			t.Errorf("exit %d, want 1 (requests were cut off)", code)
		}
		if took := time.Since(stopped); took > 1800*time.Millisecond {
			t.Errorf("stopping took %s; the grace period is 1s", took)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the process did not stop")
	}
	if !strings.Contains(s.stdout.String(), "grace period ended") {
		t.Errorf("not logged: %s", s.stdout.String())
	}
}

func TestWorkerAndMigrateRiverReportAnUnreachableDatabaseAsSuch(t *testing.T) {
	t.Parallel()
	for _, args := range [][]string{{"worker"}, {"migrate", "river"}} {
		var stderr bytes.Buffer
		code := app.Run(context.Background(), args, configtest.Getenv(map[string]string{
			"DATABASE_URL": "postgresql://secretuser@127.0.0.1:1/proddb",
		}), &bytes.Buffer{}, &stderr)
		msg := stderr.String()
		if code != 1 || !strings.Contains(msg, "cannot reach the database") {
			t.Errorf("%v: exit %d, stderr %q", args, code, msg)
		}
		for _, leak := range []string{"secretuser", "proddb", "127.0.0.1", "migrate river"} {
			if strings.Contains(msg, leak) {
				t.Errorf("%v: stderr shows %q: %s", args, leak, msg)
			}
		}
	}
}

func TestHealthCommand(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		status int
		exit   int
	}{{http.StatusOK, 0}, {http.StatusServiceUnavailable, 1}} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/api/health" {
				t.Errorf("path %s", r.URL.Path)
			}
			w.WriteHeader(tc.status)
		}))
		port := srv.Listener.Addr().(*net.TCPAddr).Port
		var stderr bytes.Buffer
		code := app.Run(context.Background(), []string{"health"},
			env(map[string]string{"LOOKLY_HTTP_ADDR": ":" + strconv.Itoa(port)}), &bytes.Buffer{}, &stderr)
		srv.Close()
		if code != tc.exit {
			t.Errorf("status %d: exit %d (%s)", tc.status, code, stderr.String())
		}
	}
	// Nothing listening: unhealthy.
	if code := app.Run(context.Background(), []string{"health"},
		env(map[string]string{"LOOKLY_HTTP_ADDR": freeAddr(t)}), &bytes.Buffer{}, &bytes.Buffer{}); code != 1 {
		t.Errorf("no server: exit %d", code)
	}
}

// production runs serve with a production configuration (the database is
// down: nothing here needs it), calls during once it listens, stops it and
// returns its log.
func production(t *testing.T, extra map[string]string, during func(addr string)) string {
	t.Helper()
	addr := freeAddr(t)
	vars := map[string]string{
		"LOOKLY_ENV":        "production",
		"LOOKLY_HTTP_ADDR":  addr,
		"DATABASE_URL":      "postgresql://lookly@127.0.0.1:1/lookly?sslmode=disable", // nothing listens there
		"STORAGE_LOCAL_DIR": t.TempDir(),
		// Until stage B6 a deployed server needs the mock acknowledged.
		"AI_LLM_PROVIDER": "mock", "AI_VISION_PROVIDER": "mock", "AI_ALLOW_MOCK_IN_PRODUCTION": "1",
	}
	for k, v := range extra {
		vars[k] = v
	}
	ctx, cancel := context.WithCancel(context.Background())
	stdout, done := &syncBuffer{}, make(chan int, 1)
	go func() { done <- app.Run(ctx, []string{"serve"}, configtest.Getenv(vars), stdout, &syncBuffer{}) }()
	deadline := time.Now().Add(5 * time.Second)
	for {
		if c, err := net.DialTimeout("tcp", addr, 100*time.Millisecond); err == nil {
			c.Close()
			break
		}
		if time.Now().After(deadline) {
			cancel()
			t.Fatalf("server did not start: %s", stdout.String())
		}
		time.Sleep(20 * time.Millisecond)
	}
	if during != nil {
		during(addr)
	}
	cancel()
	<-done
	return stdout.String()
}

// In production the server says so, once, when it does not know its clients'
// addresses: behind the reverse proxy that is a mistake that weakens the
// rate limits. It is not refused: a server reached directly must not
// believe forwarding headers.
func TestServeWarnsInProductionWhenClientAddressesAreUnknown(t *testing.T) {
	t.Parallel()
	if log := production(t, nil, nil); strings.Count(log, "TRUST_PROXY is not 1") != 1 {
		t.Errorf("production without TRUST_PROXY: %d warnings in\n%s", strings.Count(log, "TRUST_PROXY is not 1"), log)
	}
	if log := production(t, map[string]string{"TRUST_PROXY": "1"}, nil); strings.Contains(log, "TRUST_PROXY is not 1") {
		t.Errorf("production with TRUST_PROXY=1 warns:\n%s", log)
	}
	if log := production(t, map[string]string{"LOOKLY_ENV": "staging"}, nil); strings.Contains(log, "TRUST_PROXY is not 1") {
		t.Errorf("staging warns:\n%s", log)
	}
}

// Where cookies are Secure (production) the cross-site guard is told the
// site is https only: a write from our own host name over plain http is
// refused; the same over https reaches the handler.
func TestServeInProductionRefusesWritesFromAnHTTPOrigin(t *testing.T) {
	t.Parallel()
	production(t, nil, func(addr string) {
		post := func(origin string) int {
			req, err := http.NewRequest(http.MethodPost, "http://"+addr+"/api/v1/auth/logout", nil)
			if err != nil {
				t.Fatal(err)
			}
			req.Header.Set("Origin", origin)
			res, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			res.Body.Close()
			return res.StatusCode
		}
		if got := post("http://" + addr); got != http.StatusForbidden {
			t.Errorf("a write from the http origin of our host: %d, want 403", got)
		}
		// Past the guard: the handler then finds the database down.
		if got := post("https://" + addr); got != http.StatusInternalServerError {
			t.Errorf("a write from the https origin of our host: %d, want it past the guard (500: the database is down)", got)
		}
	})
}

// While stage B6 is under way the server has the AI settings before it has
// the AI: a real provider configured for a role this build cannot serve yet
// stops the server, instead of being quietly served by the mock.
func TestServeRefusesARealAIProviderItCannotServeYet(t *testing.T) {
	t.Parallel()
	for name, vars := range map[string]map[string]string{
		"text":    {"AI_LLM_PROVIDER": "openai", "AI_LLM_MODEL": "gpt-test", "OPENAI_API_KEY": "fake-key-not-printed"},
		"stylist": {"AI_STYLIST_PROVIDER": "gemini", "AI_STYLIST_MODEL": "gemini-test", "GEMINI_API_KEY": "fake-key-not-printed"},
	} {
		addr := freeAddr(t)
		all := configtest.Env(map[string]string{"LOOKLY_ENV": "development", "LOOKLY_HTTP_ADDR": addr, "DATABASE_URL": "postgresql://u@127.0.0.1:1/x"})
		for k, v := range vars {
			all[k] = v
		}
		for _, command := range []string{"serve", "worker"} {
			var stderr bytes.Buffer
			code := app.Run(context.Background(), []string{command}, env(all), &bytes.Buffer{}, &stderr)
			if code != 2 || !strings.Contains(stderr.String(), "real AI provider") || strings.Contains(stderr.String(), "fake-key") {
				t.Errorf("%s, %s: exit %d, stderr %q", name, command, code, stderr.String())
			}
		}
		if c, err := net.DialTimeout("tcp", addr, 100*time.Millisecond); err == nil {
			c.Close()
			t.Errorf("%s: something listens on the address", name)
		}
	}
}

// The garment analysis (B6.4) and the outfit ranking (B6.5) are served by
// a real provider: the setting no longer stops the server (the worker
// below stops for the unreachable database, not for the provider).
func TestARealProviderOfAServedRoleIsServed(t *testing.T) {
	t.Parallel()
	for name, vars := range map[string]map[string]string{
		"vision": {"AI_VISION_PROVIDER": "openai", "AI_VISION_MODEL": "gpt-vision-test", "OPENAI_API_KEY": "fake-key-not-printed"},
		"outfit": {"AI_OUTFIT_PROVIDER": "openai", "AI_OUTFIT_MODEL": "gpt-test", "OPENAI_API_KEY": "fake-key-not-printed"},
	} {
		all := configtest.Env(map[string]string{"LOOKLY_ENV": "development", "DATABASE_URL": "postgresql://u@127.0.0.1:1/x"})
		for k, v := range vars {
			all[k] = v
		}
		var stderr bytes.Buffer
		code := app.Run(context.Background(), []string{"worker"}, env(all), &bytes.Buffer{}, &stderr)
		if code == 0 || strings.Contains(stderr.String(), "real AI provider") || strings.Contains(stderr.String(), "fake-key") ||
			!strings.Contains(stderr.String(), "cannot reach the database") {
			t.Errorf("%s: exit %d, stderr %q", name, code, stderr.String())
		}
	}
}
