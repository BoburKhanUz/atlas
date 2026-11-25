// Package ratelimit bounds how often something may be attempted (sign-in,
// registration), per subject, with fixed windows kept in PostgreSQL: every
// instance sees the same counters, and they survive a restart.
//
// Subjects (an email, an address) are never stored: a bucket's key is a
// keyed hash that cannot be computed, or tested against guesses, without the
// server's secret.
package ratelimit

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"lookly/internal/store"
)

// DefaultLockTimeout bounds the wait for a bucket someone else holds. Past
// it an attempt fails with an error; it is never let through uncounted.
const DefaultLockTimeout = 2 * time.Second

// Rule allows Limit attempts per subject in a Window. The window starts at
// the subject's first attempt and ends Window later, on the database clock.
type Rule struct {
	Name   string // names the bucket family, such as "login:account"
	Limit  int
	Window time.Duration
}

// For is one attempt under the rule by a subject. The caller normalises the
// subject (a lower-cased email, a canonical address).
func (r Rule) For(subject string) Hit { return Hit{Rule: r, Subject: subject} }

// Hit is one attempt counted against one bucket.
type Hit struct {
	Rule    Rule
	Subject string
}

// Decision is the outcome of Take.
type Decision struct {
	Allowed bool
	// RetryAfter is how long until every limit that refused the attempt
	// has a new window (zero when allowed).
	RetryAfter time.Duration
}

// Limiter counts attempts.
type Limiter struct {
	pool        *pgxpool.Pool
	key         []byte
	lockTimeout time.Duration
}

// Option configures a Limiter.
type Option func(*Limiter)

// WithLockTimeout replaces DefaultLockTimeout (tests use a short one).
func WithLockTimeout(d time.Duration) Option { return func(l *Limiter) { l.lockTimeout = d } }

// New returns a Limiter over the pool. The secret (the server's signing
// secret) is not used as it is: the bucket keys are hashed with a key
// derived from it for this purpose only.
func New(pool *pgxpool.Pool, secret []byte, opts ...Option) *Limiter {
	derive := hmac.New(sha256.New, secret)
	derive.Write([]byte("lookly rate limit bucket keys v1"))
	l := &Limiter{pool: pool, key: derive.Sum(nil), lockTimeout: DefaultLockTimeout}
	for _, o := range opts {
		o(l)
	}
	return l
}

// bucket is the stored key of a hit.
func (l *Limiter) bucket(h Hit) string {
	mac := hmac.New(sha256.New, l.key)
	mac.Write([]byte(h.Rule.Name))
	mac.Write([]byte{0}) // a rule name never holds NUL: name and subject cannot run together
	mac.Write([]byte(h.Subject))
	return hex.EncodeToString(mac.Sum(nil))
}

type keyed struct {
	key string
	hit Hit
}

// ordered gives the hits' buckets in key order: every attempt locks its
// buckets in the same order, so overlapping attempts cannot deadlock.
func (l *Limiter) ordered(hits []Hit) []keyed {
	out := make([]keyed, len(hits))
	for i, h := range hits {
		out[i] = keyed{l.bucket(h), h}
	}
	slices.SortFunc(out, func(a, b keyed) int { return strings.Compare(a.key, b.key) })
	return out
}

// Take counts one attempt against every hit, or against none: when any of
// them is at its limit the attempt is refused and nothing is counted.
// Concurrent attempts are serialised per bucket, so no more than Limit ever
// pass in a window. An error means the attempt could not be counted; the
// caller must not let it through.
func (l *Limiter) Take(ctx context.Context, hits ...Hit) (Decision, error) {
	var wait time.Duration
	err := l.transaction(ctx, func(q *store.Queries) error {
		for _, b := range l.ordered(hits) {
			row, err := q.TakeRateLimit(ctx, store.TakeRateLimitParams{Key: b.key, WindowMs: b.hit.Rule.Window.Milliseconds()})
			if err != nil {
				return fmt.Errorf("count an attempt (%s): %w", b.hit.Rule.Name, err)
			}
			if int(row.Count) > b.hit.Rule.Limit {
				wait = max(wait, row.ResetAt.Sub(row.Now))
			}
		}
		if wait > 0 {
			return errRefused // roll back: a refused attempt is not counted
		}
		return nil
	})
	switch {
	case err == errRefused:
		return Decision{RetryAfter: wait}, nil
	case err != nil:
		return Decision{}, err
	}
	return Decision{Allowed: true}, nil
}

// errRefused rolls Take's transaction back; it never leaves the package.
var errRefused = fmt.Errorf("rate limit reached")

// Refund gives an attempt back, for outcomes that are not to be counted (a
// successful sign-in). Earlier attempts stay counted.
func (l *Limiter) Refund(ctx context.Context, hits ...Hit) error {
	return l.transaction(ctx, func(q *store.Queries) error {
		for _, b := range l.ordered(hits) {
			if err := q.RefundRateLimit(ctx, b.key); err != nil {
				return fmt.Errorf("give an attempt back (%s): %w", b.hit.Rule.Name, err)
			}
		}
		return nil
	})
}

func (l *Limiter) transaction(ctx context.Context, fn func(q *store.Queries) error) error {
	return pgx.BeginTxFunc(ctx, l.pool, pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		// SET LOCAL takes no parameters; the value is a duration we format.
		if _, err := tx.Exec(ctx, fmt.Sprintf("SET LOCAL lock_timeout = '%dms'", l.lockTimeout.Milliseconds())); err != nil {
			return fmt.Errorf("set lock timeout: %w", err)
		}
		return fn(store.New(tx))
	})
}
