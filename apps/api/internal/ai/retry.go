package ai

import (
	"context"
	"errors"
	"math"
	"math/rand/v2"
	"time"
)

const (
	// maxRetries: at most one more attempt.
	maxRetries = 1
	// maxRetryWait: a 429 that asks for a longer wait fails instead.
	maxRetryWait = 3 * time.Second
	// baseDelay: the wait before the second attempt is this, plus up to as
	// much again.
	baseDelay = 400 * time.Millisecond
)

// retrier runs an attempt once, and once more when its failure is
// retryable. A provider call changes nothing of ours, so repeating one is
// safe.
type retrier struct {
	sleep  func(ctx context.Context, d time.Duration)
	random func() float64 // in [0, 1)
}

func defaultRetrier() retrier {
	return retrier{
		random: rand.Float64,
		sleep: func(ctx context.Context, d time.Duration) {
			timer := time.NewTimer(d)
			defer timer.Stop()
			select {
			case <-timer.C:
			case <-ctx.Done():
			}
		},
	}
}

// do returns how many attempts ran, and the last attempt's error.
func (r retrier) do(ctx context.Context, attempt func() error) (attempts int, err error) {
	for {
		attempts++
		err = attempt()
		if err == nil {
			return attempts, nil
		}
		var failure *Error
		if !errors.As(err, &failure) || !failure.Retryable() || attempts > maxRetries || ctx.Err() != nil {
			return attempts, err
		}
		wait := baseDelay + time.Duration(math.Floor(r.random()*float64(baseDelay/time.Millisecond)))*time.Millisecond
		if failure.Kind == RateLimited && failure.RetryAfter != nil {
			wait = *failure.RetryAfter
		}
		if wait > maxRetryWait {
			return attempts, err
		}
		r.sleep(ctx, wait)
		if ctx.Err() != nil {
			return attempts, &Error{Kind: Cancelled, Provider: failure.Provider}
		}
	}
}
