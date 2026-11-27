package weather

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"time"
)

// Open-Meteo: https://open-meteo.com/en/docs.
const (
	// OpenMeteoName is the provider's source name.
	OpenMeteoName = "open-meteo"
	// OpenMeteoURL is the service's origin.
	OpenMeteoURL = "https://api.open-meteo.com"
	// openMeteoTimeout bounds one question, as in the Next.js provider.
	openMeteoTimeout = 5 * time.Second
	// openMeteoAnswerMax bounds what is read of an answer (a real one is
	// under 2 KiB).
	openMeteoAnswerMax = 64 << 10
	// rainWindow is how many hours ahead the chance of rain looks.
	rainWindow = 6
	// The question, but for the place. Two days, so that the six hours
	// ahead exist late in the evening too.
	openMeteoQuery = "&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m,uv_index,precipitation" +
		"&hourly=precipitation_probability&forecast_days=2&timezone=auto"
)

// condition is one of our weather conditions with its Uzbek label.
type condition struct{ id, label string }

// conditions maps the WMO weather codes Open-Meteo answers with; the texts
// are the Next.js provider's, byte for byte (golden vectors). A code that
// is not here is "cloudy".
var conditions = map[float64]condition{
	0:  {"clear", "Ochiq osmon"},
	1:  {"partly_cloudy", "Qisman bulutli"},
	2:  {"partly_cloudy", "Qisman bulutli"},
	3:  {"cloudy", "Bulutli"},
	45: {"fog", "Tuman"},
	48: {"fog", "Tuman"},
	51: {"rain", "Yengin yomg'ir"},
	53: {"rain", "Yomg'ir"},
	55: {"rain", "Yomg'ir"},
	56: {"rain", "Yomg'ir (muz) "},
	57: {"rain", "Yomg'ir (muz)"},
	61: {"rain", "Yengin yomg'ir"},
	63: {"rain", "Yomg'ir"},
	65: {"rain", "Kuchli yomg'ir"},
	66: {"rain", "Yomg'ir (muz)"},
	67: {"rain", "Kuchli yomg'ir (muz)"},
	71: {"snow", "Yengin qor"},
	73: {"snow", "Qor"},
	75: {"snow", "Kuchli qor"},
	77: {"snow", "Donador qor"},
	80: {"rain", "Yomg'ir yog'inlari"},
	81: {"rain", "Yomg'ir"},
	82: {"rain", "Kuchli yomg'ir"},
	85: {"snow", "Qor yog'inlari"},
	86: {"snow", "Kuchli qor yog'inlari"},
	95: {"thunderstorm", "Momaqaldiroq"},
	96: {"thunderstorm", "Momaqaldiroq (do'l) "},
	99: {"thunderstorm", "Kuchli momaqaldiroq"},
}

var unknownCondition = condition{"cloudy", "Bulutli"}

// OpenMeteo asks the Open-Meteo forecast service.
type OpenMeteo struct {
	origin string
	client *http.Client
	now    func() time.Time
}

