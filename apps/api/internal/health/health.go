// Package health reports whether the server can reach its database.
package health

import (
	"context"
	"fmt"
	"time"
)

// Pinger is the database's liveness check (pgxpool.Pool satisfies it).
type Pinger interface {
	Ping(ctx context.Context) error
}

// Service checks the database within a timeout, so a hung database makes
// the check fail fast instead of hanging the health probe.
type Service struct {
	db      Pinger
	version string
	timeout time.Duration
}

// New returns a Service; version is the build's version string.
func New(db Pinger, version string, timeout time.Duration) *Service {
	return &Service{db: db, version: version, timeout: timeout}
}

// Version is the running build's version.
func (s *Service) Version() string { return s.version }

// CheckDatabase returns nil when the database answers within the timeout.
func (s *Service) CheckDatabase(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()
	if err := s.db.Ping(ctx); err != nil {
		return fmt.Errorf("ping database: %w", err)
	}
	return nil
}
