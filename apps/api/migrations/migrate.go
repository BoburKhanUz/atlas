package migrations

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"slices"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/pressly/goose/v3/database"
)

// PrismaHistory is every Prisma migration, in order: the schema they make is
// 00001_baseline.sql (ADR 0007). Frozen at the cutover (B7): Prisma changes
// the schema no more.
var PrismaHistory = []string{
	"20261004000000_init",
	"20261005000000_sessions",
	"20261006000100_media_variants",
	"20261006000200_idempotency_keys",
	"20261006000300_session_families",
	"20261007000000_ai_usage",
	"20261008000000_wardrobe_analysis_metadata",
	"20261009000000_color_profile_v2",
	"20261017000000_legal_consent",
	"20261017010000_password_reset",
	"20261125000000_rate_limit_bucket",
	"20261126000000_wardrobe_child_indexes",
}

// baselineVersion is 00001_baseline.sql.
const baselineVersion = 1

// lockKey serialises migration runs on one database (pg_advisory_lock).
const lockKey = 7_105_711_201

// ErrUnknownDatabase: the database has tables but no history this server
// can continue from. Nothing was changed.
var ErrUnknownDatabase = errors.New("migrations: the database has a schema without a history this server knows")

// Outcome says what Migrate did.
type Outcome struct {
	// RecordedBaseline: the database was made by Prisma's migrations; the
	// baseline was recorded as applied, not run.
	RecordedBaseline bool
	// Applied are the versions run now, in order.
	Applied []int64
}

// Migrate brings the database to the newest schema. An empty database gets
// every migration; one Prisma made (all of PrismaHistory applied, none
// failed) gets the baseline recorded as applied and then the migrations after
// it. Anything else is refused with ErrUnknownDatabase. Runs at the same time
// on one database wait for each other.
func Migrate(ctx context.Context, pool *pgxpool.Pool) (Outcome, error) {
	var out Outcome
	// The lock is held on a connection of its own, outside the pool: runs that
	// wait for it hold no pooled connection the running one needs.
	conn, err := pgx.ConnectConfig(ctx, pool.Config().ConnConfig.Copy())
	if err != nil {
		return out, fmt.Errorf("migrations: connect: %w", err)
	}
	// Closing the connection also releases the lock.
	defer func() { _ = conn.Close(context.WithoutCancel(ctx)) }()
	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock($1)`, int64(lockKey)); err != nil {
		return out, fmt.Errorf("migrations: lock: %w", err)
	}

	var hasGoose, hasPrisma bool
	var tables int
	if err := conn.QueryRow(ctx, `SELECT to_regclass('public.goose_db_version') IS NOT NULL, to_regclass('public._prisma_migrations') IS NOT NULL,
		(SELECT count(*) FROM pg_tables WHERE schemaname = 'public')`).Scan(&hasGoose, &hasPrisma, &tables); err != nil {
		return out, fmt.Errorf("migrations: look at the database: %w", err)
	}
	db := stdlib.OpenDBFromPool(pool)
	defer db.Close()
	switch {
	case hasGoose:
	case hasPrisma:
		if err := prismaComplete(ctx, conn); err != nil {
			return out, err
		}
		if err := recordBaseline(ctx, db); err != nil {
			return out, err
		}
		out.RecordedBaseline = true
	case tables > 0:
		return out, fmt.Errorf("%w: %d tables and no migration history", ErrUnknownDatabase, tables)
	}

	provider, err := goose.NewProvider(goose.DialectPostgres, db, files)
	if err != nil {
		return out, fmt.Errorf("migrations: %w", err)
	}
	results, err := provider.Up(ctx)
	for _, r := range results {
		if r.Error == nil {
			out.Applied = append(out.Applied, r.Source.Version)
		}
	}
	if err != nil {
		return out, fmt.Errorf("migrations: %w", err)
	}
	return out, nil
}

// prismaComplete checks that Prisma applied exactly PrismaHistory, with no
// migration failed or half done.
func prismaComplete(ctx context.Context, conn *pgx.Conn) error {
	rows, err := conn.Query(ctx, `SELECT migration_name, finished_at IS NOT NULL, rolled_back_at IS NOT NULL FROM "_prisma_migrations" ORDER BY migration_name`)
	if err != nil {
		return fmt.Errorf("migrations: read Prisma's history: %w", err)
	}
	defer rows.Close()
	var applied []string
	for rows.Next() {
		var name string
		var finished, rolledBack bool
		if err := rows.Scan(&name, &finished, &rolledBack); err != nil {
			return fmt.Errorf("migrations: read Prisma's history: %w", err)
		}
		switch {
		case rolledBack:
		case !finished:
			return fmt.Errorf("%w: Prisma's migration %s did not finish", ErrUnknownDatabase, name)
		default:
			applied = append(applied, name)
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("migrations: read Prisma's history: %w", err)
	}
	if !slices.Equal(applied, PrismaHistory) {
		return fmt.Errorf("%w: Prisma applied %d migrations, the baseline is the %d of %s..%s", ErrUnknownDatabase,
			len(applied), len(PrismaHistory), PrismaHistory[0], PrismaHistory[len(PrismaHistory)-1])
	}
	return nil
}

// recordBaseline creates goose's version table with the baseline marked as
// applied, in one transaction (as goose itself creates the table).
func recordBaseline(ctx context.Context, db *sql.DB) error {
	store, err := database.NewStore(goose.DialectPostgres, goose.DefaultTablename)
	if err != nil {
		return fmt.Errorf("migrations: %w", err)
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("migrations: record the baseline: %w", err)
	}
	defer func() { _ = tx.Rollback() }() // after a commit there is nothing to roll back
	if err := store.CreateVersionTable(ctx, tx); err != nil {
		return fmt.Errorf("migrations: record the baseline: %w", err)
	}
	for _, version := range []int64{0, baselineVersion} {
		if err := store.Insert(ctx, tx, database.InsertRequest{Version: version}); err != nil {
			return fmt.Errorf("migrations: record the baseline: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("migrations: record the baseline: %w", err)
	}
	return nil
}
