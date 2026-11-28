package httpapi

import (
	"context"
	"errors"
	"net/http"

	"lookly/internal/apierr"
	"lookly/internal/color"
	"lookly/internal/httpapi/contract"
	"lookly/internal/imaging"
)

// The Next.js routes' messages of the colour profile.
const (
	msgNotAnImageType   = "Faqat JPG, PNG yoki WEBP qo‘llab-quvvatlanadi"
	msgSelfieTooLarge   = "Rasm 8 MB dan oshmasligi kerak"
	msgColorNotAnalyzed = "Rang tahlilisi hali amalga oshirilmadi. Selfie yuklang."
	colorStatusAnalyzed = "analyzed"
	colorStatusNotYet   = "not_analyzed"
)

// qualityMessages say how to take a better selfie.
var qualityMessages = map[color.QualityProblem]string{
	color.TooDark:     "Rasm juda qorong‘i. Yorug‘roq joyda, yuzingizga yorug‘lik tushadigan selfi oling.",
	color.Overexposed: "Rasm juda yorug‘ (oqarib ketgan). To‘g‘ridan-to‘g‘ri quyosh yoki chiroqqa qaramasdan qayta oling.",
	color.Blurry:      "Rasm xira chiqdi. Telefonni qimirlatmasdan, aniq selfi oling.",
	color.LowDetail:   "Rasmda tahlil uchun yetarli tafsilot yo‘q. Yuzingiz aniq ko‘rinadigan selfi oling.",
	color.Background:  "Yuz va fonni ajratib bo‘lmadi. Teriga o‘xshamagan, oddiy fon oldida suratga oling.",
}

// colorProfileBody is a colour profile as the Next.js routes answer it.
type colorProfileBody struct {
	ID                  string   `json:"id"`
	Undertone           *string  `json:"undertone"`
	UndertoneConfidence *float64 `json:"undertoneConfidence"`
	Season              *string  `json:"season"`
	SecondarySeason     *string  `json:"secondarySeason"`
	SecondaryConfidence *float64 `json:"secondaryConfidence"`
	Confidence          *float64 `json:"confidence"`
	ContrastLevel       *string  `json:"contrastLevel"`
	RecommendedColors   []string `json:"recommendedColors"`
	NeutralColors       []string `json:"neutralColors"`
	CautionColors       []string `json:"cautionColors"`
	SkinTone            *string  `json:"skinTone"`
	HairColor           *string  `json:"hairColor"`
	EyeColor            *string  `json:"eyeColor"`
	AnalyzedAt          string   `json:"analyzedAt"`
}

func colorProfileBodyOf(p color.Profile) colorProfileBody {
	return colorProfileBody{
		ID: p.ID, Undertone: p.Undertone, UndertoneConfidence: p.UndertoneConfidence, Season: p.Season, SecondarySeason: p.SecondarySeason,
		SecondaryConfidence: p.Secondary, Confidence: p.Confidence, ContrastLevel: p.ContrastLevel, RecommendedColors: p.RecommendedColors,
		NeutralColors: p.NeutralColors, CautionColors: p.Caution, SkinTone: p.SkinTone, HairColor: p.HairColor, EyeColor: p.EyeColor,
		AnalyzedAt: isoMillis(p.AnalyzedAt),
	}
}

// AnalyzeColorProfile: a selfie (the form's "file") analysed in process and
// dropped; the result replaces the caller's colour profile. The gate's
// header rule has judged the length and the form's type.
func (s *Server) AnalyzeColorProfile(ctx context.Context, request contract.AnalyzeColorProfileRequestObject) (contract.AnalyzeColorProfileResponseObject, error) {
	id, ok := identityFrom(ctx)
	if !ok {
		return nil, apierr.New(apierr.Unauthorized)
	}
	// Before a byte of the body is read: a user's pictures one at a time.
	leave, ok := s.uploads.enter(id.UserID)
	if !ok {
		return nil, apierr.New(apierr.AnalysisUnavailable)
	}
	defer leave()
	form, refusal := readUploadForm(request.Body)
	if refusal != nil {
		return nil, refusal
	}
	switch {
	case form.file == nil:
		return nil, apierr.With(apierr.BadRequest, msgNoFile)
	case !isDeclaredImage(form.file.contentType):
		return nil, apierr.With(apierr.InvalidImage, msgNotAnImageType)
	case form.file.tooLarge:
		return nil, apierr.With(apierr.InvalidImage, msgSelfieTooLarge)
	}
	profile, err := s.s.Colors.Analyze(ctx, id.UserID, form.file.data)
	if err != nil {
		return nil, colorError(err)
	}
	return colorAnalyzedResponse{colorAnalyzedBody{ColorProfile: colorProfileBodyOf(profile), Disclaimer: color.Disclaimer}}, nil
}

