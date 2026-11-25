// Package httpapi is the HTTP edge of the server: the router generated from
// the contract, the middleware every request passes through, and the error
// envelope. Handlers decode, call one service method and encode; errors are
// turned into the envelope here and nowhere else.
package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"runtime/debug"
	"time"

	"lookly/internal/apierr"
	"lookly/internal/httpapi/contract"
)

// DefaultBodyLimit caps every request body (64 KB, the Next.js API's JSON
// limit). It is enforced while reading, so a body without Content-Length
// cannot get past it. Routes with larger bodies (uploads) raise it for
// themselves when they are added.
const DefaultBodyLimit = 64 << 10

// New builds the server's handler: the routes generated from the contract
// over server, wrapped in the middleware (Wrap).
func New(server contract.StrictServerInterface, log *slog.Logger) http.Handler {
	mux := http.NewServeMux()
	strict := contract.NewStrictHandlerWithOptions(server, nil, contract.StrictHTTPServerOptions{
		RequestErrorHandlerFunc:  RequestError,
		ResponseErrorHandlerFunc: WriteError,
	})
	contract.HandlerWithOptions(strict, contract.StdHTTPServerOptions{
		BaseRouter:       mux,
		ErrorHandlerFunc: RequestError,
	})
	return Wrap(routed(mux), log)
}

// routed answers 404 in the envelope for an unknown path or method (the
// contract has no method-not-allowed code) and records the matched route
// pattern for the access log.
func routed(mux *http.ServeMux) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, pattern := mux.Handler(r)
		if pattern == "" {
			WriteError(w, r, apierr.New(apierr.NotFound))
			return
		}
		if info := infoFrom(r.Context()); info != nil {
			info.route = pattern
		}
		mux.ServeHTTP(w, r)
	})
}

// Wrap adds, outermost first: the request id, the access log, panic recovery
// and the default body limit.
func Wrap(next http.Handler, log *slog.Logger) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		info := &requestInfo{id: requestID(r), route: "unmatched", log: log}
		w.Header().Set("X-Request-Id", info.id)
		rec := &recorder{ResponseWriter: w, status: http.StatusOK}
		r = r.WithContext(context.WithValue(r.Context(), infoKey{}, info))
		// The real writer, not the recorder: net/http must learn that the
		// limit was hit, so it closes the connection instead of draining it.
		r.Body = http.MaxBytesReader(w, r.Body, DefaultBodyLimit)

		defer func() {
			v := recover()
			if v != nil && v != http.ErrAbortHandler { // a sentinel, compared by identity as net/http does
				// The value may hold request data: log its type and the stack only.
				log.Error("panic", "requestId", info.id, "type", fmt.Sprintf("%T", v), "stack", string(debug.Stack()))
				if !rec.wrote {
					WriteError(rec, r, apierr.New(apierr.Internal))
				}
			}
			// Never the query string, headers or body: they can hold tokens,
			// signed URLs and personal data. The route is the pattern, not the path.
			log.Info("request",
				"requestId", info.id,
				"method", r.Method,
				"route", info.route,
				"status", rec.status,
				"bytes", rec.bytes,
				"durationMs", float64(time.Since(started).Microseconds())/1000,
			)
			if v == http.ErrAbortHandler {
				panic(v) // the client went away: net/http closes the connection quietly
			}
		}()
		next.ServeHTTP(rec, r)
	})
}

// WriteError answers with the contract's error envelope. A *apierr.Error
// keeps its code; a body over the limit is PAYLOAD_TOO_LARGE; anything else
// is INTERNAL, and its cause is logged (never sent).
func WriteError(w http.ResponseWriter, r *http.Request, err error) {
	info := infoFrom(r.Context())
	if s, ok := w.(interface{ started() bool }); ok && s.started() {
		// Part of the answer is already sent (writing it failed, usually
		// because the client left): an envelope cannot follow it.
		if info != nil {
			info.log.Warn("response not completed", "requestId", info.id, "route", info.route, "err", err.Error())
		}
		return
	}
	var e *apierr.Error
	var tooLarge *http.MaxBytesError
	switch {
	case errors.As(err, &e):
	case errors.As(err, &tooLarge):
		e = apierr.New(apierr.PayloadTooLarge)
	default:
		if info != nil {
			info.log.Error("internal error", "requestId", info.id, "route", info.route, "err", err.Error())
		}
		e = apierr.New(apierr.Internal)
	}
	if e.Status() >= 500 && e.Code != apierr.Internal && info != nil {
		info.log.Warn("service unavailable", "requestId", info.id, "route", info.route, "code", string(e.Code))
	}
	writeEnvelope(w, info, e)
}

