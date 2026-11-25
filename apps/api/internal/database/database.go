// Package database opens the PostgreSQL connection pool. Until the cutover
// (B7) Prisma owns the schema (ADR 0007): this service runs no migrations.
package database

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"lookly/internal/config"
)

// ConnectTimeout bounds each new connection, so a database that does not
// answer cannot hold a request (or the health check) for long.
const ConnectTimeout = 5 * time.Second

// Open returns a pool for cfg.DatabaseURL. It does not connect yet: the
// server starts while the database is down, and health reports it.
func Open(ctx context.Context, cfg config.Config) (*pgxpool.Pool, error) {
	pc, err := pgxpool.ParseConfig(cfg.DatabaseURL)
	if err != nil {
		// pgx's message can quote the connection string: never pass it on.
		return nil, errors.New("DATABASE_URL: cannot be used by the PostgreSQL driver")
	}
	pc.MaxConns = cfg.DBMaxConns
	pc.ConnConfig.ConnectTimeout = ConnectTimeout
	pc.ConnConfig.RuntimeParams["application_name"] = "lookly"
	return pgxpool.NewWithConfig(ctx, pc)
}
