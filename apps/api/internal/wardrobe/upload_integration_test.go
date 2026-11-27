//go:build integration

package wardrobe_test

import (
	"context"
	"errors"
	"fmt"
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

// A transaction that fails while the rows are written is rolled back for
// certain, and leaves nothing: no row, no file, no claim on the key, and
// the attempt is given back to the day.
func TestAnUploadWhoseRowsCannotBeWrittenLeavesNothing(t *testing.T) {
	t.Parallel()
	w := newSweepWorld(t)
	w.exec(`CREATE FUNCTION refuse_images() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'the disk of the database is full'; END $$`)
	w.exec(`CREATE TRIGGER refuse_images BEFORE INSERT ON "WardrobeImage" FOR EACH ROW EXECUTE FUNCTION refuse_images()`)
	u, up := w.uploads(nil)
	_, err := u.Create(context.Background(), up)
	if err == nil || errors.Is(err, wardrobe.ErrOutcomeUnknown) || !strings.Contains(err.Error(), "the disk of the database is full") {
		t.Fatalf("err %v", err)
	}
	if w.count(itemRows) != 0 || len(w.stored()) != 0 || w.count(anyKeys) != 0 || w.count(countedToday) != 0 {
		t.Errorf("%d items, files %v, %d keys, %d counted", w.count(itemRows), w.stored(), w.count(anyKeys), w.count(countedToday))
	}
}

// A commit that did not report success may still be done (a database
// finishes a commit it has begun). The item is not there yet when it is
// looked up: nothing is taken back, so that the item, when the commit
// lands, has its files.
func TestAnUploadWhoseCommitMayStillLandKeepsItsFiles(t *testing.T) {
	t.Parallel()
	w := newSweepWorld(t)
	u, up := w.uploads(nil)
	var open pgx.Tx
	t.Cleanup(func() { // a failed check must not leave the transaction (and the pool's closing) hanging
		if open != nil {
			_ = open.Rollback(context.Background())
		}
	})
	u.SetTx(func(ctx context.Context, pool *pgxpool.Pool, options pgx.TxOptions, fn func(pgx.Tx) error) error {
		tx, err := pool.BeginTx(ctx, options)
		if err != nil {
			return err
		}
		if err := fn(tx); err != nil {
			_ = tx.Rollback(context.Background())
			return err
		}
		open = tx // the commit is on its way
		return fmt.Errorf("commit: %w", context.DeadlineExceeded)
	})
	_, err := u.Create(context.Background(), up)
	if !errors.Is(err, wardrobe.ErrOutcomeUnknown) || !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("err %v", err)
	}
	// The open transaction holds the key's row: the claim cannot be
	// released (the answer waits for that as long as the cleanup has, ten
	// seconds), and the log says what becomes of the key.
	if w.count(itemRows) != 0 || len(w.stored()) != 3 || w.count(countedToday) != 1 || w.count(anyKeys) != 1 || w.count(completedKeys) != 0 {
		t.Fatalf("before the commit lands: %d items, files %v, %d counted, %d keys (%d completed)",
			w.count(itemRows), w.stored(), w.count(countedToday), w.count(anyKeys), w.count(completedKeys))
	}
	for _, want := range []string{`"level":"ERROR"`, "may or may not exist", `"lookup":"not found"`} {
		if !strings.Contains(w.log.String(), want) {
			t.Errorf("the log lacks %q: %s", want, w.log.String())
		}
	}
	if !strings.Contains(w.log.String(), "not released; a commit still on its way completes it") {
		t.Errorf("what becomes of the key is not logged: %s", w.log.String())
	}
	if err := open.Commit(context.Background()); err != nil {
		t.Fatal(err)
	}
	open = nil
	if w.count(itemRows) != 1 || len(w.stored()) != 3 || w.count(completedKeys) != 1 {
		t.Errorf("after the commit landed: %d items, files %v, %d completed keys", w.count(itemRows), w.stored(), w.count(completedKeys))
	}
	// The retry the client makes is answered with that item.
	again, err := u.Create(context.Background(), up)
	if err != nil || !again.Replayed || len(again.Item.Images) != 1 {
		t.Errorf("the retry: %+v, %v", again, err)
	}
	// Had it not landed, the files would be the sweep's an hour later.
}

// A commit that did not report success and was lost (the database rolled
// it back): the files stay for the sweep, and the key is free, so the
// client's retry runs at once and creates the item, once.
func TestAnUploadWhoseCommitWasLostCanBeRetriedAtOnce(t *testing.T) {
	t.Parallel()
	w := newSweepWorld(t)
	u, up := w.uploads(nil)
	lost := true
	u.SetTx(func(ctx context.Context, pool *pgxpool.Pool, options pgx.TxOptions, fn func(pgx.Tx) error) error {
		if !lost {
			return pgx.BeginTxFunc(ctx, pool, options, fn)
		}
		tx, err := pool.BeginTx(ctx, options)
		if err != nil {
			return err
		}
		if err := fn(tx); err != nil {
			_ = tx.Rollback(context.Background())
			return err
		}
		if err := tx.Rollback(context.Background()); err != nil {
			return err
		}
		return fmt.Errorf("commit: %w", context.DeadlineExceeded)
	})
	if _, err := u.Create(context.Background(), up); !errors.Is(err, wardrobe.ErrOutcomeUnknown) {
		t.Fatalf("err %v", err)
	}
	if w.count(itemRows) != 0 || len(w.stored()) != 3 || w.count(countedToday) != 1 || w.count(anyKeys) != 0 {
		t.Fatalf("after the lost commit: %d items, files %v, %d counted, %d keys", w.count(itemRows), w.stored(), w.count(countedToday), w.count(anyKeys))
	}
	if strings.Contains(w.log.String(), "not released") {
		t.Errorf("the key was not released: %s", w.log.String())
	}
	lost = false
	created, err := u.Create(context.Background(), up)
	if err != nil || created.Replayed || len(created.Item.Images) != 1 {
		t.Fatalf("the retry: %+v, %v", created, err)
	}
	// One item with its three files; the first attempt's three are the
	// sweep's, and its count stays.
	if w.count(itemRows) != 1 || len(w.stored()) != 6 || w.count(completedKeys) != 1 || w.count(countedToday) != 2 {
		t.Errorf("after the retry: %d items, files %v, %d completed keys, %d counted", w.count(itemRows), w.stored(), w.count(completedKeys), w.count(countedToday))
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
		IdempotencyKey: "upload-key-0001",
	})
	if !errors.Is(err, wardrobe.ErrOutcomeUnknown) || !strings.Contains(err.Error(), "the connection broke after the commit") {
		t.Fatalf("err %v", err)
	}
	// The item is there in fact, and so are its files, its count and its
	// key, which a retry is answered from.
	if w.count(itemRows) != 1 || len(w.stored()) != 3 || w.count(countedToday) != 1 || w.count(completedKeys) != 1 {
		t.Errorf("%d items, files %v, %d counted, %d completed keys", w.count(itemRows), w.stored(), w.count(countedToday), w.count(completedKeys))
	}
	if !strings.Contains(w.log.String(), "may or may not exist") || !strings.Contains(w.log.String(), `"lookup":"closed pool"`) {
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