// RequestError answers a request the generated decoder rejected: a
// parameter or header of the wrong form is VALIDATION_ERROR naming it, a
// body over the limit is PAYLOAD_TOO_LARGE, anything else (malformed JSON)
// is BAD_REQUEST. The decoder's own text is never sent.
func RequestError(w http.ResponseWriter, r *http.Request, err error) {
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		writeEnvelope(w, infoFrom(r.Context()), apierr.New(apierr.PayloadTooLarge))
		return
	}
	msg := apierr.ValidationError.Message()
	if name, ok := parameterOf(err); ok {
		writeEnvelope(w, infoFrom(r.Context()), apierr.Validation(msg, apierr.Detail{Path: name, Message: msg}))
		return
	}
	// As the Next.js API (JSON parsed, then validated): a value of the wrong
	// type names its field, and an empty body is read as {} and fails
	// validation. Malformed JSON stays BAD_REQUEST.
	var wrongType *json.UnmarshalTypeError
	if errors.As(err, &wrongType) {
		e := apierr.Validation(msg)
		if wrongType.Field != "" {
			e.Details = []apierr.Detail{{Path: wrongType.Field, Message: msg}}
		}
		writeEnvelope(w, infoFrom(r.Context()), e)
		return
	}
	if errors.Is(err, io.EOF) {
		writeEnvelope(w, infoFrom(r.Context()), apierr.Validation(msg))
		return
	}
	writeEnvelope(w, infoFrom(r.Context()), apierr.New(apierr.BadRequest))
}

func parameterOf(err error) (string, bool) {
	var (
		format   *contract.InvalidParamFormatError
		required *contract.RequiredParamError
		header   *contract.RequiredHeaderError
		unmarsh  *contract.UnmarshalingParamError
		tooMany  *contract.TooManyValuesForParamError
		cookie   *contract.UnescapedCookieParamError
	)
	switch {
	case errors.As(err, &format):
		return format.ParamName, true
	case errors.As(err, &required):
		return required.ParamName, true
	case errors.As(err, &header):
		return header.ParamName, true
	case errors.As(err, &unmarsh):
		return unmarsh.ParamName, true
	case errors.As(err, &tooMany):
		return tooMany.ParamName, true
	case errors.As(err, &cookie):
		return cookie.ParamName, true
	}
	return "", false
}

type envelopeDetail struct {
	Path    string `json:"path"`
	Message string `json:"message"`
}

type envelope struct {
	Error     string           `json:"error"`
	Code      apierr.Code      `json:"code"`
	Details   []envelopeDetail `json:"details,omitempty"`
	RequestID string           `json:"requestId,omitempty"`
}

func writeEnvelope(w http.ResponseWriter, info *requestInfo, e *apierr.Error) {
	body := envelope{Error: e.Message, Code: e.Code}
	if info != nil {
		body.RequestID = info.id
	}
	for _, d := range e.Details {
		body.Details = append(body.Details, envelopeDetail(d))
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(e.Status())
	// Writing can only fail when the client is gone; there is nobody to tell.
	if err := json.NewEncoder(w).Encode(body); err != nil && info != nil {
		info.log.Debug("error response not delivered", "requestId", info.id, "err", err.Error())
	}
}

// requestInfo travels in the request context.
type requestInfo struct {
	id    string
	route string
	log   *slog.Logger
}

type infoKey struct{}

func infoFrom(ctx context.Context) *requestInfo {
	info, _ := ctx.Value(infoKey{}).(*requestInfo)
	return info
}

var clientRequestID = regexp.MustCompile(`^[A-Za-z0-9-]{8,64}$`)

// requestID accepts the client's X-Request-Id when it is well-formed (the
// Next.js API's rule), else generates a random UUID.
func requestID(r *http.Request) string {
	// Several X-Request-Id headers: the Next.js API joins them ("a, b"),
	// which fails the pattern, so a new id is used there too.
	if ids := r.Header.Values("X-Request-Id"); len(ids) == 1 && clientRequestID.MatchString(ids[0]) {
		return ids[0]
	}
	return newUUID()
}

// newUUID returns a random (version 4) UUID.
func newUUID() string {
	var b [16]byte
	_, _ = rand.Read(b[:]) // crypto/rand.Read never fails (it panics instead)
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// recorder captures the status and size for the access log.
type recorder struct {
	http.ResponseWriter
	status int
	bytes  int
	wrote  bool
}

func (r *recorder) WriteHeader(status int) {
	if !r.wrote {
		r.status = status
		r.wrote = true
	}
	r.ResponseWriter.WriteHeader(status)
}

func (r *recorder) Write(b []byte) (int, error) {
	r.wrote = true
	n, err := r.ResponseWriter.Write(b)
	r.bytes += n
	return n, err
}

func (r *recorder) started() bool { return r.wrote }

// Unwrap lets http.ResponseController reach the underlying writer.
func (r *recorder) Unwrap() http.ResponseWriter { return r.ResponseWriter }
