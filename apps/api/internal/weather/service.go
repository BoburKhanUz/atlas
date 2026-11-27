package weather

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/sync/singleflight"

	"lookly/internal/platform"
	"lookly/internal/store"
)

const (
	// CacheTTL is how long a cell's weather is answered from the cache.
	CacheTTL = 30 * time.Minute
	// askBudget bounds a question to the provider with the cache write
	// after it, whoever of the waiting requests gives up meanwhile.
	askBudget = openMeteoTimeout + 5*time.Second
)

// Report is the weather of a place and whether it came from the cache.
type Report struct {
	Current
	Cached bool
}

// Service answers the weather of a place, asking the provider once a cell
// while the cell's cached weather is fresh, and once for all the requests
// that wait for the same cell in this process. (A request that looked at
// the cache just before another's answer was stored asks once more; so do
// two processes asked at once.)
type Service struct {
	pool     *pgxpool.Pool
	provider Provider
	log      *slog.Logger
	asking   singleflight.Group
}

// New returns the service over the database's cache and a provider.
func New(pool *pgxpool.Pool, provider Provider, log *slog.Logger) *Service {
	return &Service{pool: pool, provider: provider, log: log}
}

// Current is the weather at a place: the cell's cached weather while it is
// fresh, else the provider's, which is then cached. The provider gets the
// cell, never the coordinates as they came. A provider's failure is the
// error; nothing is cached of it.
func (s *Service) Current(ctx context.Context, lat, lon float64) (Report, error) {
	cell := CellOf(lat, lon)
	if current, ok, err := s.cached(ctx, cell); err != nil {
		return Report{}, err
	} else if ok {
		return Report{Current: current, Cached: true}, nil
	}
	asked := s.asking.DoChan(cell.Key(), func() (any, error) {
		// The question outlives the request that started it: others wait
		// for its answer.
		ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), askBudget)
		defer cancel()
		return s.ask(ctx, cell)
	})
	select {
	case answer := <-asked:
		if answer.Err != nil {
			return Report{}, answer.Err
		}
		return answer.Val.(Report), nil
	case <-ctx.Done():
		return Report{}, fmt.Errorf("weather: %w", ctx.Err())
	}
}

// cached reads the cell's fresh row. A row that is not a complete weather
// (the Next.js API stored zeros for what the provider left out, and a row
// can be anything) counts as no row.
func (s *Service) cached(ctx context.Context, cell Cell) (Current, bool, error) {
	data, err := store.New(s.pool).FreshWeather(ctx, cell.Key())
	if errors.Is(err, pgx.ErrNoRows) {
		return Current{}, false, nil
	}
	if err != nil {
		return Current{}, false, fmt.Errorf("weather: read the cache: %w", err)
	}
	current, err := decodeCurrent(data)
	if err != nil {
		s.log.WarnContext(ctx, "weather: a cached row is not a weather; the provider is asked", "err", err.Error())
		return Current{}, false, nil
	}
	return current, true, nil
}

// ask asks the provider and caches its answer.
func (s *Service) ask(ctx context.Context, cell Cell) (Report, error) {
	current, err := s.provider.Current(ctx, cell)
	if err != nil {
		return Report{}, fmt.Errorf("weather: %w", err)
	}
	if err := current.check(); err != nil {
		return Report{}, fmt.Errorf("weather: the provider %s: %w", s.provider.Name(), err)
	}
	data, err := json.Marshal(current)
	if err != nil {
		return Report{}, fmt.Errorf("weather: encode: %w", err)
	}
	err = store.New(s.pool).StoreWeather(ctx, store.StoreWeatherParams{
		ID: platform.NewID(), CacheKey: cell.Key(), DataJson: string(data), TtlMs: CacheTTL.Milliseconds(),
	})
	if err != nil {
		// The user has their weather; the next request asks again.
		s.log.ErrorContext(ctx, "weather: the answer could not be cached", "err", err.Error())
	}
	return Report{Current: current}, nil
}
