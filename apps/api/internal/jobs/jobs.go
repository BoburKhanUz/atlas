// Package jobs runs background work on River. River's tables live in their
// own schema (Schema), so Prisma, which owns "public" until the cutover,
// never sees them (ADR 0007). `lookly migrate river` creates them;
// `lookly worker` runs the queue.
package jobs

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
	"github.com/riverqueue/river/rivermigrate"

	"lookly/internal/accounts"
	"lookly/internal/database"
	"lookly/internal/maintenance"
)

// Schema holds River's tables.
const Schema = "river"

// CleanupInterval is how often the cleanup runs (and once at every start).
const CleanupInterval = time.Hour

// cleanupMaxAttempts bounds River's attempts at one cleanup (its default is
// 25, spread over weeks): a run that keeps failing is left to the next hour.
const cleanupMaxAttempts = 3

// Migrate creates the schema and applies River's own migrations. It returns
// the names of the migrations applied (none when already current).
func Migrate(ctx context.Context, pool *pgxpool.Pool) ([]string, error) {
	if _, err := pool.Exec(ctx, "CREATE SCHEMA IF NOT EXISTS "+Schema); err != nil {
		return nil, fmt.Errorf("create schema %s: %w", Schema, err)
	}
	migrator, err := rivermigrate.New(riverpgxv5.New(pool), &rivermigrate.Config{Schema: Schema})
	if err != nil {
		return nil, fmt.Errorf("river migrator: %w", err)
	}
	res, err := migrator.Migrate(ctx, rivermigrate.DirectionUp, nil)
	if err != nil {
		return nil, fmt.Errorf("river migrations: %w", err)
	}
	var applied []string
	for _, v := range res.Versions {
		applied = append(applied, fmt.Sprintf("%03d_%s", v.Version, v.Name))
	}
	return applied, nil
}

// CheckMigrated fails, saying what to run, when River's tables are missing
// or behind this build.
func CheckMigrated(ctx context.Context, pool *pgxpool.Pool) error {
	const fix = "run `lookly migrate river` first"
	migrator, err := rivermigrate.New(riverpgxv5.New(pool), &rivermigrate.Config{Schema: Schema})
	if err != nil {
		return fmt.Errorf("river migrator: %w", err)
	}
	res, err := migrator.Validate(ctx, nil)
	if err != nil {
		return fmt.Errorf("river's tables are missing (%s): %s", database.Describe(err), fix)
	}
	if !res.OK {
		return fmt.Errorf("river's tables are behind this build (%s): %s", strings.Join(res.Messages, "; "), fix)
	}
	return nil
}

// CleanupArgs is the hourly cleanup job.
type CleanupArgs struct{}

// Kind names the job in River's tables.
func (CleanupArgs) Kind() string { return "maintenance_cleanup" }

type cleanupWorker struct {
	river.WorkerDefaults[CleanupArgs]
	svc *maintenance.Service
	log *slog.Logger
}

// Work runs one cleanup. An error makes River retry it with backoff.
func (w *cleanupWorker) Work(ctx context.Context, job *river.Job[CleanupArgs]) error {
	report, err := w.svc.Cleanup(ctx)
	if err != nil {
		return err
	}
	w.log.Info("cleanup done", "jobId", job.ID, "removed", report)
	return nil
}

// Timeout bounds one run (River cancels it after this).
func (w *cleanupWorker) Timeout(*river.Job[CleanupArgs]) time.Duration { return 2 * time.Minute }

// Workers are the services the jobs call.
type Workers struct {
	Cleanup     *maintenance.Service
	ResetMailer *accounts.ResetMailer
	Storage     OwnerPurger
}

// NewClient returns the River client with every worker and periodic job.
func NewClient(pool *pgxpool.Pool, log *slog.Logger, w Workers) (*river.Client[pgx.Tx], error) {
	workers := river.NewWorkers()
	if err := river.AddWorkerSafely(workers, &cleanupWorker{svc: w.Cleanup, log: log}); err != nil {
		return nil, err
	}
	if err := river.AddWorkerSafely(workers, &resetMailWorker{mailer: w.ResetMailer}); err != nil {
		return nil, err
	}
	if err := river.AddWorkerSafely(workers, &purgeImagesWorker{storage: w.Storage, log: log}); err != nil {
		return nil, err
	}
	return river.NewClient(riverpgxv5.New(pool), &river.Config{
		Schema:  Schema,
		Logger:  log,
		Queues:  map[string]river.QueueConfig{river.QueueDefault: {MaxWorkers: 2}},
		Workers: workers,
		PeriodicJobs: []*river.PeriodicJob{
			river.NewPeriodicJob(
				river.PeriodicInterval(CleanupInterval),
				func() (river.JobArgs, *river.InsertOpts) {
					// Not unique on purpose: a job left "running" by a killed
					// worker must not block the next one. Two cleanups at once
					// are safe: they lock the dead families in the same order
					// and skip each other's session rows; the second finds
					// nothing to do.
					return CleanupArgs{}, &river.InsertOpts{MaxAttempts: cleanupMaxAttempts}
				},
				&river.PeriodicJobOpts{RunOnStart: true},
			),
		},
	})
}
