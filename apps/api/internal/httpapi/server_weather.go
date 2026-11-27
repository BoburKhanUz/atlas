package httpapi

import (
	"context"
	"net/http"

	"lookly/internal/apierr"
	"lookly/internal/httpapi/contract"
	"lookly/internal/weather"
)

// GetCurrentWeather: the weather at a place. The gate's query rule has
// judged the coordinates. A weather service that fails is an internal
// error, as in the Next.js API (the contract lists no other code).
func (s *Server) GetCurrentWeather(ctx context.Context, request contract.GetCurrentWeatherRequestObject) (contract.GetCurrentWeatherResponseObject, error) {
	if _, ok := identityFrom(ctx); !ok {
		return nil, apierr.New(apierr.Unauthorized)
	}
	report, err := s.s.Weather.Current(ctx, request.Params.Lat, request.Params.Lon)
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
