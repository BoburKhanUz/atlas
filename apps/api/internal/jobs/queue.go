package jobs

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"

	"lookly/internal/accounts"
)

// resetMailMaxAttempts bounds the attempts at one reset mail: River's
// backoff puts the fourth about two minutes after the first, well inside
// the time a request stays worth answering (accounts.ResetRequestMaxAge).
const resetMailMaxAttempts = 4

// ResetMailArgs is the job that makes a password reset link and e-mails
// it. It carries the user's id, never an address: an address without an
// account is queued with no id, and that job does nothing.
type ResetMailArgs struct {
	UserID string `json:"userId"`
}

// Kind names the job in River's tables.
func (ResetMailArgs) Kind() string { return "password_reset_mail" }

// InsertOpts are the job's own defaults.
func (ResetMailArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{MaxAttempts: resetMailMaxAttempts}
}

type resetMailWorker struct {
	river.WorkerDefaults[ResetMailArgs]
	mailer *accounts.ResetMailer
}

// Work makes and sends one link. An error makes River retry it with backoff.
func (w *resetMailWorker) Work(ctx context.Context, job *river.Job[ResetMailArgs]) error {
	return w.mailer.Send(ctx, job.Args.UserID, job.CreatedAt)
}

// Timeout bounds one attempt (River cancels it after this).
func (w *resetMailWorker) Timeout(*river.Job[ResetMailArgs]) time.Duration { return time.Minute }

// Queue puts jobs into the queue. The API server uses it: it works no jobs
// itself (`lookly worker` does).
type Queue struct {
	client *river.Client[pgx.Tx]
}

// NewQueue returns a Queue over the pool. River's tables must exist
// (`lookly migrate river`) by the time a job is queued.
func NewQueue(pool *pgxpool.Pool, log *slog.Logger) (*Queue, error) {
	client, err := river.NewClient(riverpgxv5.New(pool), &river.Config{Schema: Schema, Logger: log})
	if err != nil {
		return nil, err
	}
	return &Queue{client: client}, nil
}

// ResetMail queues the making and sending of a reset link for the user
// ("" for nobody).
func (q *Queue) ResetMail(ctx context.Context, userID string) error {
	_, err := q.client.Insert(ctx, ResetMailArgs{UserID: userID}, nil)
	return explain(err)
}

// explain says what to run when a job could not be queued because River's
// tables are not there: the server starts without them (and without the
// database), so this is where the operator learns of it.
func explain(err error) error {
	var pg *pgconn.PgError
	if errors.As(err, &pg) && (pg.Code == "42P01" || pg.Code == "3F000") { // undefined table, undefined schema
		return fmt.Errorf("river's tables are missing: run `lookly migrate river` first: %w", err)
	}
	return err
}
