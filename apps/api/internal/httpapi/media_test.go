package httpapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"lookly/internal/httpapi"
	"lookly/internal/media"
	"lookly/internal/storage"
)

const (
	mediaSecret = "media-http-test-secret-media-http-test-secret"
	ownKey      = "users/u_media/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d_display.webp"
)

var mediaNow = time.Unix(1_800_000_000, 0)

// failingStore is a store whose reads fail (a disk or R2 error).
type failingStore struct{ storage.Store }

func (failingStore) Get(context.Context, string) ([]byte, error) {
	return nil, errors.New("disk on fire at /srv/uploads")
}

type mediaServer struct {
	handler http.Handler
	signer  *media.Signer
	store   storage.Store
	logs    *logs
}

func newMediaServer(t *testing.T, store storage.Store) *mediaServer {
	t.Helper()
	if store == nil {
		local, err := storage.NewLocal(t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		store = local
	}
	signer := media.NewSigner([]byte(mediaSecret), time.Hour, "")
	l := &logs{}
	s := httpapi.NewServer(httpapi.Services{Media: signer, Images: store, Now: func() time.Time { return mediaNow }})
	return &mediaServer{httpapi.New(s, slog.New(slog.NewJSONHandler(l, nil)), &httpapi.Gate{}), signer, store, l}
}

func (m *mediaServer) put(t *testing.T, key string, data []byte) {
	t.Helper()
	if err := m.store.Put(context.Background(), key, data); err != nil {
		t.Fatal(err)
	}
}

// link is the path and query of a signed link to key, signed at signedAt.
func (m *mediaServer) link(t *testing.T, key string, signedAt time.Time) string {
	t.Helper()
	full, _ := m.signer.Sign(key, signedAt)
	u, err := url.Parse(full)
	if err != nil {
		t.Fatal(err)
	}
	return u.RequestURI()
}

func (m *mediaServer) get(t *testing.T, method, target string, header http.Header) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(method, "http://lookly.test"+target, nil)
	for k, v := range header {
		r.Header[k] = v
	}
	w := httptest.NewRecorder()
	m.handler.ServeHTTP(w, r)
	return w
}

func wantNotFound(t *testing.T, w *httptest.ResponseRecorder) {
	t.Helper()
	if w.Code != http.StatusNotFound {
		t.Fatalf("status %d, body %q", w.Code, w.Body.String())
	}
	var body struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil || body.Code != "NOT_FOUND" {
		t.Fatalf("not the NOT_FOUND envelope: %q", w.Body.String())
	}
	if ct := w.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Fatalf("content type %q", ct)
	}
}

