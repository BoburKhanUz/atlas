package httpapi

import (
	"context"
	"errors"
	"net/http"

	"lookly/internal/apierr"
	"lookly/internal/httpapi/contract"
	"lookly/internal/weather"
)

// GetCurrentWeather: the weather at a place. The gate's query rule has
// judged the coordinates. A weather service that fails is an internal
// error, as in the Next.js API; a user who has asked for the weather of too
// many new places is asked to wait (RATE_LIMITED).
func (s *Server) GetCurrentWeather(ctx context.Context, request contract.GetCurrentWeatherRequestObject) (contract.GetCurrentWeatherResponseObject, error) {
	id, ok := identityFrom(ctx)
	if !ok {
		return nil, apierr.New(apierr.Unauthorized)
	}
	report, err := s.s.Weather.Current(ctx, id.UserID, request.Params.Lat, request.Params.Lon)
	var limited *weather.LimitedError
	if errors.As(err, &limited) {
		return nil, apierr.TooManyAttempts(limited.RetryAfter)
	}
	if err != nil {
		return nil, err
	}
	return weatherResponse{weatherBody{weatherWithOrigin{report.Current, report.Cached}}}, nil
}

// weatherWithOrigin is the weather as the Next.js API answers it: the
// cache row's members, then whether it came from the cache.
type weatherWithOrigin struct {
	weather.Current
	Cached bool `json:"cached"`
}

type weatherBody struct {
	Weather weatherWithOrigin `json:"weather"`
}

type weatherResponse struct{ body weatherBody }

func (r weatherResponse) VisitGetCurrentWeatherResponse(w http.ResponseWriter) error {
	return writeJSON(w, http.StatusOK, r.body)
}
