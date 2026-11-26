// Package idempotency makes a retried request create its resource once: a
// request that carries an Idempotency-Key claims it (per user and route, for
// 24 hours) before doing any work, and completes the claim in the
// transaction that creates the resource.
//
//	first request                          claimed; completed with the resource's id
//	same key, same request, completed      replay: the caller answers with the original resource
//	same key, another request              ErrMismatch
//	same key, still in progress            ErrInProgress (retry in a few seconds)
//	in progress for 5 minutes (a crash)    taken over by the next request
//	the earlier attempt failed             it released the claim, so a retry runs
//
// The rows and the request hash are the Next.js API's
// (apps/web/src/server/idempotency.ts): a retry may reach either server
// until the cutover.
package idempotency

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"lookly/internal/platform"
	"lookly/internal/store"
)

const (
	// TTL is how long a key is remembered.
	TTL = 24 * time.Hour
	// Stale is how long a claim may stay in progress before the next
	// request with the key takes it over.
	Stale = 5 * time.Minute
)

// ErrMismatch: the key was used for another request.
var ErrMismatch = errors.New("idempotency: the key was used for another request")

// ErrClaimLost: the claim was taken over while its request ran; the
// transaction that tried to complete it must roll back, so that the
// resource is not created twice.
var ErrClaimLost = errors.New("idempotency: the claim was taken over")

// InProgressError: another request with the key is still running.
type InProgressError struct{ RetryAfter time.Duration }

func (e *InProgressError) Error() string { return "idempotency: a request with the key is in progress" }

// Request names a request: whose it is, the route, the key it carries and
// the hash of its content.
type Request struct {
	UserID, Route, Key, Hash string
}

// Claim is a key held by the request that runs. ClaimedAt identifies it: a
// takeover replaces it, after which the old holder can neither complete nor
// release.
type Claim struct {
	ID        string
	ClaimedAt time.Time
}

// Replay is the outcome of the request that completed the key earlier.
type Replay struct {
	ResourceID     *string
	ResponseStatus *int32
}

// Service claims and releases keys.
type Service struct{ pool *pgxpool.Pool }

// New returns a Service over the pool.
func New(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

// Begin claims the key for the request, or reports the replay of a
// completed one (then the claim is nil). ErrMismatch and *InProgressError
// are the refusals.
func (s *Service) Begin(ctx context.Context, r Request) (*Claim, *Replay, error) {
	q := store.New(s.pool)
	if err := q.DeleteExpiredIdempotencyKeysOfUser(ctx, r.UserID); err != nil {
		return nil, nil, fmt.Errorf("idempotency: purge expired keys: %w", err)
	}
	id := platform.NewID()
	claimedAt, err := q.ClaimIdempotencyKey(ctx, store.ClaimIdempotencyKeyParams{
		ID: id, UserID: r.UserID, Route: r.Route, Key: r.Key, RequestHash: r.Hash, TtlMs: TTL.Milliseconds(),
	})
	if err == nil {
		return &Claim{ID: id, ClaimedAt: claimedAt}, nil, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, fmt.Errorf("idempotency: claim: %w", err)
	}
	existing, err := q.IdempotencyKeyOfRequest(ctx, store.IdempotencyKeyOfRequestParams{UserId: r.UserID, Route: r.Route, Key: r.Key})
	if errors.Is(err, pgx.ErrNoRows) {
		// Released or expired in between: the retry will claim it.
		return nil, nil, &InProgressError{RetryAfter: time.Second}
	}
	if err != nil {
		return nil, nil, fmt.Errorf("idempotency: read: %w", err)
	}
	if existing.RequestHash != r.Hash {
		return nil, nil, ErrMismatch
	}
	if existing.Status == "completed" {
		return nil, &Replay{ResourceID: existing.ResourceId, ResponseStatus: existing.ResponseStatus}, nil
	}
	claimedAt, err = q.TakeOverIdempotencyKey(ctx, store.TakeOverIdempotencyKeyParams{
		ID: existing.ID, TtlMs: TTL.Milliseconds(), StaleMs: Stale.Milliseconds(),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, &InProgressError{RetryAfter: 5 * time.Second}
	}
	if err != nil {
		return nil, nil, fmt.Errorf("idempotency: take over: %w", err)
	}
	return &Claim{ID: existing.ID, ClaimedAt: claimedAt}, nil, nil
}

// Complete records the resource the request created. It is called with the
// queries of the transaction that creates the resource; ErrClaimLost when
// the claim was taken over meanwhile.
func Complete(ctx context.Context, q *store.Queries, c Claim, resourceID string, responseStatus int32) error {
	n, err := q.CompleteIdempotencyKey(ctx, store.CompleteIdempotencyKeyParams{
		ID: c.ID, ClaimedAt: c.ClaimedAt, ResourceID: &resourceID, ResponseStatus: &responseStatus,
	})
	if err != nil {
		return fmt.Errorf("idempotency: complete: %w", err)
	}
	if n != 1 {
		return ErrClaimLost
	}
	return nil
}

// Release forgets a failed attempt so that a retry runs; a claim that was
// taken over is left to its new holder.
func (s *Service) Release(ctx context.Context, c Claim) error {
	if err := store.New(s.pool).ReleaseIdempotencyKey(ctx, store.ReleaseIdempotencyKeyParams{ID: c.ID, ClaimedAt: c.ClaimedAt}); err != nil {
		return fmt.Errorf("idempotency: release: %w", err)
	}
	return nil
}

// MultipartHash is the hash of a multipart upload: SHA-256 over the file's
// own SHA-256, the file's name and the other form fields sorted by name.
// It is the Next.js multipartRequestHash to the byte, JSON spelling and
// JavaScript's string order included.
func MultipartHash(file []byte, filename string, fields map[string]string) string {
	fileHash := sha256.Sum256(file)
	names := make([]string, 0, len(fields))
	for name := range fields {
		names = append(names, name)
	}
	slices.SortFunc(names, compareUTF16)
	var entries strings.Builder
	entries.WriteByte('[')
	for i, name := range names {
		if i > 0 {
			entries.WriteByte(',')
		}
		entries.WriteString("[" + jsString(name) + "," + jsString(fields[name]) + "]")
	}
	entries.WriteByte(']')

	h := sha256.New()
	h.Write([]byte("v1\n"))
	h.Write([]byte(hex.EncodeToString(fileHash[:]) + "\n"))
	h.Write([]byte(jsString(filename) + "\n"))
	h.Write([]byte(entries.String()))
	return hex.EncodeToString(h.Sum(nil))
}

// compareUTF16 orders strings as JavaScript's < does: by UTF-16 code units.
func compareUTF16(a, b string) int {
	return slices.Compare(utf16.Encode([]rune(a)), utf16.Encode([]rune(b)))
}

// jsString is a string as JavaScript's JSON.stringify writes it: only the
// quote, the backslash and the control characters below U+0020 are escaped.
// (Go's encoder also escapes <, >, &, U+2028 and U+2029.)
func jsString(s string) string {
	var b strings.Builder
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"':
			b.WriteString(`\"`)
		case '\\':
			b.WriteString(`\\`)
		case '\b':
			b.WriteString(`\b`)
		case '\f':
			b.WriteString(`\f`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case '\t':
			b.WriteString(`\t`)
		default:
			if r < 0x20 {
				fmt.Fprintf(&b, `\u%04x`, r)
			} else {
				b.WriteRune(r)
			}
		}
	}
	b.WriteByte('"')
	return b.String()
}
