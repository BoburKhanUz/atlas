// Package migrations holds the Go service's schema migrations (goose, plain
// SQL, embedded in the binary). 00001_baseline.sql equals the Prisma schema
// (ADR 0007). Until the cutover (B7) these run only against test databases:
// nothing applies them to a database the Next.js API uses.
package migrations

import (
	"context"
	"embed"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

//go:embed *.sql
var files embed.FS

// Apply runs every migration not yet applied, each in its own transaction.
func Apply(ctx context.Context, pool *pgxpool.Pool) error {
	db := stdlib.OpenDBFromPool(pool)
	defer db.Close()
	provider, err := goose.NewProvider(goose.DialectPostgres, db, files)
	if err != nil {
		return fmt.Errorf("migrations: %w", err)
	}
	if _, err := provider.Up(ctx); err != nil {
		return fmt.Errorf("migrations: %w", err)
	}
	return nil
}
