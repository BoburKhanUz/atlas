package color

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"lookly/internal/ai"
	"lookly/internal/imaging"
	"lookly/internal/platform"
	"lookly/internal/quota"
	"lookly/internal/store"
)

// The colour profile's use cases, as the Next.js routes do them
// (apps/web/src/app/api/v1/color-profile): a selfie analysed and dropped,
// the result replacing the user's one profile; the current profile; its
// deletion with what the selfie gave the user profile.

// Disclaimer is shown with every colour profile.
const Disclaimer = "Bu taxminiy styling tavsiyasi — tibbiy yoki ilmiy xulosa emas. Natija yorug‘lik va kameraga bog‘liq."

// Provider names the analysis in the monitoring: no model is asked.
const Provider = "deterministic"

// ErrNoUser: the account was deleted while the selfie was analysed.
var ErrNoUser = errors.New("color: the user is gone")

// Pictures make a selfie's canvas (*imaging.Processor).
type Pictures interface {
	Canvas(ctx context.Context, data []byte) (rgb []byte, width, height int, err error)
}

// Quotas count the day's analyses (*quota.Service): the color_analysis
// quota, which the Next.js server defined and never used.
type Quotas interface {
	Charge(ctx context.Context, userID string, feature ai.Feature, provider string) (quota.Charge, error)
	Refund(ctx context.Context, charge quota.Charge, reason string)
}

// QuotaError: the day's analyses are used up; the next day begins in
// RetryAfter.
type QuotaError struct{ RetryAfter time.Duration }

func (e *QuotaError) Error() string { return "color: the day's analyses are used up" }

// CallMonitor is told about each analysis (*ai.Monitor).
type CallMonitor interface {
	RecordCall(ctx context.Context, record ai.CallRecord)
}

// Service is the colour profile.
type Service struct {
	pool     *pgxpool.Pool
	pictures Pictures
	monitor  CallMonitor
	quotas   Quotas
	log      *slog.Logger
}

// NewService returns the service.
func NewService(pool *pgxpool.Pool, pictures Pictures, monitor CallMonitor, quotas Quotas, log *slog.Logger) *Service {
	return &Service{pool: pool, pictures: pictures, monitor: monitor, quotas: quotas, log: log}
}

// Profile is a stored colour profile with what the selfie gave the user
// profile.
type Profile struct {
	ID                                         string
	Undertone, Season, SecondarySeason         *string
	UndertoneConfidence, Confidence, Secondary *float64
	ContrastLevel                              *string
	RecommendedColors, NeutralColors, Caution  []string
	SkinTone, HairColor, EyeColor              *string
	AnalyzedAt                                 time.Time
}

// Analyze analyses a selfie and makes the result the user's colour
// profile. The refusals: *QuotaError, imaging.ErrInvalid,
// imaging.ErrUnsupported, imaging.ErrDimensions, imaging.ErrBusy,
// *PhotoQualityError, ErrSkinNotVisible, ErrNoUser. Nothing is stored for
// any of them, and nothing of the picture is kept. Each analysis counts
// against the day's, whatever it finds; one that was not made (no
// processing slot) or not stored is given back.
func (s *Service) Analyze(ctx context.Context, userID string, file []byte) (profile Profile, err error) {
	charge, err := s.quotas.Charge(ctx, userID, ai.ColorAnalysis, Provider)
	if err != nil {
		return Profile{}, err
	}
	if !charge.Allowed {
		return Profile{}, &QuotaError{RetryAfter: charge.RetryAfter}
	}
	defer func() {
		switch {
		case errors.Is(err, imaging.ErrBusy):
			s.quotas.Refund(context.WithoutCancel(ctx), charge, "busy")
		case errors.Is(err, ErrNoUser):
			// The account is gone with its counts.
		case err != nil && !refusedPhoto(err):
			s.quotas.Refund(context.WithoutCancel(ctx), charge, "internal_error")
		}
	}()
	started := time.Now()
	record := func(outcome string) {
		s.monitor.RecordCall(ctx, ai.CallRecord{
			Feature: ai.ColorAnalysis, Provider: Provider, Model: Version, Outcome: outcome, Latency: time.Since(started), Attempts: 1,
		})
	}
	rgb, width, height, err := s.pictures.Canvas(ctx, file)
	if errors.Is(err, imaging.ErrBusy) {
		return Profile{}, err // nothing was analysed
	}
	if err != nil {
		record("error")
		return Profile{}, err
	}
	result, err := AnalyzeCanvas(Canvas{Width: width, Height: height, RGB: rgb})
	if err != nil {
		// A photo the analysis refuses is the user's input, not a failure
		// of the analysis.
		record("invalid_request")
		return Profile{}, err
	}
	record("ok")

	lists, err := listsOf(result)
	if err != nil {
		return Profile{}, err
	}
	analysis, err := json.Marshal(result.Analysis)
	if err != nil {
		return Profile{}, fmt.Errorf("color: the analysis: %w", err)
	}
	version, confidence, undertoneConfidence := Version, result.Confidence, result.UndertoneConfidence
	var saved store.SaveColorProfileRow
	err = pgx.BeginTxFunc(ctx, s.pool, pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		q := store.New(tx)
		var err error
		saved, err = q.SaveColorProfile(ctx, store.SaveColorProfileParams{
			ID: platform.NewID(), UserID: userID, Undertone: &result.Undertone, Season: result.Season, ContrastLevel: result.ContrastLevel,
			RecommendedColors: lists[0], NeutralColors: lists[1], CautionColors: lists[2], AnalysisJson: string(analysis),
			AnalysisVersion: &version, Confidence: &confidence, UndertoneConfidence: &undertoneConfidence,
			SecondarySeason: result.SecondarySeason, SecondaryConfidence: result.SecondaryConfidence,
		})
		if err != nil {
			return err
		}
		return q.PointProfileAtColors(ctx, store.PointProfileAtColorsParams{
			ID: platform.NewID(), UserID: userID, SkinTone: &result.SkinTone, SkinUndertone: &result.Undertone,
			HairColor: result.HairColor, EyeColor: result.EyeColor, ColorProfileID: &saved.ID,
		})
	})
	var pgErr *pgconn.PgError
	switch {
	case errors.As(err, &pgErr) && pgErr.Code == "23503":
		return Profile{}, ErrNoUser
	case err != nil:
		return Profile{}, fmt.Errorf("color: store: %w", err)
	}
	return Profile{
		ID: saved.ID, Undertone: &result.Undertone, UndertoneConfidence: &undertoneConfidence, Season: result.Season,
		SecondarySeason: result.SecondarySeason, Secondary: result.SecondaryConfidence, Confidence: &confidence,
		ContrastLevel: result.ContrastLevel, RecommendedColors: result.RecommendedColors, NeutralColors: result.NeutralColors,
		Caution: result.CautionColors, SkinTone: &result.SkinTone, HairColor: result.HairColor, EyeColor: result.EyeColor,
		AnalyzedAt: saved.CreatedAt,
	}, nil
}