// NewOpenMeteo returns the provider. origin is the service's origin
// (OpenMeteoURL; a test's stand-in), now the clock (nil: time.Now),
// timeout how long one question may take (0: five seconds, as in the
// Next.js provider).
func NewOpenMeteo(origin string, now func() time.Time, timeout time.Duration) *OpenMeteo {
	if now == nil {
		now = time.Now
	}
	if timeout <= 0 {
		timeout = openMeteoTimeout
	}
	return &OpenMeteo{
		origin: origin,
		now:    now,
		client: &http.Client{
			Timeout: timeout,
			// The service answers where it is asked; an answer that sends
			// us elsewhere is a failure, not a place to go.
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
	}
}

// Name is "open-meteo".
func (*OpenMeteo) Name() string { return OpenMeteoName }

// openMeteoAnswer is what we read of an answer. A member that is absent,
// null or of another type leaves its pointer nil or fails the decoding.
type openMeteoAnswer struct {
	Current *struct {
		Time                *string  `json:"time"` // the place's own time, "2026-11-27T12:15"
		Temperature         *float64 `json:"temperature_2m"`
		Humidity            *float64 `json:"relative_humidity_2m"`
		ApparentTemperature *float64 `json:"apparent_temperature"`
		WeatherCode         *float64 `json:"weather_code"`
		WindSpeed           *float64 `json:"wind_speed_10m"`
		UVIndex             *float64 `json:"uv_index"`
		Precipitation       *float64 `json:"precipitation"`
	} `json:"current"`
	Hourly *openMeteoHours `json:"hourly"`
}

// openMeteoHours is the hourly part of an answer: the hours, in the
// place's own time, and the chance of rain of each.
type openMeteoHours struct {
	Time        []string   `json:"time"` // "2026-11-27T12:00", ...
	Probability []*float64 `json:"precipitation_probability"`
}

// Current asks the service. An answer that is not a complete, sensible
// weather is an error: nothing is made up for what is missing.
func (o *OpenMeteo) Current(ctx context.Context, cell Cell) (Current, error) {
	address := o.origin + "/v1/forecast?latitude=" + url.QueryEscape(cell.Lat) + "&longitude=" + url.QueryEscape(cell.Lon) + openMeteoQuery
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	if err != nil {
		return Current{}, errors.New("open-meteo: the request could not be made")
	}
	response, err := o.client.Do(request)
	if err != nil {
		return Current{}, fmt.Errorf("open-meteo: %w", withoutAddress(err))
	}
	defer func() { _ = response.Body.Close() }() // nothing to do about a failed close of a body that was read
	if response.StatusCode != http.StatusOK {
		return Current{}, fmt.Errorf("open-meteo: status %d", response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, openMeteoAnswerMax+1))
	if err != nil {
		return Current{}, fmt.Errorf("open-meteo: reading the answer: %w", withoutAddress(err))
	}
	if len(body) > openMeteoAnswerMax {
		return Current{}, fmt.Errorf("open-meteo: the answer is longer than %d bytes", openMeteoAnswerMax)
	}
	current, err := readOpenMeteo(body)
	if err != nil {
		return Current{}, fmt.Errorf("open-meteo: %w", err)
	}
	current.FetchedAt = isoTime(o.now())
	if err := current.check(); err != nil {
		return Current{}, fmt.Errorf("open-meteo: %w", err)
	}
	return current, nil
}

// withoutAddress is the error without the address asked: the address holds
// the place, which is not for the logs.
func withoutAddress(err error) error {
	var asked *url.Error
	if errors.As(err, &asked) {
		return asked.Err
	}
	return err
}

// readOpenMeteo makes the weather of an answer (without its time).
func readOpenMeteo(body []byte) (Current, error) {
	var answer openMeteoAnswer
	if err := json.Unmarshal(body, &answer); err != nil {
		return Current{}, fmt.Errorf("the answer is not the JSON expected: %w", err)
	}
	now := answer.Current
	if now == nil || now.Time == nil || now.Temperature == nil || now.Humidity == nil || now.ApparentTemperature == nil ||
		now.WeatherCode == nil || now.WindSpeed == nil || now.UVIndex == nil || now.Precipitation == nil {
		return Current{}, fmt.Errorf("the current weather: %w", errIncomplete)
	}
	chance, err := chanceOfRain(*now.Time, answer.Hourly)
	if err != nil {
		return Current{}, err
	}
	sky, known := conditions[*now.WeatherCode]
	if !known {
		sky = unknownCondition
	}
	return Current{
		Temperature:              round(*now.Temperature),
		FeelsLike:                round(*now.ApparentTemperature),
		Condition:                sky.id,
		ConditionLabel:           sky.label,
		PrecipitationProbability: chance,
		PrecipitationAmount:      *now.Precipitation,
		Humidity:                 round(*now.Humidity),
		WindSpeed:                round(*now.WindSpeed),
		UVIndex:                  *now.UVIndex,
		Source:                   OpenMeteoName,
	}, nil
}

// chanceOfRain is the mean chance of the six hours from the hour of the
// answer, rounded; hours without a number are left out.
func chanceOfRain(at string, hourly *openMeteoHours) (float64, error) {
	const hour = len("2026-11-27T12")
	if hourly == nil || len(hourly.Time) == 0 || len(hourly.Time) != len(hourly.Probability) || len(at) < hour {
		return 0, fmt.Errorf("the hourly chance of rain: %w", errIncomplete)
	}
	first := slices.Index(hourly.Time, at[:hour]+":00")
	if first < 0 {
		return 0, errors.New("the hourly chance of rain does not hold the hour of the answer")
	}
	sum, n := 0.0, 0
	for _, p := range hourly.Probability[first:min(first+rainWindow, len(hourly.Probability))] {
		if p != nil {
			sum += *p
			n++
		}
	}
	if n == 0 {
		return 0, fmt.Errorf("the chance of rain of the next hours: %w", errIncomplete)
	}
	return round(sum / float64(n)), nil
}
