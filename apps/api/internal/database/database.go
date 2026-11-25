// Package database opens the PostgreSQL connection pool. Until the cutover
// (B7) Prisma owns the schema (ADR 0007): this service runs no migrations.
package database

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
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

// Describe is an error's text for operators, without connection details.
// The driver's connection errors name the user, the database and the host;
// for those only the reason class is returned (the server's SQLSTATE when
// it answered, e.g. 28P01 wrong password, 3D000 no such database). Errors
// of a query carry no connection details and are returned as they are.
func Describe(err error) string {
	var connect *pgconn.ConnectError
	if !errors.As(err, &connect) {
		if errors.Is(err, context.DeadlineExceeded) {
			return "timed out"
		}
		return err.Error()
	}
	var pg *pgconn.PgError
	switch {
	case errors.As(err, &pg):
		return "cannot connect (SQLSTATE " + pg.Code + ")"
	case errors.Is(err, context.DeadlineExceeded):
		return "cannot connect (timed out)"
	default:
		return "cannot connect (no answer from the server)"
	}
}
