package storage

import (
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

const (
	testBucket    = "lookly-test"
	testAccessKey = "test-access-key-id"
	testSecret    = "test-secret-access-key-not-used-anywhere-else"
)

// fakeS3 is the part of an S3-compatible service the driver uses, in
// memory. It checks every request as the service does: the access key, the
// signature over the request as it arrived, and the payload's hash.
type fakeS3 struct {
	t        *testing.T
	mu       sync.Mutex
	objects  map[string][]byte
	modified map[string]time.Time
	requests []string // "METHOD path?query", as received
	pageSize int      // the most a listing returns at once (0: what is asked)
	// fail answers every request with this status, when set; bare, with
	// this status and nothing else (a proxy before the service).
	fail int
	bare int
}

func newFakeS3(t *testing.T) (*fakeS3, *httptest.Server) {
	f := &fakeS3{t: t, objects: map[string][]byte{}, modified: map[string]time.Time{}}
	server := httptest.NewServer(f)
	t.Cleanup(server.Close)
	return f, server
}

func s3Error(w http.ResponseWriter, status int, code string) {
	w.Header().Set("Content-Type", "application/xml")
	w.WriteHeader(status)
	// As the real services answer: the code, and parts of the request.
	fmt.Fprintf(w, `<?xml version="1.0" encoding="UTF-8"?><Error><Code>%s</Code><Message>refused</Message><CanonicalRequest>GET /secret-looking-detail</CanonicalRequest></Error>`, code)
}

func (f *fakeS3) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	f.mu.Lock()
	defer f.mu.Unlock()
	f.requests = append(f.requests, r.Method+" "+r.URL.RequestURI())
	if f.fail != 0 {
		s3Error(w, f.fail, "InternalError")
		return
	}
	if f.bare != 0 {
		w.WriteHeader(f.bare)
		return
	}

	// The service signs the path and the query as they arrived, byte for
	// byte: a request sent in another spelling than it was signed in fails.
	if r.URL.EscapedPath() != canonicalPath(r.URL) || r.URL.RawQuery != canonicalQuery(r.URL.Query()) {
		s3Error(w, http.StatusForbidden, "SignatureDoesNotMatch")
		return
	}
	auth := r.Header.Get("Authorization")
	if !strings.HasPrefix(auth, "AWS4-HMAC-SHA256 Credential="+testAccessKey+"/") {
		s3Error(w, http.StatusForbidden, "InvalidAccessKeyId")
		return
	}
	at, err := time.Parse("20060102T150405Z", r.Header.Get("X-Amz-Date"))
	if err != nil {
		s3Error(w, http.StatusForbidden, "AccessDenied")
		return
	}
	_, signedList, _ := strings.Cut(auth, "SignedHeaders=")
	signedList, _, _ = strings.Cut(signedList, ",")
	again, _ := http.NewRequest(r.Method, "http://"+r.Host+r.URL.RequestURI(), nil)
	for _, name := range strings.Split(signedList, ";") {
		if name != "host" {
			again.Header[http.CanonicalHeaderKey(name)] = r.Header[http.CanonicalHeaderKey(name)]
		}
	}
	credentials{accessKeyID: testAccessKey, secret: testSecret, region: "auto"}.sign(again, r.Header.Get("X-Amz-Content-Sha256"), at)
	if again.Header.Get("Authorization") != auth {
		s3Error(w, http.StatusForbidden, "SignatureDoesNotMatch")
		return
	}
	for _, required := range []string{"host", "x-amz-content-sha256", "x-amz-date"} {
		if !slices.Contains(strings.Split(signedList, ";"), required) {
			s3Error(w, http.StatusForbidden, "AccessDenied")
			return
		}
	}
	if r.Header.Get("X-Amz-Content-Sha256") != hexSHA256(body) {
		s3Error(w, http.StatusBadRequest, "XAmzContentSHA256Mismatch")
		return
	}

	bucket, key, _ := strings.Cut(strings.TrimPrefix(r.URL.Path, "/"), "/")
	if bucket != testBucket {
		s3Error(w, http.StatusNotFound, "NoSuchBucket")
		return
	}
	switch {
	case key == "" && r.Method == http.MethodGet && r.URL.Query().Get("list-type") == "2":
		f.list(w, r)
	case key != "" && r.Method == http.MethodPut:
		f.objects[key] = body
		f.modified[key] = time.Now().UTC().Truncate(time.Second)
		if want := ContentType(key); r.Header.Get("Content-Type") != want {
			f.t.Errorf("PUT %s declared as %q, want %q", key, r.Header.Get("Content-Type"), want)
		}
	case key != "" && r.Method == http.MethodGet:
		data, ok := f.objects[key]
		if !ok {
			s3Error(w, http.StatusNotFound, "NoSuchKey")
			return
		}
		_, _ = w.Write(data)
	case key != "" && r.Method == http.MethodDelete:
		delete(f.objects, key)
		delete(f.modified, key)
		w.WriteHeader(http.StatusNoContent)
	default:
		s3Error(w, http.StatusMethodNotAllowed, "MethodNotAllowed")
	}
}

