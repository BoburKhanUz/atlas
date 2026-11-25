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
func blackhole(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	var conns []net.Conn
	var mu sync.Mutex
	go func() {
		for {
			c, err := l.Accept()
			if err != nil {
				return
			}
			mu.Lock()
			conns = append(conns, c)
			mu.Unlock()
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
	return l.Addr().String()
}

func TestUsage(t *testing.T) {
	t.Parallel()
	for _, args := range [][]string{nil, {"bogus"}} {
		var stderr bytes.Buffer
		code := app.Run(context.Background(), args, env(nil), &bytes.Buffer{}, &stderr)
		if code != 2 || !strings.Contains(stderr.String(), "usage: lookly serve | health") {
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

func serve(t *testing.T, databaseHost string) started {
	t.Helper()
	addr := freeAddr(t)
	ctx, cancel := context.WithCancel(context.Background())
	s := started{addr: addr, stdout: &syncBuffer{}, cancel: cancel, done: make(chan int, 1)}
	go func() {
		s.done <- app.Run(ctx, []string{"serve"}, env(map[string]string{
			"LOOKLY_ENV":            "test",
			"LOOKLY_HTTP_ADDR":      addr,
			"DATABASE_URL":          "postgresql://lookly@" + databaseHost + "/lookly",
			"LOOKLY_SHUTDOWN_GRACE": "5s",
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
	s := serve(t, "127.0.0.1:1") // nothing listens: the database is down
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
	s := serve(t, blackhole(t))
	result := make(chan int, 1)
	go func() {
		resp, err := http.Get("http://" + s.addr + "/api/health")
		if err != nil {
			result <- -1
			return
		}
		resp.Body.Close()
		result <- resp.StatusCode
	}()
	time.Sleep(300 * time.Millisecond) // the request is in flight
	s.cancel()
	select {
	case status := <-result:
		if status != http.StatusServiceUnavailable {
			t.Fatalf("the running request got %d, want its 503 answer", status)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the running request never finished")
	}
	if code := <-s.done; code != 0 {
		t.Fatalf("exit %d", code)
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
