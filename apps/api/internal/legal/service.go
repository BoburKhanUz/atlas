package legal

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"lookly/internal/store"
)

// Service answers consent questions from the database.
type Service struct{ pool *pgxpool.Pool }

// NewService returns a Service over the pool.
func NewService(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

// ConsentRequired reports whether none of the user's consents covers the
// current texts: the user must accept them before using the app.
func (s *Service) ConsentRequired(ctx context.Context, userID string) (bool, error) {
	versions, err := store.New(s.pool).ConsentVersions(ctx, userID)
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