func (f *fakeS3) list(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	var keys []string
	for key := range f.objects {
		if strings.HasPrefix(key, q.Get("prefix")) && key > q.Get("continuation-token") {
			keys = append(keys, key)
		}
	}
	slices.Sort(keys)
	limit, _ := strconv.Atoi(q.Get("max-keys"))
	if f.pageSize > 0 && (limit == 0 || f.pageSize < limit) {
		limit = f.pageSize
	}
	type content struct {
		Key          string
		LastModified string
	}
	var page struct {
		XMLName               xml.Name `xml:"ListBucketResult"`
		IsTruncated           bool
		NextContinuationToken string `xml:",omitempty"`
		Contents              []content
	}
	if limit > 0 && len(keys) > limit {
		keys = keys[:limit]
		page.IsTruncated, page.NextContinuationToken = true, keys[limit-1]
	}
	for _, key := range keys {
		page.Contents = append(page.Contents, content{key, f.modified[key].Format("2006-01-02T15:04:05.000Z")})
	}
	out, _ := xml.Marshal(page)
	_, _ = w.Write(out)
}

func (f *fakeS3) put(key string, data []byte) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.objects[key] = data
	f.modified[key] = time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)
}

func (f *fakeS3) keys() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	var keys []string
	for key := range f.objects {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	return keys
}

func (f *fakeS3) requestCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.requests)
}