func TestMediaServesTheImageOfASignedLink(t *testing.T) {
	t.Parallel()
	m := newMediaServer(t, nil)
	types := map[string]string{
		ownKey: "image/webp",
		"users/u_media/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d.jpg":       "image/jpeg",
		"users/u_media/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d.png":       "image/png",
		"users/u_media/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d.webp":      "image/webp",
		"users/u_media/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d_thumb.jpg": "image/jpeg", // a Phase 2 thumbnail
	}
	for key, contentType := range types {
		data := []byte("bytes of " + key)
		m.put(t, key, data)
		// Signed a moment ago, and signed exactly a lifetime ago (the link
		// still opens through its expiry second).
		for _, signedAt := range []time.Time{mediaNow.Add(-time.Minute), mediaNow.Add(-time.Hour)} {
			w := m.get(t, http.MethodGet, m.link(t, key, signedAt), nil)
			if w.Code != http.StatusOK || !bytes.Equal(w.Body.Bytes(), data) {
				t.Fatalf("%s: status %d, body %q", key, w.Code, w.Body.String())
			}
			h := w.Header()
			want := map[string]string{
				"Content-Type":            contentType,
				"Content-Length":          strconv.Itoa(len(data)),
				"Cache-Control":           "private, max-age=3600",
				"X-Content-Type-Options":  "nosniff",
				"Content-Security-Policy": "default-src 'none'",
			}
			for name, value := range want {
				if got := h.Get(name); got != value {
					t.Errorf("%s: %s is %q, want %q", key, name, got, value)
				}
			}
		}
	}

	// HEAD: the same headers, no body.
	w := m.get(t, http.MethodHead, m.link(t, ownKey, mediaNow), nil)
	if w.Code != http.StatusOK || w.Header().Get("Content-Type") != "image/webp" || w.Body.Len() != 0 {
		t.Fatalf("HEAD: status %d, type %q, %d bytes", w.Code, w.Header().Get("Content-Type"), w.Body.Len())
	}

	// The link is the credential: whatever else the request carries (a
	// bad token, cookies, another site) changes nothing.
	header := http.Header{
		"Authorization":  {"Bearer not-a-token"},
		"Cookie":         {"atlas_at=garbage"},
		"Origin":         {"https://elsewhere.example"},
		"Sec-Fetch-Site": {"cross-site"},
	}
	if w := m.get(t, http.MethodGet, m.link(t, ownKey, mediaNow), header); w.Code != http.StatusOK {
		t.Fatalf("with other credentials: status %d, body %q", w.Code, w.Body.String())
	}

	// Slashes sent encoded are slashes, as the Next.js server reads each
	// path segment.
	encoded := strings.Replace(m.link(t, ownKey, mediaNow), "users/u_media/", "users%2Fu_media%2F", 1)
	if w := m.get(t, http.MethodGet, encoded, nil); w.Code != http.StatusOK {
		t.Fatalf("encoded slashes: status %d", w.Code)
	}
}

func TestMediaRefusesEveryOtherLinkWithNotFound(t *testing.T) {
	t.Parallel()
	m := newMediaServer(t, nil)
	m.put(t, ownKey, []byte("image"))
	good := m.link(t, ownKey, mediaNow)
	u, _ := url.Parse(good)
	exp, sig := u.Query().Get("exp"), u.Query().Get("sig")
	path := media.PathPrefix + ownKey

	otherSecret := media.NewSigner([]byte("another-secret-another-secret-another-secret"), time.Hour, "")
	forged, _ := otherSecret.Sign(ownKey, mediaNow)
	forgedURL, _ := url.Parse(forged)

	otherOwner := "users/u_other/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d_display.webp"
	m.put(t, otherOwner, []byte("someone else's image"))

	missing := "users/u_media/ffffffff-4e5f-4a6b-8c7d-9e0f1a2b3c4d_display.webp"

	cases := map[string]string{
		"no query":                      path,
		"no signature":                  path + "?exp=" + exp,
		"no expiry":                     path + "?sig=" + sig,
		"empty signature":               path + "?exp=" + exp + "&sig=",
		"signature of another key":      media.PathPrefix + otherOwner + "?exp=" + exp + "&sig=" + sig,
		"signature changed":             path + "?exp=" + exp + "&sig=" + flip(sig),
		"signature padded":              path + "?exp=" + exp + "&sig=" + sig + "=",
		"expiry changed":                path + "?exp=" + strconv.FormatInt(mediaNow.Unix()+7200, 10) + "&sig=" + sig,
		"expiry with a sign":            path + "?exp=%2B" + exp + "&sig=" + sig,
		"another secret":                forgedURL.RequestURI(),
		"expired one second ago":        m.link(t, ownKey, mediaNow.Add(-time.Hour-time.Second)),
		"signed but not stored":         m.link(t, missing, mediaNow),
		"signed, a key we never make":   m.link(t, "users/u_media/../u_other/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d_display.webp", mediaNow),
		"signed, a path outside":        m.link(t, "../../etc/passwd", mediaNow),
		"signed, an absolute path":      m.link(t, "/etc/passwd", mediaNow),
		"signed, an empty key":          m.link(t, "", mediaNow),
		"a doubled slash":               strings.Replace(good, "users/u_media/", "users//u_media/", 1),
		"no key":                        media.PathPrefix + "?exp=" + exp + "&sig=" + sig,
		"the prefix without its slash":  strings.TrimSuffix(media.PathPrefix, "/") + "?exp=" + exp + "&sig=" + sig,
		"the key in the query":          media.PathPrefix + "?key=" + url.QueryEscape(ownKey) + "&exp=" + exp + "&sig=" + sig,
		"a dot segment before the key":  media.PathPrefix + "./" + ownKey + "?exp=" + exp + "&sig=" + sig,
		"a parent segment in the path":  media.PathPrefix + "x/../" + ownKey + "?exp=" + exp + "&sig=" + sig,
		"a trailing slash":              path + "/?exp=" + exp + "&sig=" + sig,
		"the key upper case":            media.PathPrefix + strings.ToUpper(ownKey) + "?exp=" + exp + "&sig=" + sig,
		"an extension added":            path + ".png?exp=" + exp + "&sig=" + sig,
		"an encoded NUL in the key":     media.PathPrefix + "users/u_media%00/x?exp=" + exp + "&sig=" + sig,
		"an expiry of thirteen digits":  path + "?exp=1" + exp + "&sig=" + sig,
		"two expiries, the first wrong": path + "?exp=1&exp=" + exp + "&sig=" + sig,
	}
	for name, target := range cases {
		t.Run(name, func(t *testing.T) {
			wantNotFound(t, m.get(t, http.MethodGet, target, nil))
		})
	}
	// Other methods do not exist (the contract has no 405).
	for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodDelete, http.MethodPatch} {
		wantNotFound(t, m.get(t, method, good, nil))
	}
	// The good link still works: the refusals above are not a broken setup.
	if w := m.get(t, http.MethodGet, good, nil); w.Code != http.StatusOK {
		t.Fatalf("the good link: status %d", w.Code)
	}
}

