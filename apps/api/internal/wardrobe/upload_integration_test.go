//go:build integration

package wardrobe_test

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"lookly/internal/dbtest"
	"lookly/internal/golden"
	"lookly/internal/idempotency"
	"lookly/internal/imaging"
	"lookly/internal/ratelimit"
	"lookly/internal/wardrobe"
)

// uploads is the upload use case over the world's database and storage,
// for one user; processor nil: the real one.
func (w *sweepWorld) uploads(processor wardrobe.Processor) (*wardrobe.Uploads, wardrobe.Upload) {
	w.t.Helper()
	w.user("u_one")
	if processor == nil {
		processor = imaging.NewProcessor(1)
	}
	u := wardrobe.NewUploads(wardrobe.UploadsConfig{
		Pool: w.pool, Images: w.images, Processor: processor, Keys: idempotency.New(w.pool),
		Limiter: ratelimit.New(w.pool, []byte("wardrobe-test-secret-wardrobe-test-secret")),
		Log:     slog.New(slog.NewJSONHandler(w.log, nil)),
	})
	return u, wardrobe.Upload{
		UserID: "u_one", File: golden.TestdataFile(w.t, "vision/e2e-white-shirt.png"), FileName: "shirt.png", HintName: "shirt.png",
		Fields: map[string]string{}, IdempotencyKey: "upload-key-0001",
	}
}

func (w *sweepWorld) count(sql string) int {
	w.t.Helper()
	var n int
	if err := w.pool.QueryRow(context.Background(), sql).Scan(&n); err != nil {
		w.t.Fatalf("%s: %v", sql, err)
	}
	return n
}

const (
	itemRows      = `SELECT count(*) FROM "WardrobeItem"`
	completedKeys = `SELECT count(*) FROM "IdempotencyKey" WHERE "status" = 'completed'`
	anyKeys       = `SELECT count(*) FROM "IdempotencyKey"`
	countedToday  = `SELECT COALESCE(sum("count"), 0)::int FROM "RateLimitBucket"`
)

// A transaction that was committed and then reported as failed (its answer
// was lost) created the item: the upload succeeds, with its files.
func TestAnUploadWhoseCommitWasReportedAsFailedIsAnUpload(t *testing.T) {
	t.Parallel()
	w := newSweepWorld(t)
	u, up := w.uploads(nil)
	u.SetTx(func(ctx context.Context, pool *pgxpool.Pool, options pgx.TxOptions, fn func(pgx.Tx) error) error {
		if err := pgx.BeginTxFunc(ctx, pool, options, fn); err != nil {
			return err
		}
		return errors.New("the connection broke after the commit")
	})
	created, err := u.Create(context.Background(), up)
	if err != nil || created.Item.ID == "" || len(created.Item.Images) != 1 {
		t.Fatalf("created %+v, err %v", created.Item, err)
	}
	if w.count(itemRows) != 1 || len(w.stored()) != 3 || w.count(completedKeys) != 1 || w.count(countedToday) != 1 {
		t.Errorf("%d items, files %v, %d completed keys, %d counted", w.count(itemRows), w.stored(), w.count(completedKeys), w.count(countedToday))
	}
	if !strings.Contains(w.log.String(), "reported a failure after its commit") || !strings.Contains(w.log.String(), "the connection broke after the commit") {
		t.Errorf("not logged: %s", w.log.String())
	}
}

// A transaction that failed and was rolled back leaves nothing: no row, no
// file, no claim on the key, and the attempt is given back to the day.
func TestAnUploadWhoseTransactionFailedLeavesNothing(t *testing.T) {
	t.Parallel()
	w := newSweepWorld(t)
	u, up := w.uploads(nil)
	u.SetTx(func(ctx context.Context, pool *pgxpool.Pool, options pgx.TxOptions, fn func(pgx.Tx) error) error {
		return pgx.BeginTxFunc(ctx, pool, options, func(tx pgx.Tx) error {
			if err := fn(tx); err != nil {
				return err
			}
			return errors.New("the disk of the database is full")
		})
	})
	_, err := u.Create(context.Background(), up)
	if err == nil || errors.Is(err, wardrobe.ErrOutcomeUnknown) || !strings.Contains(err.Error(), "the disk of the database is full") {
		t.Fatalf("err %v", err)
	}
	if w.count(itemRows) != 0 || len(w.stored()) != 0 || w.count(anyKeys) != 0 || w.count(countedToday) != 0 {
		t.Errorf("%d items, files %v, %d keys, %d counted", w.count(itemRows), w.stored(), w.count(anyKeys), w.count(countedToday))
	}
}

