package ai

import (
	"context"
	"time"
)

// ParseRetryAfter is parseRetryAfter.
func ParseRetryAfter(value string, now time.Time) *time.Duration { return parseRetryAfter(value, now) }

// KindOfStatus is the kind errorForStatus gives a status.
func KindOfStatus(status int) Kind { return errorForStatus("p", status, "", time.Time{}).Kind }

// CheckVisionRequest is checkVisionRequest.
func CheckVisionRequest(provider string, r VisionRequest) error {
	return checkVisionRequest(provider, r)
}

// Retry runs attempt under the retry rule with a clock that does not wait:
// it returns the attempts made, the waits asked for (milliseconds) and the
// last error.
func Retry(ctx context.Context, random float64, attempt func() error) (attempts int, sleeps []float64, err error) {
	r := retrier{
		random: func() float64 { return random },
		sleep: func(_ context.Context, d time.Duration) {
			sleeps = append(sleeps, float64(d)/float64(time.Millisecond))
		},
	}
	attempts, err = r.do(ctx, attempt)
	return attempts, sleeps, err
}

// WithoutWaits makes the client's retries immediate and its clock the one
// given (a test's).
func (c *Client) WithoutWaits(now func() time.Time) *Client {
	c.retrier.sleep = func(context.Context, time.Duration) {}
	c.retrier.random = func() float64 { return 0 }
	if now != nil {
		c.now = now
	}
	return c
}

// At makes the monitor's clock the one given (a test's).
func (m *Monitor) At(now time.Time) *Monitor {
	m.now = func() time.Time { return now }
	return m
}
