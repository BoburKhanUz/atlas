package httpapi_test

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"testing"
	"time"

	"lookly/internal/apierr"
	"lookly/internal/httpapi"
	"lookly/internal/idempotency"
	"lookly/internal/imaging"
	"lookly/internal/wardrobe"
)

// Every way an upload ends has its answer; what is not a refusal stays an
// error of the server.
func TestUploadErrorsAndTheirAnswers(t *testing.T) {
	t.Parallel()
	unknown := errors.New("the disk is full")
	for name, c := range map[string]struct {
		err        error
		status     int
		code       apierr.Code
		retryAfter int
	}{
		"another format":             {imaging.ErrUnsupported, 415, apierr.UnsupportedImageFormat, 0},
		"wrong dimensions":           {imaging.ErrDimensions, 422, apierr.ImageDimensions, 0},
		"unreadable":                 {imaging.ErrInvalid, 422, apierr.InvalidImage, 0},
		"a decoder panicked":         {fmt.Errorf("process: %w", &imaging.DecoderPanic{Value: "index out of range"}), 422, apierr.InvalidImage, 0},
		"a full wardrobe":            {wardrobe.ErrWardrobeFull, 400, apierr.ValidationError, 0},
		"the day's uploads used up":  {&wardrobe.DailyLimitError{RetryAfter: 90 * time.Second}, 429, apierr.AiQuotaExceeded, 90},
		"another request's key":      {idempotency.ErrMismatch, 409, apierr.IdempotencyKeyMismatch, 0},
		"the same request running":   {&idempotency.InProgressError{RetryAfter: 5 * time.Second}, 409, apierr.IdempotencyInProgress, 5},
		"the claim taken over":       {fmt.Errorf("create: %w", idempotency.ErrClaimLost), 409, apierr.IdempotencyInProgress, 5},
		"the replayed item deleted":  {wardrobe.ErrReplayGone, 404, apierr.NotFound, 0},
		"the account deleted":        {wardrobe.ErrNoUser, 401, apierr.Unauthorized, 0},
		"no processing slot in time": {fmt.Errorf("%w: %w", imaging.ErrBusy, context.DeadlineExceeded), 503, apierr.AiUnavailable, 15},
		"out of time":                {fmt.Errorf("wait: %w", context.DeadlineExceeded), 503, apierr.AiUnavailable, 15},
		"the client left":            {fmt.Errorf("store: %w", context.Canceled), 503, apierr.AiUnavailable, 15},
	} {
		var answered *apierr.Error
		if !errors.As(httpapi.UploadError(c.err), &answered) {
			t.Errorf("%s: not answered: %v", name, httpapi.UploadError(c.err))
			continue
		}
		if answered.Status() != c.status || answered.Code != c.code || answered.RetryAfterSeconds() != c.retryAfter {
			t.Errorf("%s: %d %s, Retry-After %d", name, answered.Status(), answered.Code, answered.RetryAfterSeconds())
		}
	}
	// What is not a refusal stays the server's error: an unforeseen failure,
	// and an item that may or may not have been created.
	for _, err := range []error{
		unknown, fmt.Errorf("%w: %w", wardrobe.ErrOutcomeUnknown, unknown),
		fmt.Errorf("%w: commit: %w", wardrobe.ErrOutcomeUnknown, context.DeadlineExceeded), // not "try again, nothing happened"
	} {
		if got := httpapi.UploadError(err); got != err { //nolint:errorlint // the error itself, untouched
			t.Errorf("%v became %v", err, got)
		}
	}
	// The two limits are told in the product's words, with the numbers the
	// limits have.
	for err, want := range map[error]string{
		wardrobe.ErrWardrobeFull:    "Garderobingizda " + strconv.Itoa(wardrobe.MaxItems) + " ta kiyim bor. Yangisini qo‘shish uchun avval keraksizlarini o‘chiring.",
		&wardrobe.DailyLimitError{}: "Bugun " + strconv.Itoa(wardrobe.DailyUploads) + " ta rasm yukladingiz. Limit Toshkent vaqti bilan yarim tunda yangilanadi.",
		context.DeadlineExceeded:    "Server hozir band. Birozdan so‘ng qayta urinib ko‘ring.",
	} {
		var answered *apierr.Error
		if !errors.As(httpapi.UploadError(err), &answered) || answered.Message != want {
			t.Errorf("%v: message %q", err, answered.Message)
		}
	}
}

// Sixteen uploads at a time in all, two of one user.
func TestUploadsInFlightAreBounded(t *testing.T) {
	t.Parallel()
	var f httpapi.InFlight
	var leave []func()
	for i := range httpapi.MaxUploadsInFlight {
		l, ok := f.Enter("user-" + strconv.Itoa(i))
		if !ok {
			t.Fatalf("upload %d was turned away", i+1)
		}
		leave = append(leave, l)
	}
	if _, ok := f.Enter("one-more"); ok {
		t.Fatal("an upload over the server's limit was let in")
	}
	leave[0]()
	l, ok := f.Enter("one-more")
	if !ok {
		t.Fatal("no place after one left")
	}
	leave[0] = l
	for _, l := range leave {
		l()
	}
	if f.Users() != 0 {
		t.Fatalf("%d users still counted", f.Users())
	}

	first, _ := f.Enter("a")
	second, ok := f.Enter("a")
	if _, third := f.Enter("a"); !ok || third {
		t.Fatalf("one user: second %v, third %v", ok, third)
	}
	if other, ok := f.Enter("b"); !ok {
		t.Fatal("another user was held back")
	} else {
		other()
	}
	first()
	if again, ok := f.Enter("a"); !ok {
		t.Fatal("no place after the user's own upload left")
	} else {
		again()
	}
	second()
	if f.Users() != 0 {
		t.Fatalf("%d users still counted", f.Users())
	}
}

// Which ends of an upload are logged as a step that ran out of time: the
// storage or the database, whoever is still waiting; not the everyday
// ones, and not an unknown outcome (logged where it arises).
func TestWhichUploadsAreLoggedAsStalled(t *testing.T) {
	t.Parallel()
	for name, c := range map[string]struct {
		err  error
		want bool
	}{
		"the storage out of time":             {fmt.Errorf("storage: write: %w", context.DeadlineExceeded), true},
		"the database out of time":            {fmt.Errorf("wardrobe: create the item: %w", context.DeadlineExceeded), true},
		"no processing slot in time":          {fmt.Errorf("%w: %w", imaging.ErrBusy, context.DeadlineExceeded), false},
		"no slot when the client left":        {fmt.Errorf("%w: %w", imaging.ErrBusy, context.Canceled), false},
		"a step cut short by a client's exit": {fmt.Errorf("storage: write: %w", context.Canceled), false},
		"an unknown outcome":                  {fmt.Errorf("%w: commit: %w", wardrobe.ErrOutcomeUnknown, context.DeadlineExceeded), false},
		"a refusal":                           {imaging.ErrInvalid, false},
		"another failure":                     {errors.New("the disk is full"), false},
	} {
		if got := httpapi.UploadStalled(c.err); got != c.want {
			t.Errorf("%s: stalled %v", name, got)
		}
	}
}
