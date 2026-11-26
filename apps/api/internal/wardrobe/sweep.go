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
	// SweepMaxRemovals and SweepSmallRun bound what a run removes, unless
	// the operator sets a number: at most as many orphans as there are old
	// files with an image row, never more than SweepMaxRemovals, and
	// always up to SweepSmallRun. Orphans are few (a crashed upload, a
	// deletion whose files could not be removed); a run that finds more
	// orphans than files it knows, or more than a thousand, is more likely
	// looking at another database, or an older copy of this one: it
	// removes nothing (ErrSweepTooMany).
	SweepMaxRemovals = 1000
	SweepSmallRun    = 50
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

// ErrSweepTooMany: more old files are named by no image row than a run may
// remove. Nothing was removed.
var ErrSweepTooMany = errors.New("wardrobe: more orphaned files than a sweep may remove; nothing was removed")

// SweepReport is what a sweep found and did.
type SweepReport struct {
	Files      int // every file seen
	Referenced int // named by an image row: kept
	Recent     int // younger than SweepMinAge: kept, whether named yet or not
	Removed    int // unreferenced and old: removed
	NotRemoved int // unreferenced and old, left: a refused run, or a removal that failed
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
	max    int
}

// NewSweeper returns the sweep over the storage and the database. now is
// the clock files' ages are measured by (nil: time.Now); maxRemovals, how
// many orphans a run removes at most when the operator has said so (0: the
// sweep's own rule, see SweepMaxRemovals).
func NewSweeper(pool *pgxpool.Pool, images storage.Store, log *slog.Logger, now func() time.Time, maxRemovals int) *Sweeper {
	if now == nil {
		now = time.Now
	}
	return &Sweeper{pool: pool, images: images, log: log, now: now, max: max(maxRemovals, 0)}
}

// limit is how many orphans a run may remove, given how many old files it
// found named by an image row.
func (s *Sweeper) limit(referenced int) int {
	if s.max > 0 {
		return s.max
	}
	return min(SweepMaxRemovals, max(SweepSmallRun, referenced))
}

// candidate is an old file of a name we make, by its owner.
type candidate struct{ key, owner string }

// unreferenced gives the candidates no image row names, asking the database
// about their owners' images in batches.
func (s *Sweeper) unreferenced(ctx context.Context, q *store.Queries, candidates []candidate, each func(c candidate, referenced bool)) error {
	for len(candidates) > 0 {
		owners := map[string]bool{}
		n := 0
		for n < len(candidates) && n < sweepBatchKeys && (len(owners) < sweepBatchOwners || owners[candidates[n].owner]) {
			owners[candidates[n].owner] = true
			n++
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
		for _, c := range candidates[:n] {
			each(c, referenced[c.key])
		}
		candidates = candidates[n:]
	}
	return nil
}

// Sweep goes through every stored file once, then removes the orphans it
// found. A file of a name we never make is counted and logged, never
// removed. A file no image row names is an orphan when it is older than
// SweepMinAge. Nothing is removed when the database holds no image at all
// (ErrSweepRefused) or when there are more orphans than a run may remove
// (ErrSweepTooMany); otherwise each orphan is removed after the database
// was asked once more whether it is named. These guards catch a database
// that is plainly not this storage's; they cannot tell an older copy that
// lacks a few of its newest rows (the worker is stopped for a restore).
func (s *Sweeper) Sweep(ctx context.Context) (SweepReport, error) {
	var report SweepReport
	q := store.New(s.pool)
	cutoff := s.now().Add(-SweepMinAge)
	hasImages, err := q.AnyWardrobeImage(ctx)
	if err != nil {
		return report, fmt.Errorf("wardrobe: sweep: %w", err)
	}

	// The orphans found, as long as they are few enough to be removed;
	// beyond that they are only counted.
	var orphans []candidate
	found := 0
	var batch []candidate
	flush := func() error {
		err := s.unreferenced(ctx, q, batch, func(c candidate, referenced bool) {
			if referenced {
				report.Referenced++
			} else if found++; found <= max(s.max, SweepMaxRemovals) {
				orphans = append(orphans, c) // more than could ever be removed are only counted
			}
		})
		batch = batch[:0]
		return err
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
		batch = append(batch, candidate{o.Key, strings.SplitN(o.Key, "/", 3)[1]})
		if len(batch) >= sweepBatchKeys {
			return flush()
		}
		return nil
	})
	if err == nil {
		err = flush()
	}
	if err != nil {
		return report, fmt.Errorf("wardrobe: sweep: %w", err)
	}
	limit := s.limit(report.Referenced)
	switch {
	case found == 0:
		return report, nil
	case !hasImages:
		report.NotRemoved = found
		return report, ErrSweepRefused
	case found > limit:
		report.NotRemoved = found
		return report, fmt.Errorf("%w: %d orphans beside %d files with an image row, at most %d a run (if the database is the right one, set STORAGE_SWEEP_MAX_REMOVALS for a run)",
			ErrSweepTooMany, found, report.Referenced, limit)
	}

	// The removal, each file asked about once more: an upload may have
	// committed since it was listed.
	err = s.unreferenced(ctx, q, orphans, func(c candidate, referenced bool) {
		if referenced {
			report.Referenced++
			return
		}
		if err := s.images.Delete(ctx, c.key); err != nil {
			report.NotRemoved++
			s.log.Warn("sweep: an orphaned file could not be removed", "key", c.key, "err", err.Error())
			return
		}
		report.Removed++
	})
	if err != nil {
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
