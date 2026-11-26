package httpapi

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"lookly/internal/apierr"
	"lookly/internal/media"
	"lookly/internal/storage"
)

// mediaRoute is getMedia, served by hand: the contract's {key} holds
// slashes, which a generated pattern matches as one path segment only, and
// the router's wildcard would redirect paths with "..", "//" or no trailing
// slash instead of refusing them. Every path under the prefix is this
// route; the key is the rest of the path, checked against the keys we make.
const mediaRoute = "GET " + media.PathPrefix + "{key}"

// isMedia reports whether the request is for the media route.
func isMedia(r *http.Request) bool {
	return (r.Method == http.MethodGet || r.Method == http.MethodHead) && strings.HasPrefix(r.URL.Path, media.PathPrefix)
}

// serveMedia answers GET /api/v1/media/<key>?exp=&sig=: the image when the
// link is ours and unexpired, else 404 (never a reason: a bad signature, an
// expired link and a missing image look the same).
func (s *Server) serveMedia(w http.ResponseWriter, r *http.Request) {
	key := strings.TrimPrefix(r.URL.Path, media.PathPrefix)
	q := r.URL.Query()
	if s.s.Media == nil || s.s.Images == nil || !s.s.Media.Verify(key, q.Get("exp"), q.Get("sig"), s.now()) {
		WriteError(w, r, apierr.New(apierr.NotFound))
		return
	}
	data, err := s.s.Images.Get(r.Context(), key)
	switch {
	case errors.Is(err, storage.ErrNotFound):
		WriteError(w, r, apierr.New(apierr.NotFound))
		return
	case err != nil:
		WriteError(w, r, err)
		return
	}
	h := w.Header()
	h.Set("Content-Type", storage.ContentType(key))
	h.Set("Content-Length", strconv.Itoa(len(data)))
	// As the Next.js server: an hour in the client's own cache, whatever the
	// link's lifetime; never in a shared one.
	h.Set("Cache-Control", "private, max-age=3600")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Content-Security-Policy", "default-src 'none'")
	w.WriteHeader(http.StatusOK)
	if r.Method != http.MethodHead {
		_, _ = w.Write(data) // a client that left; nothing more to send
	}
}