// When the transaction failed and the database cannot say whether the item
// exists, nothing is taken back: the files stay for the sweep, which asks
// the database before it removes anything, and the failure says so.
func TestAnUploadWhoseOutcomeCannotBeToldKeepsItsFiles(t *testing.T) {
	t.Parallel()
	w := newSweepWorld(t)
	// The upload's own connections, which the failure takes away.
	own, err := pgxpool.New(context.Background(), dbtest.URL(w.pool))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(own.Close)
	w.user("u_one")
	u := wardrobe.NewUploads(wardrobe.UploadsConfig{
		Pool: own, Images: w.images, Processor: imaging.NewProcessor(1), Keys: idempotency.New(w.pool),
		Limiter: ratelimit.New(w.pool, []byte("wardrobe-test-secret-wardrobe-test-secret")),
		Log:     slog.New(slog.NewJSONHandler(w.log, nil)),
	})
	u.SetTx(func(ctx context.Context, pool *pgxpool.Pool, options pgx.TxOptions, fn func(pgx.Tx) error) error {
		if err := pgx.BeginTxFunc(ctx, pool, options, fn); err != nil {
			return err
		}
		pool.Close()
		return errors.New("the connection broke after the commit")
	})
	_, err = u.Create(context.Background(), wardrobe.Upload{
		UserID: "u_one", File: golden.TestdataFile(t, "vision/e2e-white-shirt.png"), FileName: "shirt.png", HintName: "shirt.png", Fields: map[string]string{},
	})
	if !errors.Is(err, wardrobe.ErrOutcomeUnknown) || !strings.Contains(err.Error(), "the connection broke after the commit") {
		t.Fatalf("err %v", err)
	}
	// The item is there in fact, and so are its files and its count.
	if w.count(itemRows) != 1 || len(w.stored()) != 3 || w.count(countedToday) != 1 {
		t.Errorf("%d items, files %v, %d counted", w.count(itemRows), w.stored(), w.count(countedToday))
	}
	if !strings.Contains(w.log.String(), "may or may not exist") {
		t.Errorf("not logged: %s", w.log.String())
	}
}

// panicking is a processor whose decoder fell over the picture.
type panicking struct{}

func (panicking) Process(context.Context, []byte) (imaging.Variants, error) {
	return imaging.Variants{}, &imaging.DecoderPanic{Value: "index out of range [3]", Stack: []byte("goroutine 7 [running]: image/png.decode")}
}

// A decoder's panic refuses the picture as unreadable, and is logged with
// what it was and where: nobody else would learn of it.
func TestADecodersPanicOnAnUploadIsLogged(t *testing.T) {
	t.Parallel()
	w := newSweepWorld(t)
	u, up := w.uploads(panicking{})
	_, err := u.Create(context.Background(), up)
	if !errors.Is(err, imaging.ErrInvalid) {
		t.Fatalf("err %v", err)
	}
	for _, want := range []string{`"level":"ERROR"`, "a decoder panicked on an uploaded picture", `"userId":"u_one"`, "index out of range [3]", "image/png.decode"} {
		if !strings.Contains(w.log.String(), want) {
			t.Errorf("the log lacks %q: %s", want, w.log.String())
		}
	}
	// It took a processing slot: counted; nothing else is left.
	if w.count(itemRows) != 0 || len(w.stored()) != 0 || w.count(anyKeys) != 0 || w.count(countedToday) != 1 {
		t.Errorf("%d items, files %v, %d keys, %d counted", w.count(itemRows), w.stored(), w.count(anyKeys), w.count(countedToday))
	}
	// An ordinary refusal is not logged as one.
	quiet := newSweepWorld(t)
	u, up = quiet.uploads(nil)
	up.File = golden.TestdataFile(t, "images/truncated.jpg")
	if _, err := u.Create(context.Background(), up); !errors.Is(err, imaging.ErrInvalid) || strings.Contains(quiet.log.String(), "panicked") {
		t.Errorf("an unreadable picture: err %v, log %s", err, quiet.log.String())
	}
}
