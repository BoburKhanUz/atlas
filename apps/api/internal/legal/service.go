package legal

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"lookly/internal/platform"
	"lookly/internal/store"
)

// Service answers consent questions from the database.
type Service struct{ pool *pgxpool.Pool }

// NewService returns a Service over the pool.
func NewService(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

// ConsentsRead is how many of a user's consents the check reads, the newest
// first. A consent is recorded once per version and only for the texts
// current at that moment, so the newest decide.
const ConsentsRead = 20

// ErrNoUser: the account does not exist (any more).
var ErrNoUser = errors.New("legal: no such user")

// ConsentRequired reports whether none of the user's consents covers the
// current texts: the user must accept them before using the app.
func (s *Service) ConsentRequired(ctx context.Context, userID string) (bool, error) {
	versions, err := store.New(s.pool).ConsentVersions(ctx, store.ConsentVersionsParams{UserID: userID, Limit: ConsentsRead})
	if err != nil {
		return false, fmt.Errorf("read the user's consents: %w", err)
	}
	for _, version := range versions {
		if StillValid(version) {
			return false, nil
		}
	}
	return true, nil
}

// Accept records the user's consent to version (the current one: validated
// by the caller). A repeat records nothing. The user's row is locked while
// the check and the insert run, so two requests at once record one consent.
func (s *Service) Accept(ctx context.Context, userID, version string, ageConfirmed bool) error {
	err := pgx.BeginTxFunc(ctx, s.pool, pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		q := store.New(tx)
		if _, err := q.LockUser(ctx, userID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNoUser
			}
			return err
		}
		recorded, err := q.ConsentRecorded(ctx, store.ConsentRecordedParams{UserID: userID, Version: version})
		if err != nil || recorded {
			return err
		}
		return q.CreateLegalConsent(ctx, store.CreateLegalConsentParams{
			ID: platform.NewID(), UserID: userID, Version: version, AgeConfirmed: ageConfirmed,
		})
	})
	if err != nil && !errors.Is(err, ErrNoUser) {
		return fmt.Errorf("record the consent: %w", err)
	}
	return err
}
