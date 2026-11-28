package color_test

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"image/png"
	"log/slog"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

	"lookly/internal/ai"
	"lookly/internal/color"
	"lookly/internal/imaging"
	"lookly/internal/quota"
)

// What the service does with the day's count before and around the
// analysis; the stored result is held by the HTTP tests on PostgreSQL.

type quotas struct {
	allowed bool
	fails   error
	charged int
	refunds []string
}

func (q *quotas) Charge(_ context.Context, _ string, feature ai.Feature, provider string) (quota.Charge, error) {
	if feature != ai.ColorAnalysis || provider != color.Provider {
		return quota.Charge{}, errors.New("charged for something else")
	}
	if q.fails != nil {
		return quota.Charge{}, q.fails
	}
	q.charged++
	return quota.Charge{Allowed: q.allowed, RetryAfter: 90 * time.Minute}, nil
}

func (q *quotas) Refund(_ context.Context, _ quota.Charge, reason string) {
	q.refunds = append(q.refunds, reason)
}

type pictures struct {
	err   error
	asked int
}

func (p *pictures) Canvas(context.Context, []byte) ([]byte, int, int, error) {
	p.asked++
	return nil, 0, 0, p.err
}

// picture is a PNG of the given size (the header is all the service reads
// before the analysis).
func picture(t *testing.T, w, h int) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := png.Encode(&b, image.NewNRGBA(image.Rect(0, 0, w, h))); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

type monitor struct{}

func (monitor) RecordCall(context.Context, ai.CallRecord) {}

func TestTheDaysAnalysesAreCountedBeforeThePictureIsRead(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		name       string
		quotas     quotas
		pictures   error
		want       func(error) bool
		asked      int
		refundedAs []string
	}{
		{"the day's are used up", quotas{allowed: false}, nil, func(err error) bool {
			var used *color.QuotaError
			return errors.As(err, &used) && used.RetryAfter == 90*time.Minute
		}, 0, nil},
		{"the count cannot be taken", quotas{fails: errors.New("the database is down")}, nil, func(err error) bool { return err != nil && err.Error() == "the database is down" }, 0, nil},
		{"no processing slot: given back", quotas{allowed: true}, imaging.ErrBusy, func(err error) bool { return errors.Is(err, imaging.ErrBusy) }, 1, []string{"busy"}},
		{"a picture the analysis refuses: counted", quotas{allowed: true}, imaging.ErrInvalid, func(err error) bool { return errors.Is(err, imaging.ErrInvalid) }, 1, nil},
		{"a failure of the server: given back", quotas{allowed: true}, errors.New("the decoder broke"), func(err error) bool { return err != nil }, 1, []string{"internal_error"}},
		{"the account is gone", quotas{fails: fmt.Errorf("quota: charge: %w", &pgconn.PgError{Code: "23503"})}, nil, func(err error) bool { return errors.Is(err, color.ErrNoUser) }, 0, nil},
	} {
		q, p := c.quotas, &pictures{err: c.pictures}
		s := color.NewService(nil, p, monitor{}, &q, slog.New(slog.DiscardHandler))
		_, err := s.Analyze(context.Background(), "u1", picture(t, 300, 300))
		if !c.want(err) || p.asked != c.asked || len(q.refunds) != len(c.refundedAs) {
			t.Errorf("%s: err %v, picture read %d times, refunds %v", c.name, err, p.asked, q.refunds)
			continue
		}
		for i := range c.refundedAs {
			if q.refunds[i] != c.refundedAs[i] {
				t.Errorf("%s: refunds %v", c.name, q.refunds)
			}
		}
	}
}

func TestAFileItsHeaderRefusesIsNotCounted(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		name string
		file []byte
		want error
	}{
		{"not a picture", []byte("not a picture at all"), imaging.ErrInvalid},
		{"too small", picture(t, 200, 300), imaging.ErrDimensions},
	} {
		q, p := quotas{allowed: true}, &pictures{}
		s := color.NewService(nil, p, monitor{}, &q, slog.New(slog.DiscardHandler))
		if _, err := s.Analyze(context.Background(), "u1", c.file); !errors.Is(err, c.want) || q.charged != 0 || p.asked != 0 {
			t.Errorf("%s: err %v, %d charged, picture read %d times", c.name, err, q.charged, p.asked)
		}
	}
}