func listsOf(r Result) ([3]string, error) {
	var out [3]string
	for i, list := range [][]string{r.RecommendedColors, r.NeutralColors, r.CautionColors} {
		encoded, err := json.Marshal(list)
		if err != nil {
			return out, fmt.Errorf("color: a palette: %w", err)
		}
		out[i] = string(encoded)
	}
	return out, nil
}

// stringsOf reads a stored list: its texts, or nothing when it is no list.
func stringsOf(raw string) []string {
	var values []any
	out := []string{}
	if json.Unmarshal([]byte(raw), &values) != nil {
		return out
	}
	for _, v := range values {
		if s, ok := v.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

// refusedPhoto: the analysis ran and refused the picture (it counts).
func refusedPhoto(err error) bool {
	var quality *PhotoQualityError
	return errors.As(err, &quality) || errors.Is(err, ErrSkinNotVisible) ||
		errors.Is(err, imaging.ErrInvalid) || errors.Is(err, imaging.ErrUnsupported) || errors.Is(err, imaging.ErrDimensions)
}

// Current is the user's colour profile: the one the user profile points
// at, when it is the user's; nil when there is none.
func (s *Service) Current(ctx context.Context, userID string) (*Profile, error) {
	var out *Profile
	err := pgx.BeginTxFunc(ctx, s.pool, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		q := store.New(tx)
		profile, err := q.UserProfileByUser(ctx, userID)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		c, err := q.ColorProfileOfUser(ctx, userID)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		out = &Profile{
			ID: c.ID, Undertone: c.Undertone, UndertoneConfidence: c.UndertoneConfidence, Season: c.Season,
			SecondarySeason: c.SecondarySeason, Secondary: c.SecondaryConfidence, Confidence: c.Confidence, ContrastLevel: c.ContrastLevel,
			RecommendedColors: stringsOf(c.RecommendedColors), NeutralColors: stringsOf(c.NeutralColors), Caution: stringsOf(c.CautionColors),
			SkinTone: profile.SkinTone, HairColor: profile.HairColor, EyeColor: profile.EyeColor, AnalyzedAt: c.CreatedAt,
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("color: current: %w", err)
	}
	return out, nil
}

// Delete removes the user's colour profile and what the selfie gave the
// user profile (skin tone and undertone, hair and eye colour). No selfie
// exists to delete: none is ever stored. Deleting nothing is no error.
func (s *Service) Delete(ctx context.Context, userID string) error {
	err := pgx.BeginTxFunc(ctx, s.pool, pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		q := store.New(tx)
		if err := q.DeleteColorProfileOfUser(ctx, userID); err != nil {
			return err
		}
		return q.ForgetColorsOfProfile(ctx, userID)
	})
	if err != nil {
		return fmt.Errorf("color: delete: %w", err)
	}
	return nil
}