func newTestR2(t *testing.T, endpoint string, change func(*R2Config)) *R2 {
	t.Helper()
	c := R2Config{Endpoint: endpoint, Bucket: testBucket, Region: "auto", AccessKeyID: testAccessKey, SecretAccessKey: testSecret}
	if change != nil {
		change(&c)
	}
	r, err := NewR2(c)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

const (
	r2Key   = "users/u_one/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d.jpg"
	r2Thumb = "users/u_one/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d_thumb.webp"
)

func TestR2PutGetDelete(t *testing.T) {
	t.Parallel()
	f, server := newFakeS3(t)
	r := newTestR2(t, server.URL, nil)
	ctx := context.Background()

	if _, err := r.Get(ctx, r2Key); !errors.Is(err, ErrNotFound) {
		t.Fatalf("an object not stored: %v", err)
	}
	binary := []byte{0, 1, 2, 255, '\n', 0}
	if err := r.Put(ctx, r2Key, binary); err != nil {
		t.Fatal(err)
	}
	if err := r.Put(ctx, r2Thumb, nil); err != nil { // an empty object is an object
		t.Fatal(err)
	}
	if got, err := r.Get(ctx, r2Key); err != nil || !bytes.Equal(got, binary) {
		t.Fatalf("read %v, %v", got, err)
	}
	if got, err := r.Get(ctx, r2Thumb); err != nil || len(got) != 0 {
		t.Fatalf("read the empty object: %v, %v", got, err)
	}
	// Written again, it is replaced.
	if err := r.Put(ctx, r2Key, []byte("second")); err != nil {
		t.Fatal(err)
	}
	if got, _ := r.Get(ctx, r2Key); string(got) != "second" {
		t.Fatalf("after the second write: %q", got)
	}
	if !slices.Equal(f.keys(), []string{r2Key, r2Thumb}) {
		t.Fatalf("the bucket holds %v", f.keys())
	}

	// Deleting: the named objects, missing ones without complaint.
	missing := "users/u_one/ffffffff-4e5f-4a6b-8c7d-9e0f1a2b3c4d.png"
	if err := r.Delete(ctx, r2Key, missing); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Get(ctx, r2Key); !errors.Is(err, ErrNotFound) {
		t.Fatalf("after the deletion: %v", err)
	}
	if !slices.Equal(f.keys(), []string{r2Thumb}) {
		t.Fatalf("the bucket holds %v", f.keys())
	}
	if err := r.Delete(ctx); err != nil {
		t.Fatal(err)
	}
}

// A key we never make is not sent to the service at all.
func TestR2RefusesKeysWeNeverMakeWithoutARequest(t *testing.T) {
	t.Parallel()
	f, server := newFakeS3(t)
	r := newTestR2(t, server.URL, nil)
	ctx := context.Background()
	f.put("secrets.txt", []byte("not ours"))
	for _, key := range []string{"", "secrets.txt", "../secrets.txt", "users/u_one/../../secrets.txt", "users/u_one/x.jpg", "/users/u_one/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d.jpg", r2Key + "?versionId=1", "users/u one/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d.jpg"} {
		if err := r.Put(ctx, key, []byte("x")); err == nil {
			t.Errorf("%q was written", key)
		}
		if _, err := r.Get(ctx, key); !errors.Is(err, ErrNotFound) {
			t.Errorf("%q read: %v", key, err)
		}
		if err := r.Delete(ctx, key); err != nil {
			t.Errorf("%q deleted: %v", key, err)
		}
	}
	if err := r.DeleteOwner(ctx, "../x"); err == nil {
		t.Error("an owner that is no id was accepted")
	}
	if n := f.requestCount(); n != 0 {
		t.Errorf("%d requests were sent: %v", n, f.requests)
	}
	if !slices.Equal(f.keys(), []string{"secrets.txt"}) {
		t.Errorf("the bucket holds %v", f.keys())
	}
}

func TestR2ListsEveryObjectUnderUsersPageByPage(t *testing.T) {
	t.Parallel()
	f, server := newFakeS3(t)
	// Pages of three: the first ends at a name with a space in it, which
	// the next request must carry as it is signed.
	f.pageSize = 3
	r := newTestR2(t, server.URL, nil)
	want := []string{
		r2Key, r2Thumb,
		"users/u_one/a name we never make.txt",
		"users/u_two/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d.png",
		"users/u_two/odd/deeper+name&=%.bin",
	}
	for _, key := range want {
		f.put(key, []byte("x"))
	}
	f.put("elsewhere/file", []byte("x")) // outside users/: not ours to list
	var got []Object
	if err := r.List(context.Background(), func(o Object) error {
		got = append(got, o)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	var keys []string
	for _, o := range got {
		keys = append(keys, o.Key)
		if !o.ModifiedAt.Equal(time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)) {
			t.Errorf("%s modified at %s", o.Key, o.ModifiedAt)
		}
	}
	slices.Sort(keys)
	if !slices.Equal(keys, want) {
		t.Fatalf("listed %v, want %v", keys, want)
	}
	if n := f.requestCount(); n != 2 || !strings.Contains(f.requests[1], "continuation-token=users%2Fu_one%2Fa%20name%20we%20never%20make.txt") {
		t.Errorf("%d requests for 5 objects in pages of 3: %v", n, f.requests)
	}

	// An error of the caller's stops the listing and comes back as it is.
	stop := errors.New("enough")
	seen := 0
	if err := r.List(context.Background(), func(Object) error {
		seen++
		return stop
	}); err != stop || seen != 1 { // the caller's own error, not wrapped
		t.Fatalf("err %v after %d objects", err, seen)
	}
}

func TestR2DeleteOwnerRemovesEverythingOfThatOwnerOnly(t *testing.T) {
	t.Parallel()
	f, server := newFakeS3(t)
	f.pageSize = 2
	r := newTestR2(t, server.URL, nil)
	for _, key := range []string{
		r2Key, r2Thumb, "users/u_one/a name we never make.txt", "users/u_one/odd/deeper+name&=%.bin", "users/u_one/ko‘ylak.jpg",
	} {
		f.put(key, []byte("x"))
	}
	kept := []string{"users/u_one2/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d.jpg", "users/u_two/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d.jpg"}
	for _, key := range kept {
		f.put(key, []byte("x"))
	}
	if err := r.DeleteOwner(context.Background(), "u_one"); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(f.keys(), kept) {
		t.Fatalf("the bucket holds %v, want %v", f.keys(), kept)
	}
	// Again, with nothing left: not an error.
	if err := r.DeleteOwner(context.Background(), "u_one"); err != nil {
		t.Fatal(err)
	}
}

// What the service refuses or cannot do is an error that names the object
// and the service's code, and never the credentials or the request.
func TestR2FailuresAreReportedWithoutSecrets(t *testing.T) {
	t.Parallel()
	f, server := newFakeS3(t)
	ctx := context.Background()
	check := func(what string, err error, want string) {
		t.Helper()
		if err == nil || errors.Is(err, ErrNotFound) {
			t.Fatalf("%s: err %v", what, err)
		}
		msg := err.Error()
		if !strings.Contains(msg, want) {
			t.Errorf("%s: %q does not say %q", what, msg, want)
		}
		for _, secret := range []string{testSecret, "Signature=", "AWS4-HMAC", "secret-looking-detail", server.URL} {
			if strings.Contains(msg, secret) {
				t.Errorf("%s: the error shows %q: %s", what, secret, msg)
			}
		}
	}

	wrongSecret := newTestR2(t, server.URL, func(c *R2Config) { c.SecretAccessKey = "another-secret-another-secret" })
	check("a wrong secret, write", wrongSecret.Put(ctx, r2Key, []byte("x")), "status 403 (SignatureDoesNotMatch)")
	_, err := wrongSecret.Get(ctx, r2Key)
	check("a wrong secret, read", err, "read "+r2Key)
	check("a wrong secret, delete", wrongSecret.Delete(ctx, r2Key), "delete "+r2Key)
	check("a wrong secret, list", wrongSecret.List(ctx, func(Object) error { return nil }), "status 403")
	check("a wrong secret, owner", wrongSecret.DeleteOwner(ctx, "u_one"), "owner u_one")

	wrongKey := newTestR2(t, server.URL, func(c *R2Config) { c.AccessKeyID = "someone-else" })
	check("an unknown access key", wrongKey.Put(ctx, r2Key, []byte("x")), "InvalidAccessKeyId")
	wrongRegion := newTestR2(t, server.URL, func(c *R2Config) { c.Region = "us-east-1" })
	check("another region", wrongRegion.Put(ctx, r2Key, []byte("x")), "SignatureDoesNotMatch")
	// A bucket that is not there is not "no such object".
	wrongBucket := newTestR2(t, server.URL, func(c *R2Config) { c.Bucket = "another-bucket" })
	check("a missing bucket, write", wrongBucket.Put(ctx, r2Key, []byte("x")), "NoSuchBucket")
	_, err = wrongBucket.Get(ctx, r2Key)
	check("a missing bucket, read", err, "NoSuchBucket")
	// Nor is deleting from it a deletion done: the rows that name the
	// files would go while the files stay wherever they are.
	check("a missing bucket, delete", wrongBucket.Delete(ctx, r2Key), "NoSuchBucket")
	if len(f.keys()) != 0 {
		t.Errorf("something was stored: %v", f.keys())
	}

	r := newTestR2(t, server.URL, nil)
	f.mu.Lock()
	f.fail = http.StatusServiceUnavailable
	f.mu.Unlock()
	check("the service down, write", r.Put(ctx, r2Key, []byte("x")), "status 503")
	_, err = r.Get(ctx, r2Key)
	check("the service down, read", err, "status 503")
	check("the service down, delete", r.Delete(ctx, r2Key, r2Thumb), "delete "+r2Thumb)

	// "Not found" without the service's own word for it is, for a read,
	// the object's absence.
	f.mu.Lock()
	f.fail, f.bare = 0, http.StatusNotFound
	f.mu.Unlock()
	if _, err := r.Get(ctx, r2Key); !errors.Is(err, ErrNotFound) {
		t.Errorf("a bare 404, read: %v", err)
	}
	// A deletion is not done by it: the service answers 204 for an object
	// that was not there, so this 404 is somebody else's.
	check("a bare 404, delete", r.Delete(ctx, r2Key), "status 404")

	// Nothing listening: the cause, without the address.
	server.Close()
	_, err = r.Get(ctx, r2Key)
	check("nothing listening", err, "read "+r2Key)

	// A request that was given up.
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if err := r.Put(cancelled, r2Key, []byte("x")); !errors.Is(err, context.Canceled) {
		t.Errorf("a cancelled write: %v", err)
	}
	if err := r.Delete(cancelled, r2Key); !errors.Is(err, context.Canceled) {
		t.Errorf("a cancelled deletion: %v", err)
	}
}

// At start: a bucket that refuses the request is a setting to fix; one
// that cannot be reached may come back.
func TestR2Check(t *testing.T) {
	t.Parallel()
	f, server := newFakeS3(t)
	ctx := context.Background()
	if permanent, err := newTestR2(t, server.URL, nil).Check(ctx); err != nil || permanent {
		t.Fatalf("a good bucket: %v, permanent %v", err, permanent)
	}
	for name, change := range map[string]func(*R2Config){
		"a wrong secret":   func(c *R2Config) { c.SecretAccessKey = "another-secret-another-secret" },
		"a wrong key":      func(c *R2Config) { c.AccessKeyID = "someone-else" },
		"a missing bucket": func(c *R2Config) { c.Bucket = "another-bucket" },
	} {
		if permanent, err := newTestR2(t, server.URL, change).Check(ctx); err == nil || !permanent || strings.Contains(err.Error(), testSecret) {
			t.Errorf("%s: %v, permanent %v", name, err, permanent)
		}
	}
	r := newTestR2(t, server.URL, nil)
	for _, status := range []int{http.StatusInternalServerError, http.StatusServiceUnavailable, http.StatusTooManyRequests} {
		f.mu.Lock()
		f.fail = status
		f.mu.Unlock()
		if permanent, err := r.Check(ctx); err == nil || permanent {
			t.Errorf("status %d: %v, permanent %v", status, err, permanent)
		}
	}
	server.Close()
	if permanent, err := r.Check(ctx); err == nil || permanent {
		t.Errorf("nothing listening: %v, permanent %v", err, permanent)
	}
}

// The service's answer is never followed to another host: the request is
// signed for this one.
func TestR2DoesNotFollowRedirects(t *testing.T) {
	t.Parallel()
	var elsewhere int
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		elsewhere++
		_, _ = w.Write([]byte("from elsewhere"))
	}))
	defer other.Close()
	redirecting := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, other.URL+r.URL.Path, http.StatusTemporaryRedirect)
	}))
	defer redirecting.Close()
	r := newTestR2(t, redirecting.URL, nil)
	if data, err := r.Get(context.Background(), r2Key); err == nil || errors.Is(err, ErrNotFound) || !strings.Contains(err.Error(), "status 307") {
		t.Errorf("read %q, %v", data, err)
	}
	if elsewhere != 0 {
		t.Errorf("%d requests went to the other host", elsewhere)
	}
}

