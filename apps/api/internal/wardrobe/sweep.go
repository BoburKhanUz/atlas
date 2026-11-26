package wardrobe

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"lookly/internal/storage"
	"lookly/internal/store"
)

// The sweep's limits.
const (
	// SweepMinAge is how old an unreferenced file must be to be removed: an
	// upload stores its files before its rows are committed.
	SweepMinAge = time.Hour
	// SweepMaxRemovals bounds what one run removes. Orphans are few (a
	// crashed upload, a deletion whose files could not be removed); a run
	// that finds thousands is more likely looking at the wrong database
	// than at that many orphans, and the rest waits for the next run.
	SweepMaxRemovals = 1000
	// sweepBatchOwners and sweepBatchKeys bound what is held in memory and
	// asked of the database at once.
	sweepBatchOwners = 50
	sweepBatchKeys   = 2000
	// sweepNamesLogged bounds how many unknown names one run logs.
	sweepNamesLogged = 20
)

// ErrSweepRefused: the database holds no image row at all while the storage
// holds files old enough to remove. Nothing was removed: a server pointed
// at an empty or wrong database must not empty the storage.
var ErrSweepRefused = errors.New("wardrobe: the database holds no images while the storage does; nothing was removed")

// SweepReport is what a sweep found and did.
type SweepReport struct {
	Files      int // every file seen
	Referenced int // named by an image row: kept
	Recent     int // younger than SweepMinAge: kept, whether named yet or not
	Removed    int // unreferenced and old: removed
	NotRemoved int // unreferenced and old, left: the run's limit, or a removal that failed
	Unknown    int // names we never make: reported, never removed
}

// LogValue is the report as one log group.
func (r SweepReport) LogValue() slog.Value {
	return slog.GroupValue(
		slog.Int("files", r.Files), slog.Int("referenced", r.Referenced), slog.Int("recent", r.Recent),
		slog.Int("removed", r.Removed), slog.Int("notRemoved", r.NotRemoved), slog.Int("unknown", r.Unknown),
	)
}

// Sweeper removes stored image files that no image row names: what a
// crashed upload left, and the files of a deleted item that could not be
// removed at the time.
type Sweeper struct {
	pool   *pgxpool.Pool
	images storage.Store
	log    *slog.Logger
	now    func() time.Time
}

// NewSweeper returns the sweep over the storage and the database. now is
// the clock files' ages are measured by (nil: time.Now).
func NewSweeper(pool *pgxpool.Pool, images storage.Store, log *slog.Logger, now func() time.Time) *Sweeper {
	if now == nil {
		now = time.Now
	}
	return &Sweeper{pool: pool, images: images, log: log, now: now}
}

// candidate is an old file of a name we make, by its owner.
type candidate struct{ key, owner string }

// Sweep goes through every stored file once. A file of a name we never
// make is counted and logged, never removed. A file no image row names is
// removed when it is older than SweepMinAge; whether it is named is asked
// of the database just before it is removed.
func (s *Sweeper) Sweep(ctx context.Context) (SweepReport, error) {
	var report SweepReport
	q := store.New(s.pool)
	cutoff := s.now().Add(-SweepMinAge)
	hasImages, err := q.AnyWardrobeImage(ctx)
	if err != nil {
		return report, fmt.Errorf("wardrobe: sweep: %w", err)
	}

	var batch []candidate
	owners := map[string]bool{}
	flush := func() error {
		if len(batch) == 0 {
			return nil
		}
		ids := make([]string, 0, len(owners))
		for owner := range owners {
			ids = append(ids, owner)
		}
		rows, err := q.ImageKeysOfUsers(ctx, ids)
		if err != nil {
			return fmt.Errorf("referenced files: %w", err)
		}
		referenced := make(map[string]bool, len(rows)*3)
		for _, row := range rows {
			referenced[row.StorageKey] = true
			for _, variant := range []*string{row.DisplayKey, row.ThumbnailKey} {
				if variant != nil {
					referenced[*variant] = true
				}
			}
		}
		var orphans []string
		for _, c := range batch {
			if referenced[c.key] {
				report.Referenced++
			} else {
				orphans = append(orphans, c.key)
			}
		}
		batch, owners = batch[:0], map[string]bool{}
		if len(orphans) == 0 {
			return nil
		}
		if !hasImages {
			return ErrSweepRefused
		}
		if room := SweepMaxRemovals - report.Removed; len(orphans) > room {
			report.NotRemoved += len(orphans) - room
			orphans = orphans[:room]
		}
		for _, key := range orphans {
			if err := s.images.Delete(ctx, key); err != nil {
				report.NotRemoved++
				s.log.Warn("sweep: an orphaned file could not be removed", "key", key, "err", err.Error())
				continue
			}
			report.Removed++
		}
		return nil
	}

	unknownLogged := 0
	err = s.images.List(ctx, func(o storage.Object) error {
		report.Files++
		if !storage.ValidKey(o.Key) {
			report.Unknown++
			if unknownLogged < sweepNamesLogged {
				unknownLogged++
				s.log.Warn("sweep: a stored file has a name the server never makes; it is left alone", "key", truncated(o.Key, 200))
			}
			return nil
		}
		if o.ModifiedAt.After(cutoff) {
			// Young: an upload may still be committing. Whether it is
			// referenced is not asked.
			report.Recent++
			return nil
		}
		owner := strings.SplitN(o.Key, "/", 3)[1]
		batch = append(batch, candidate{o.Key, owner})
		owners[owner] = true
		if len(owners) >= sweepBatchOwners || len(batch) >= sweepBatchKeys {
			return flush()
		}
		return nil
	})
	if err == nil {
		err = flush()
	}
	if err != nil {
		if errors.Is(err, ErrSweepRefused) {
			return report, err
		}
		return report, fmt.Errorf("wardrobe: sweep: %w", err)
	}
	return report, nil
}

func truncated(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
