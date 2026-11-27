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
	"lookly/internal/ratelimit"
	"lookly/internal/store"
)

const (
	// CacheTTL is how long a cell's weather is answered from the cache.
	CacheTTL = 30 * time.Minute
	// DefaultAskBudget bounds a question to the provider with the cache
	// write after it, whoever of the waiting requests gives up meanwhile.
	DefaultAskBudget = openMeteoTimeout + 5*time.Second
)

// How often the provider may be asked: a cell that is not in the cache
// costs a question. A user who walks the map cannot spend the service's
// free allowance (Open-Meteo: 10 000 questions a day), nor can many users
// together.
var (
	AskPerUser = ratelimit.Rule{Name: "weather-ask:user", Limit: 30, Window: time.Hour}
	AskShared  = ratelimit.Rule{Name: "weather-ask:shared", Limit: 300, Window: time.Hour}
)

// LimitedError: the provider may not be asked again yet, for this user or
// for anyone; RetryAfter says how long.
type LimitedError struct{ RetryAfter time.Duration }

func (e *LimitedError) Error() string { return "weather: too many questions to the provider" }

// Limiter counts the questions (ratelimit.Limiter).
type Limiter interface {
	Take(ctx context.Context, hits ...ratelimit.Hit) (ratelimit.Decision, error)
}

// Report is the weather of a place and whether it came from the cache.
type Report struct {
	Current
	Cached bool
}

// Service answers the weather of a place, asking the provider once a cell
// while the cell's cached weather is fresh, and once for all the requests
// that wait for the same cell in this process. (Two processes asked at
// once each ask.)
type Service struct {
	pool      *pgxpool.Pool
	provider  Provider
	limiter   Limiter
	log       *slog.Logger
	askBudget time.Duration
	asking    singleflight.Group
}

// Option configures a Service.
type Option func(*Service)

// WithAskBudget replaces DefaultAskBudget (tests use a short one).
func WithAskBudget(d time.Duration) Option { return func(s *Service) { s.askBudget = d } }

// New returns the service over the database's cache and a provider;
// limiter counts the questions to the provider.
func New(pool *pgxpool.Pool, provider Provider, limiter Limiter, log *slog.Logger, opts ...Option) *Service {
	s := &Service{pool: pool, provider: provider, limiter: limiter, log: log, askBudget: DefaultAskBudget}
	for _, o := range opts {
		o(s)
	}
	return s
}

// Current is the weather at a place for a user: the cell's cached weather
// while it is fresh, else the provider's, which is then cached. The
// provider gets the cell, never the coordinates as they came. A question
// to the provider is counted against the user and against everyone
// (*LimitedError when there have been too many). A provider's failure is
// the error; nothing is cached of it.
func (s *Service) Current(ctx context.Context, userID string, lat, lon float64) (Report, error) {
	cell := CellOf(lat, lon)
	if current, ok, err := s.cached(ctx, cell); err != nil {
		return Report{}, err
	} else if ok {
		return Report{Current: current, Cached: true}, nil
	}
	allowed, err := s.limiter.Take(ctx, AskPerUser.For(userID), AskShared.For("everyone"))
	if err != nil {
		return Report{}, fmt.Errorf("weather: count the question: %w", err)
	}
	if !allowed.Allowed {
		return Report{}, &LimitedError{RetryAfter: allowed.RetryAfter}
	}
	asked := s.asking.DoChan(cell.Key(), func() (report any, err error) {
		// The question outlives the request that started it: others wait
		// for its answer. It runs on a goroutine of its own, where a panic
		// would end the process: it becomes this question's error.
		defer func() {
			if r := recover(); r != nil {
				report, err = nil, fmt.Errorf("weather: the question panicked: %v", r)
			}
		}()
		ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), s.askBudget)
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
	// A question that ended between this request's look at the cache and
	// its turn has stored the answer.
	if current, ok, err := s.cached(ctx, cell); err != nil {
		return Report{}, err
	} else if ok {
		return Report{Current: current, Cached: true}, nil
	}
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