// flip changes the signature's first character to another base64url one.
func flip(sig string) string {
	if sig[0] == 'A' {
		return "B" + sig[1:]
	}
	return "A" + sig[1:]
}

func TestMediaStoreFailureIsInternalAndTheLogKeepsTheLinkOut(t *testing.T) {
	t.Parallel()
	m := newMediaServer(t, failingStore{})
	link := m.link(t, ownKey, mediaNow)
	w := m.get(t, http.MethodGet, link, nil)
	if w.Code != http.StatusInternalServerError || !strings.Contains(w.Body.String(), `"INTERNAL"`) {
		t.Fatalf("status %d, body %q", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "disk on fire") {
		t.Errorf("the answer shows the cause: %q", w.Body.String())
	}
	u, _ := url.Parse(link)
	logged := m.logs.String()
	if !strings.Contains(logged, "disk on fire") {
		t.Errorf("the cause is not logged: %s", logged)
	}
	if strings.Contains(logged, u.Query().Get("sig")) || strings.Contains(logged, "exp=") {
		t.Errorf("the log holds the signed link: %s", logged)
	}
	var routed bool
	for _, line := range m.logs.lines(t) {
		if line["msg"] == "request" && line["route"] == "GET /api/v1/media/{key}" && line["status"] == float64(500) {
			routed = true
		}
	}
	if !routed {
		t.Errorf("no access log line with the media route: %s", logged)
	}
}

// A server without the media settings (as the other unit tests build it)
// serves no image at all.
func TestMediaWithoutSettingsServesNothing(t *testing.T) {
	t.Parallel()
	signer := media.NewSigner([]byte(mediaSecret), time.Hour, "")
	link, _ := signer.Sign(ownKey, time.Now())
	u, _ := url.Parse(link)
	for name, services := range map[string]httpapi.Services{
		"neither":    {},
		"no store":   {Media: signer},
		"no signing": {Images: failingStore{}},
	} {
		h := httpapi.New(httpapi.NewServer(services), slog.New(slog.DiscardHandler), &httpapi.Gate{})
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "http://lookly.test"+u.RequestURI(), nil))
		if w.Code != http.StatusNotFound {
			t.Errorf("%s: status %d", name, w.Code)
		}
	}
}
