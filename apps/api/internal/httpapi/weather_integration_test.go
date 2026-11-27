//go:build integration

package httpapi_test

import (
	"context"
	"errors"
	"net/http"
	"reflect"
	"strings"
	"sync"
	"testing"

	"lookly/internal/httpapi"
	"lookly/internal/weather"
)

// forecasts is a weather provider that answers as told.
type forecasts struct {
	mu     sync.Mutex
	asked  []weather.Cell
	answer weather.Current
	err    error
}

func (*forecasts) Name() string { return "test" }

func (f *forecasts) Current(_ context.Context, cell weather.Cell) (weather.Current, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.asked = append(f.asked, cell)
	return f.answer, f.err
}

func (f *forecasts) questions() []weather.Cell {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]weather.Cell(nil), f.asked...)
}

var drizzle = weather.Current{
	Temperature: 9, FeelsLike: 7, Condition: "rain", ConditionLabel: "Yengin yomg'ir", PrecipitationProbability: 64,
	PrecipitationAmount: 0.3, Humidity: 88, WindSpeed: 6, UVIndex: 1.85, Source: "test", FetchedAt: "2026-11-27T07:15:02.417Z",
}

const weatherPath = "/api/v1/weather/current"

func weatherCall(m mobileSession, query string) call {
	path := weatherPath
	if query != "" {
		path += "?" + query
	}
	return call{method: http.MethodGet, path: path, contract: weatherPath, mobile: true, bearer: m.accessToken}
}

func TestTheWeatherOfAPlace(t *testing.T) {
	t.Parallel()
	provider := &forecasts{answer: drizzle}
	a := newAPI(t, apiOptions{weather: provider})
	m := a.mobileRegister(nil)

	want := map[string]any{
		"temperature": 9.0, "feelsLike": 7.0, "condition": "rain", "conditionLabel": "Yengin yomg'ir", "precipitationProbability": 64.0,
		"precipitationAmount": 0.3, "humidity": 88.0, "windSpeed": 6.0, "uvIndex": 1.85, "source": "test",
		"fetchedAt": "2026-11-27T07:15:02.417Z", "cached": false,
	}
	got := a.do(weatherCall(m, "lat=41.311482&lon=69.240562"))
	if got.status != http.StatusOK || !reflect.DeepEqual(got.body, map[string]any{"weather": want}) {
		t.Fatalf("the first answer: %d %s", got.status, got.raw)
	}
	// The provider was asked for the cell, not for the place.
	if asked := provider.questions(); len(asked) != 1 || asked[0] != (weather.Cell{Lat: "41.31", Lon: "69.24"}) {
		t.Fatalf("asked %+v", asked)
	}

	// From the cache then, for another place of the cell and another user
	// too, in the web mode as well.
	want["cached"] = true
	other := a.mobileRegister(nil)
	web := a.webLogin()
	for name, c := range map[string]call{
		"the same place":   weatherCall(m, "lat=41.311482&lon=69.240562"),
		"the cell's edge":  weatherCall(m, "lon=69.2351&lat=41.3149"),
		"another user":     weatherCall(other, "lat=41.31&lon=69.24"),
		"spelled as text":  weatherCall(m, "lat=%2041.31%20&lon=6.924e1"),
		"a cookie session": {method: http.MethodGet, path: weatherPath + "?lat=41.31&lon=69.24", contract: weatherPath, cookies: map[string]string{httpapi.AccessCookie: web.at}},
	} {
		got := a.do(c)
		if got.status != http.StatusOK || !reflect.DeepEqual(got.body, map[string]any{"weather": want}) {
			t.Errorf("%s: %d %s", name, got.status, got.raw)
		}
	}
	if asked := provider.questions(); len(asked) != 1 {
		t.Fatalf("asked %d times", len(asked))
	}
}