func colorError(err error) error {
	var quality *color.PhotoQualityError
	switch {
	case errors.As(err, &quality):
		e := apierr.With(apierr.PhotoQualityTooLow, qualityMessages[quality.Reason])
		e.Details = []apierr.Detail{{Path: "reason", Message: string(quality.Reason)}}
		return e
	case errors.Is(err, color.ErrSkinNotVisible):
		return apierr.New(apierr.SkinNotVisible)
	case errors.Is(err, imaging.ErrDimensions):
		return apierr.New(apierr.ImageDimensions)
	case errors.Is(err, imaging.ErrInvalid), errors.Is(err, imaging.ErrUnsupported):
		return apierr.New(apierr.InvalidImage)
	case errors.Is(err, imaging.ErrBusy):
		// No processing slot came free in time.
		return apierr.New(apierr.AnalysisUnavailable)
	case errors.Is(err, color.ErrNoUser):
		// The account was deleted after the gate let the request in.
		return apierr.New(apierr.Unauthorized)
	}
	return err
}

type colorAnalyzedBody struct {
	ColorProfile colorProfileBody `json:"colorProfile"`
	Disclaimer   string           `json:"disclaimer"`
}

type colorAnalyzedResponse struct{ body colorAnalyzedBody }

func (r colorAnalyzedResponse) VisitAnalyzeColorProfileResponse(w http.ResponseWriter) error {
	return writeJSON(w, http.StatusOK, r.body)
}

// GetColorProfile: the caller's current colour profile, or that there is
// none yet.
func (s *Server) GetColorProfile(ctx context.Context, _ contract.GetColorProfileRequestObject) (contract.GetColorProfileResponseObject, error) {
	id, ok := identityFrom(ctx)
	if !ok {
		return nil, apierr.New(apierr.Unauthorized)
	}
	profile, err := s.s.Colors.Current(ctx, id.UserID)
	if err != nil {
		return nil, err
	}
	if profile == nil {
		return colorCurrentResponse{colorNotYetBody{ColorProfile: nil, Status: colorStatusNotYet, Message: msgColorNotAnalyzed}}, nil
	}
	return colorCurrentResponse{colorCurrentBody{ColorProfile: colorProfileBodyOf(*profile), Status: colorStatusAnalyzed, Disclaimer: color.Disclaimer}}, nil
}

type colorNotYetBody struct {
	ColorProfile *colorProfileBody `json:"colorProfile"`
	Status       string            `json:"status"`
	Message      string            `json:"message"`
}

type colorCurrentBody struct {
	ColorProfile colorProfileBody `json:"colorProfile"`
	Status       string           `json:"status"`
	Disclaimer   string           `json:"disclaimer"`
}

type colorCurrentResponse struct{ body any }

func (r colorCurrentResponse) VisitGetColorProfileResponse(w http.ResponseWriter) error {
	return writeJSON(w, http.StatusOK, r.body)
}

// DeleteColorProfile: the caller's colour profile and what the selfie gave
// the profile, gone. Idempotent.
func (s *Server) DeleteColorProfile(ctx context.Context, _ contract.DeleteColorProfileRequestObject) (contract.DeleteColorProfileResponseObject, error) {
	id, ok := identityFrom(ctx)
	if !ok {
		return nil, apierr.New(apierr.Unauthorized)
	}
	if err := s.s.Colors.Delete(ctx, id.UserID); err != nil {
		return nil, err
	}
	return contract.DeleteColorProfile200JSONResponse{Ok: true}, nil
}

// SelfieTimeout bounds a selfie's analysis request: time for a phone on a
// slow connection, as for an upload.
const SelfieTimeout = UploadTimeout
