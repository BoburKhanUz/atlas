// Package weather answers what the weather is at a place: from the cache
// (the "WeatherCache" table, shared with the Next.js API until the cutover)
// or from the weather service, asked with the place rounded to about a
// kilometre.
package weather

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/big"
	"time"

	"lookly/internal/platform"
)

// Current is the weather at a place now. The members and their order are
// those of the Next.js API's cache rows, which both servers read.
type Current struct {
	Temperature              float64 `json:"temperature"` // °C, whole
	FeelsLike                float64 `json:"feelsLike"`   // °C, whole
	Condition                string  `json:"condition"`   // clear, partly_cloudy, cloudy, rain, thunderstorm, snow, fog
	ConditionLabel           string  `json:"conditionLabel"`
	PrecipitationProbability float64 `json:"precipitationProbability"` // %, the next six hours
	PrecipitationAmount      float64 `json:"precipitationAmount"`      // mm
	Humidity                 float64 `json:"humidity"`                 // %
	WindSpeed                float64 `json:"windSpeed"`                // km/h
	UVIndex                  float64 `json:"uvIndex"`
	Source                   string  `json:"source"`
	FetchedAt                string  `json:"fetchedAt"` // ISO 8601, UTC, milliseconds
}

// The ranges of a weather that makes sense: those the API accepts in a
// client's weather snapshot (httpapi's rules of the outfit requests), and a
// bound on the rain.
const (
	conditionMax = 40
	rainMax      = 1000
)

var errIncomplete = errors.New("a member is missing")

// check reports why the weather cannot be used.
func (c Current) check() error {
	for _, r := range []struct {
		name     string
		value    float64
		min, max float64
	}{
		{"temperature", c.Temperature, -90, 70},
		{"feelsLike", c.FeelsLike, -100, 80},
		{"precipitationProbability", c.PrecipitationProbability, 0, 100},
		{"precipitationAmount", c.PrecipitationAmount, 0, rainMax},
		{"humidity", c.Humidity, 0, 100},
		{"windSpeed", c.WindSpeed, 0, 500},
		{"uvIndex", c.UVIndex, 0, 30},
	} {
		if math.IsNaN(r.value) || r.value < r.min || r.value > r.max {
			return fmt.Errorf("%s is %v, outside %v to %v", r.name, r.value, r.min, r.max)
		}
	}
	for _, s := range []struct{ name, value string }{
		{"condition", c.Condition}, {"conditionLabel", c.ConditionLabel}, {"source", c.Source},
	} {
		if s.value == "" || len(s.value) > 4*conditionMax {
			return fmt.Errorf("%s is empty or too long", s.name)
		}
	}
	if _, err := time.Parse(time.RFC3339, c.FetchedAt); err != nil {
		return errors.New("fetchedAt is not a time")
	}
	return nil
}

// decodeCurrent reads a cache row: every member present and sensible.
func decodeCurrent(data string) (Current, error) {
	var row struct {
		Temperature              *float64 `json:"temperature"`
		FeelsLike                *float64 `json:"feelsLike"`
		Condition                *string  `json:"condition"`
		ConditionLabel           *string  `json:"conditionLabel"`
		PrecipitationProbability *float64 `json:"precipitationProbability"`
		PrecipitationAmount      *float64 `json:"precipitationAmount"`
		Humidity                 *float64 `json:"humidity"`
		WindSpeed                *float64 `json:"windSpeed"`
		UVIndex                  *float64 `json:"uvIndex"`
		Source                   *string  `json:"source"`
		FetchedAt                *string  `json:"fetchedAt"`
	}
	if err := json.Unmarshal([]byte(data), &row); err != nil {
		return Current{}, err
	}
	if row.Temperature == nil || row.FeelsLike == nil || row.Condition == nil || row.ConditionLabel == nil ||
		row.PrecipitationProbability == nil || row.PrecipitationAmount == nil || row.Humidity == nil ||
		row.WindSpeed == nil || row.UVIndex == nil || row.Source == nil || row.FetchedAt == nil {
		return Current{}, errIncomplete
	}
	c := Current{
		Temperature: *row.Temperature, FeelsLike: *row.FeelsLike, Condition: *row.Condition, ConditionLabel: *row.ConditionLabel,
		PrecipitationProbability: *row.PrecipitationProbability, PrecipitationAmount: *row.PrecipitationAmount,
		Humidity: *row.Humidity, WindSpeed: *row.WindSpeed, UVIndex: *row.UVIndex, Source: *row.Source, FetchedAt: *row.FetchedAt,
	}
	return c, c.check()
}

// Cell is a place as it may leave the server and as the cache knows it:
// both coordinates rounded to two decimals (about a kilometre), written as
// JavaScript's toFixed(2) writes them.
type Cell struct{ Lat, Lon string }

// CellOf is the cell of a place. The coordinates are finite and in range
// (the request rule's work).
func CellOf(lat, lon float64) Cell { return Cell{fixed2(lat), fixed2(lon)} }

// Key is the cell's cache key, as the Next.js API makes it.
func (c Cell) Key() string { return c.Lat + "," + c.Lon }

// fixed2 is Number.prototype.toFixed(2): the nearest hundredth of the
// number's exact value, a tie upwards in magnitude, the sign of a negative
// number kept even when it rounds to zero. (Go's formatting takes a tie to
// the even digit.) For a finite number below 1e21.
func fixed2(x float64) string {
	hundredths := new(big.Rat).SetFloat64(math.Abs(x))
	hundredths.Mul(hundredths, big.NewRat(100, 1)).Add(hundredths, big.NewRat(1, 2))
	n := new(big.Int).Quo(hundredths.Num(), hundredths.Denom()) // the floor: nothing here is negative
	digits := fmt.Sprintf("%03s", n.String())
	sign := ""
	if x < 0 {
		sign = "-"
	}
	return sign + digits[:len(digits)-2] + "." + digits[len(digits)-2:]
}

// Provider is a weather service.
type Provider interface {
	// Name is the provider's name in what it answers ("source").
	Name() string
	// Current asks for the weather at a cell.
	Current(ctx context.Context, cell Cell) (Current, error)
}

// isoTime is JavaScript's Date.prototype.toISOString.
func isoTime(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }

// Mock is the development provider: the same demo weather everywhere,
// labelled as such.
type Mock struct {
	// Now is the clock (time.Now when nil).
	Now func() time.Time
}

// MockName is the mock's source name.
const MockName = "mock"

// Name is "mock".
func (Mock) Name() string { return MockName }

// Current is the demo weather.
func (m Mock) Current(context.Context, Cell) (Current, error) {
	now := time.Now
	if m.Now != nil {
		now = m.Now
	}
	return Current{
		Temperature: 28, FeelsLike: 31, Condition: "partly_cloudy", ConditionLabel: "Qisman bulutli (demo)",
		PrecipitationProbability: 20, PrecipitationAmount: 0, Humidity: 55, WindSpeed: 12, UVIndex: 7,
		Source: MockName, FetchedAt: isoTime(now()),
	}, nil
}

// round is the rounding the Next.js provider applied.
func round(x float64) float64 { return platform.RoundHalfUp(x) }
