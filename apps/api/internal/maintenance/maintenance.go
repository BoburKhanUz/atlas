// Package maintenance removes data nothing needs any more, on a schedule
// (the worker runs Cleanup hourly). The rules are the manual Node script's
// (docs/architecture/sessions.md "Operations"), plus expired idempotency keys
// and weather cache rows; the queries are in internal/store/queries.
package maintenance

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"lookly/internal/store"
)

// DefaultLockTimeout bounds how long a run waits for a table someone else
// holds: a busy table makes the run give up (and try again next hour)
// instead of blocking sign-ins behind it.
const DefaultLockTimeout = 5 * time.Second

// Report counts what one run removed.
type Report struct {
	SuccessorCiphertextsCleared int64
	RotatedSessionsDeleted      int64
	FamiliesDeleted             int64
	FamilySessionsDeleted       int64
	ExpiredResetLinksDeleted    int64
	ExpiredIdempotencyKeys      int64
	ExpiredWeatherRows          int64
}

// LogValue writes the counts as one log group.
func (r Report) LogValue() slog.Value {
	return slog.GroupValue(
		slog.Int64("successorCiphertextsCleared", r.SuccessorCiphertextsCleared),
		slog.Int64("rotatedSessionsDeleted", r.RotatedSessionsDeleted),
		slog.Int64("familiesDeleted", r.FamiliesDeleted),
		slog.Int64("familySessionsDeleted", r.FamilySessionsDeleted),
		slog.Int64("expiredResetLinksDeleted", r.ExpiredResetLinksDeleted),
		slog.Int64("expiredIdempotencyKeys", r.ExpiredIdempotencyKeys),
		slog.Int64("expiredWeatherRows", r.ExpiredWeatherRows),
	)
}

// Service runs the cleanup.
type Service struct {
	pool        *pgxpool.Pool
	lockTimeout time.Duration
}

// Option configures a Service.
type Option func(*Service)

// WithLockTimeout replaces DefaultLockTimeout (tests use a short one).
func WithLockTimeout(d time.Duration) Option { return func(s *Service) { s.lockTimeout = d } }

// New returns a Service over the pool.
func New(pool *pgxpool.Pool, opts ...Option) *Service {
	s := &Service{pool: pool, lockTimeout: DefaultLockTimeout}
	for _, o := range opts {
		o(s)
	}
	return s
}

// Cleanup runs every rule in one transaction: either all of it happens or,
// on any error (a lock timeout included), none of it.
func (s *Service) Cleanup(ctx context.Context) (Report, error) {
	var r Report
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		// SET LOCAL takes no parameters; the value is a duration we format.
		if _, err := tx.Exec(ctx, fmt.Sprintf("SET LOCAL lock_timeout = '%dms'", s.lockTimeout.Milliseconds())); err != nil {
			return fmt.Errorf("set lock timeout: %w", err)
		}
		q := store.New(tx)
		steps := []struct {
			name string
			run  func() error
		}{
			{"clear successor ciphertexts", func() (err error) {
				r.SuccessorCiphertextsCleared, err = q.ClearStaleSuccessorCiphertexts(ctx)
				return err
			}},
			{"delete rotated sessions", func() (err error) {
				r.RotatedSessionsDeleted, err = q.DeleteOldRotatedSessions(ctx)
				return err
			}},
			{"count sessions of dead families", func() (err error) {
				r.FamilySessionsDeleted, err = q.CountSessionsOfDeadFamilies(ctx)
				return err
			}},
			{"delete dead families", func() (err error) {
				r.FamiliesDeleted, err = q.DeleteDeadFamilies(ctx)
				return err
			}},
			{"delete expired reset links", func() (err error) {
				r.ExpiredResetLinksDeleted, err = q.DeleteExpiredResetTokens(ctx)
				return err
			}},
			{"delete expired idempotency keys", func() (err error) {
				r.ExpiredIdempotencyKeys, err = q.DeleteExpiredIdempotencyKeys(ctx)
				return err
			}},
			{"delete expired weather rows", func() (err error) {
				r.ExpiredWeatherRows, err = q.DeleteExpiredWeatherCache(ctx)
				return err
			}},
		}
		for _, step := range steps {
			if err := step.run(); err != nil {
				return fmt.Errorf("%s: %w", step.name, describe(err))
			}
		}
		return nil
	})
	if err != nil {
		return Report{}, fmt.Errorf("cleanup: %w", err)
	}
	return r, nil
}

// describe names a lock timeout plainly (SQLSTATE 55P03).
func describe(err error) error {
	var pg *pgconn.PgError
	if errors.As(err, &pg) && pg.Code == "55P03" {
		return fmt.Errorf("lock timeout (a table is busy; the next run retries): %w", err)
	}
	return err
}