// A listing that says "more" without a way on does not loop for ever.
func TestR2ListingThatDoesNotAdvanceEnds(t *testing.T) {
	t.Parallel()
	var requests int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		fmt.Fprint(w, `<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>same</NextContinuationToken><Contents><Key>users/u/x</Key><LastModified>2026-11-01T12:00:00.000Z</LastModified></Contents></ListBucketResult>`)
	}))
	defer server.Close()
	r := newTestR2(t, server.URL, nil)
	err := r.List(context.Background(), func(Object) error { return nil })
	if err == nil || requests != 2 {
		t.Fatalf("err %v after %d requests", err, requests)
	}
	// And an answer that is not a listing is an error, not an empty bucket.
	broken := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("<html>maintenance")) }))
	defer broken.Close()
	if err := newTestR2(t, broken.URL, nil).List(context.Background(), func(Object) error { return nil }); err == nil {
		t.Fatal("a broken listing was read as an empty one")
	}
}

func TestNewR2RefusesIncompleteSettings(t *testing.T) {
	t.Parallel()
	good := R2Config{Endpoint: "https://account.r2.cloudflarestorage.com", Bucket: "b", Region: "auto", AccessKeyID: "k", SecretAccessKey: "s"}
	if _, err := NewR2(good); err != nil {
		t.Fatal(err)
	}
	for name, change := range map[string]func(*R2Config){
		"no endpoint":      func(c *R2Config) { c.Endpoint = "" },
		"no scheme":        func(c *R2Config) { c.Endpoint = "account.r2.cloudflarestorage.com" },
		"another scheme":   func(c *R2Config) { c.Endpoint = "ftp://account.r2.cloudflarestorage.com" },
		"no bucket":        func(c *R2Config) { c.Bucket = "" },
		"no region":        func(c *R2Config) { c.Region = "" },
		"no access key id": func(c *R2Config) { c.AccessKeyID = "" },
		"no secret":        func(c *R2Config) { c.SecretAccessKey = "" },
	} {
		c := good
		change(&c)
		if _, err := NewR2(c); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}