func TestTheWeatherNeedsCoordinates(t *testing.T) {
	t.Parallel()
	provider := &forecasts{answer: drizzle}
	a := newAPI(t, apiOptions{weather: provider})
	m := a.mobileRegister(nil)
	const wrong = "lat va lon parametrlari noto‘g‘ri"
	for query, message := range map[string]string{
		"":                       wrong,
		"lat=41.31":              wrong,
		"lon=69.24":              wrong,
		"lat=&lon=":              wrong,
		"lat=north&lon=69.24":    wrong,
		"lat=41.31&lon=Infinity": wrong,
		"lat=90.01&lon=69.24":    "Juda katta: kutilgan number <=90",
		"lat=41.31&lon=-180.5":   "Juda kichik: kutilgan number >=-180",
	} {
		got := a.do(weatherCall(m, query))
		a.is(got, http.StatusBadRequest, "VALIDATION_ERROR")
		if got.text("error") != message {
			t.Errorf("%q: %q, want %q", query, got.text("error"), message)
		}
	}
	// The ends of the world are places.
	for _, query := range []string{"lat=90&lon=180", "lat=-90&lon=-180", "lat=0&lon=0"} {
		if got := a.do(weatherCall(m, query)); got.status != http.StatusOK {
			t.Errorf("%q: %d %s", query, got.status, got.raw)
		}
	}
	if asked := provider.questions(); len(asked) != 3 {
		t.Fatalf("asked %d times: a refused request reached the provider, or an accepted one did not", len(asked))
	}
}

func TestTheWeatherNeedsASessionAndConsentBeforeAnythingElse(t *testing.T) {
	t.Parallel()
	provider := &forecasts{answer: drizzle}
	a := newAPI(t, apiOptions{weather: provider})
	m := a.mobileRegister(nil)
	requests := []call{weatherCall(m, "lat=41.31&lon=69.24"), weatherCall(m, "lat=north"), weatherCall(m, "")}
	for _, c := range requests {
		anonymous := c
		anonymous.bearer = ""
		a.is(a.do(anonymous), http.StatusUnauthorized, "UNAUTHORIZED")
		forged := c
		forged.bearer = m.accessToken + "x"
		a.is(a.do(forged), http.StatusUnauthorized, "UNAUTHORIZED")
	}
	a.exec(`UPDATE "LegalConsent" SET "version" = $2 WHERE "userId" = $1`, a.userID(m.email), outdatedVersion)
	for _, c := range requests {
		a.is(a.do(c), http.StatusForbidden, "CONSENT_REQUIRED")
	}
	if asked := provider.questions(); len(asked) != 0 {
		t.Fatalf("the provider was asked %d times for requests that were refused", len(asked))
	}
}

func TestAFailingWeatherServiceIsAnInternalErrorAndNoPlaceIsLogged(t *testing.T) {
	t.Parallel()
	provider := &forecasts{err: errors.New("open-meteo: status 503")}
	a := newAPI(t, apiOptions{weather: provider})
	m := a.mobileRegister(nil)
	got := a.do(weatherCall(m, "lat=41.311482&lon=69.240562"))
	a.is(got, http.StatusInternalServerError, "INTERNAL")
	if strings.Contains(string(got.raw), "open-meteo") || strings.Contains(string(got.raw), "503") {
		t.Errorf("the answer tells the cause: %s", got.raw)
	}
	logs := a.logs()
	if !strings.Contains(logs, "open-meteo: status 503") {
		t.Errorf("the cause is not logged: %s", logs)
	}
	// Nothing was cached: the next request asks again, and is answered.
	provider.mu.Lock()
	provider.err, provider.answer = nil, drizzle
	provider.mu.Unlock()
	if again := a.do(weatherCall(m, "lat=41.311482&lon=69.240562")); again.status != http.StatusOK || again.body["weather"].(map[string]any)["cached"] != false {
		t.Fatalf("after the failure: %d %s", again.status, again.raw)
	}
	if asked := provider.questions(); len(asked) != 2 {
		t.Fatalf("asked %d times", len(asked))
	}
	// The place is in no log line, exact or rounded.
	for _, part := range []string{"41.31", "69.24", "lat=", "lon="} {
		if strings.Contains(a.logs(), part) {
			t.Errorf("the logs hold the place (%q): %s", part, a.logs())
		}
	}
}
