package weather_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"lookly/internal/golden"
	"lookly/internal/weather"
)

var fixedNow = func() time.Time {
	return time.Date(2026, 11, 27, 7, 30, 15, 123_456_789, time.FixedZone("UZT", 5*3600))
}

const fixedNowISO = "2026-11-27T02:30:15.123Z"

// service is a stand-in for Open-Meteo that answers every question with body.
func service(t *testing.T, status int, body string) (*weather.OpenMeteo, *[]*http.Request) {
	t.Helper()
	var asked []*http.Request
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		asked = append(asked, r)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(server.Close)
	return weather.NewOpenMeteo(server.URL, fixedNow, 0), &asked
}

func number(t *testing.T, s string) float64 {
	t.Helper()
	f, err := strconv.ParseFloat(s, 64) // reads "-0" as the negative zero
	if err != nil {
		t.Fatal(err)
	}
	return f
}

func TestACellIsWrittenAsJavaScriptWritesIt(t *testing.T) {
	t.Parallel()
	for _, c := range golden.LoadWeather(t).Fixed {
		cell := weather.CellOf(number(t, c.Value), number(t, c.Value))
		if cell.Lat != c.Fixed || cell.Lon != c.Fixed || cell.Key() != c.Fixed+","+c.Fixed {
			t.Errorf("%s: got %+v (key %q), want %s", c.Value, cell, cell.Key(), c.Fixed)
		}
	}
}

func TestOpenMeteoMakesOfACompleteAnswerWhatTheNextJSProviderMade(t *testing.T) {
	t.Parallel()
	for _, c := range golden.LoadWeather(t).Answers {
		provider, _ := service(t, http.StatusOK, c.Body)
		got, err := provider.Current(context.Background(), weather.Cell{Lat: "41.31", Lon: "69.24"})
		if err != nil {
			t.Errorf("%s: %v", c.Name, err)
			continue
		}
		if got.FetchedAt != fixedNowISO {
			t.Errorf("%s: fetchedAt %q, want %q", c.Name, got.FetchedAt, fixedNowISO)
		}
		encoded, err := json.Marshal(got)
		if err != nil {
			t.Fatal(err)
		}
		var have, want map[string]any
		if err := json.Unmarshal(encoded, &have); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(c.Weather, &want); err != nil {
			t.Fatal(err)
		}
		want["fetchedAt"] = fixedNowISO
		if !reflect.DeepEqual(have, want) {
			t.Errorf("%s:\n got %s\nwant %s", c.Name, encoded, c.Weather)
		}
	}
}

// The members of a cache row are written in the order the Next.js API
// writes them: both servers read the rows.
func TestTheWeatherIsEncodedAsTheNextJSAPIEncodesIt(t *testing.T) {
	t.Parallel()
	got, err := json.Marshal(weather.Current{
		Temperature: -3, FeelsLike: -7, Condition: "snow", ConditionLabel: "Qor", PrecipitationProbability: 80,
		PrecipitationAmount: 0.3, Humidity: 91, WindSpeed: 14, UVIndex: 0.05, Source: "open-meteo", FetchedAt: fixedNowISO,
	})
	if err != nil {
		t.Fatal(err)
	}
	const want = `{"temperature":-3,"feelsLike":-7,"condition":"snow","conditionLabel":"Qor","precipitationProbability":80,` +
		`"precipitationAmount":0.3,"humidity":91,"windSpeed":14,"uvIndex":0.05,"source":"open-meteo","fetchedAt":"2026-11-27T02:30:15.123Z"}`
	if string(got) != want {
		t.Errorf("got  %s\nwant %s", got, want)
	}
}

func TestOpenMeteoIsAskedForTheCellAndNothingMore(t *testing.T) {
	t.Parallel()
	g := golden.LoadWeather(t)
	for _, c := range g.Addresses {
		provider, asked := service(t, http.StatusOK, g.Answers[0].Body)
		cell := weather.CellOf(number(t, c.Lat), number(t, c.Lon))
		if _, err := provider.Current(context.Background(), cell); err != nil {
			t.Fatal(err)
		}
		if len(*asked) != 1 {
			t.Fatalf("%d questions", len(*asked))
		}
		r := (*asked)[0]
		q := r.URL.Query()
		want := map[string]string{
			"latitude": c.Latitude, "longitude": c.Longitude, "current": c.Current, "hourly": c.Hourly, "timezone": c.Timezone,
			// Not as the Next.js provider: two days, for the six hours ahead in the evening.
			"forecast_days": "2",
		}
		if r.Method != http.MethodGet || r.URL.Path != c.Path || len(q) != len(want) {
			t.Errorf("lat=%s lon=%s: asked %s %s", c.Lat, c.Lon, r.Method, r.URL)
		}
		for name, value := range want {
			if q.Get(name) != value {
				t.Errorf("lat=%s lon=%s: %s is %q, want %q", c.Lat, c.Lon, name, q.Get(name), value)
			}
		}
		if cookie, auth := r.Header.Get("Cookie"), r.Header.Get("Authorization"); cookie != "" || auth != "" {
			t.Error("credentials were sent to the weather service")
		}
	}
	if weather.OpenMeteoURL != g.Addresses[0].Origin {
		t.Errorf("the service's origin is %q, the Next.js provider asks %q", weather.OpenMeteoURL, g.Addresses[0].Origin)
	}
}

// A real answer of the service (Tashkent, 2026-11-27 12:15 local), kept as
// it came. The chance of rain is that of 12:00 to 17:00 (16, 9, 4, 3, 4, 4:
// mean 6.67), not of the night that has passed (94, 85, ...: the Next.js
// provider answered 81).
func TestARealAnswerOfOpenMeteo(t *testing.T) {
	t.Parallel()
	body, err := os.ReadFile("../../testdata/weather/open-meteo-tashkent.json")
	if err != nil {
		t.Fatal(err)
	}
	provider, _ := service(t, http.StatusOK, string(body))
	got, err := provider.Current(context.Background(), weather.Cell{Lat: "41.31", Lon: "69.24"})
	if err != nil {
		t.Fatal(err)
	}
	want := weather.Current{
		Temperature: 9, FeelsLike: 7, Condition: "cloudy", ConditionLabel: "Bulutli", PrecipitationProbability: 7,
		PrecipitationAmount: 0, Humidity: 88, WindSpeed: 6, UVIndex: 1.85, Source: "open-meteo", FetchedAt: fixedNowISO,
	}
	if got != want {
		t.Errorf("got  %+v\nwant %+v", got, want)
	}
}

// answer is an Open-Meteo answer at the local time given, with the chance
// of rain of hour h of the first day h, and of the second day 50.
func answer(at string, change func(current, hourly map[string]any)) string {
	var hours []string
	var chance []any
	for day, date := range []string{"2026-11-27", "2026-11-28"} {
		for h := range 24 {
			hours = append(hours, fmt.Sprintf("%sT%02d:00", date, h))
			chance = append(chance, []int{h, 50}[day])
		}
	}
	current := map[string]any{
		"time": at, "interval": 900, "temperature_2m": 8.6, "relative_humidity_2m": 88, "apparent_temperature": 6.8,
		"is_day": 1, "weather_code": 3, "wind_speed_10m": 6.0, "uv_index": 1.85, "precipitation": 0.0,
	}
	hourly := map[string]any{"time": hours, "precipitation_probability": chance}
	if change != nil {
		change(current, hourly)
	}
	body, err := json.Marshal(map[string]any{"latitude": 41.3, "longitude": 69.2, "timezone": "Asia/Tashkent", "current": current, "hourly": hourly})
	if err != nil {
		panic(err)
	}
	return string(body)
}

func TestTheChanceOfRainIsThatOfTheSixHoursAhead(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		name string
		at   string
		edit func(current, hourly map[string]any)
		want float64
	}{
		{"at midnight", "2026-11-27T00:00", nil, 3},                      // 0..5: 2.5, a half goes up
		{"in the morning", "2026-11-27T09:45", nil, 12},                  // 9..14: 11.5
		{"the last full window of the day", "2026-11-27T18:59", nil, 21}, // 18..23: 20.5
		{"over midnight", "2026-11-27T22:15", nil, 41},                   // 22, 23, 50 × 4: 40.83
		{"the second day", "2026-11-28T01:00", nil, 50},
		{"fewer than six hours left in the answer", "2026-11-28T21:30", nil, 50},
		{"hours without a number are left out", "2026-11-27T10:00", func(_, hourly map[string]any) {
			chance := hourly["precipitation_probability"].([]any)
			chance[10], chance[12] = nil, nil // left: 11, 13, 14, 15: 13.25
		}, 13},
	} {
		provider, _ := service(t, http.StatusOK, answer(c.at, c.edit))
		got, err := provider.Current(context.Background(), weather.Cell{Lat: "41.31", Lon: "69.24"})
		if err != nil {
			t.Errorf("%s: %v", c.name, err)
		} else if got.PrecipitationProbability != c.want {
			t.Errorf("%s: %v, want %v", c.name, got.PrecipitationProbability, c.want)
		}
	}
}

func TestAnAnswerThatIsNoCompleteWeatherIsAnError(t *testing.T) {
	t.Parallel()
	type edit = func(current, hourly map[string]any)
	cases := map[string]string{
		"not JSON":                 `<html>`,
		"an empty body":            ``,
		"null":                     `null`,
		"an array":                 `[]`,
		"no current weather":       `{"hourly":{"time":["2026-11-27T00:00"],"precipitation_probability":[1]}}`,
		"no hourly part":           `{"current":{"time":"2026-11-27T00:15","temperature_2m":8.6,"relative_humidity_2m":88,"apparent_temperature":6.8,"weather_code":3,"wind_speed_10m":6,"uv_index":1.85,"precipitation":0}}`,
		"current is not an object": `{"current":7}`,
	}
	for _, member := range []string{"time", "temperature_2m", "relative_humidity_2m", "apparent_temperature", "weather_code", "wind_speed_10m", "uv_index", "precipitation"} {
		cases[member+" is missing"] = answer("2026-11-27T12:15", func(current, _ map[string]any) { delete(current, member) })
		cases[member+" is null"] = answer("2026-11-27T12:15", func(current, _ map[string]any) { current[member] = nil })
		cases[member+" is of another type"] = answer("2026-11-27T12:15", func(current, _ map[string]any) { current[member] = []int{1} })
	}
	for name, change := range map[string]edit{
		"a temperature as text":           func(current, _ map[string]any) { current["temperature_2m"] = "8.6" },
		"a temperature no place has":      func(current, _ map[string]any) { current["temperature_2m"] = 70.5 },
		"a cold no place has":             func(current, _ map[string]any) { current["temperature_2m"] = -90.6 },
		"a felt temperature out of range": func(current, _ map[string]any) { current["apparent_temperature"] = 80.5 },
		"a humidity over 100":             func(current, _ map[string]any) { current["relative_humidity_2m"] = 100.5 },
		"a negative humidity":             func(current, _ map[string]any) { current["relative_humidity_2m"] = -1 },
		"a wind over 500":                 func(current, _ map[string]any) { current["wind_speed_10m"] = 500.5 },
		"a negative wind":                 func(current, _ map[string]any) { current["wind_speed_10m"] = -1 },
		"a UV index over 30":              func(current, _ map[string]any) { current["uv_index"] = 30.1 },
		"a negative UV index":             func(current, _ map[string]any) { current["uv_index"] = -0.1 },
		"negative rain":                   func(current, _ map[string]any) { current["precipitation"] = -0.1 },
		"rain beyond any":                 func(current, _ map[string]any) { current["precipitation"] = 1000.5 },
		"a time too short":                func(current, _ map[string]any) { current["time"] = "2026-11-27" },
		"a time outside the hours given":  func(current, _ map[string]any) { current["time"] = "2026-11-29T00:00" },
		"no hours": func(_, hourly map[string]any) {
			hourly["time"], hourly["precipitation_probability"] = []string{}, []int{}
		},
		"hours without chances": func(_, hourly map[string]any) { delete(hourly, "precipitation_probability") },
		"chances without hours": func(_, hourly map[string]any) { delete(hourly, "time") },
		"more hours than chances": func(_, hourly map[string]any) {
			hourly["precipitation_probability"] = hourly["precipitation_probability"].([]any)[:47]
		},
		"a chance as text":  func(_, hourly map[string]any) { hourly["precipitation_probability"].([]any)[40] = "5" },
		"a chance over 100": func(_, hourly map[string]any) { hourly["precipitation_probability"].([]any)[12] = 700 },
		"a negative chance": func(_, hourly map[string]any) { hourly["precipitation_probability"].([]any)[12] = -100 },
		"no number in the hours ahead": func(_, hourly map[string]any) {
			chance := hourly["precipitation_probability"].([]any)
			for h := 12; h < 18; h++ {
				chance[h] = nil
			}
		},
	} {
		cases[name] = answer("2026-11-27T12:15", change)
	}
	for name, body := range cases {
		provider, _ := service(t, http.StatusOK, body)
		if got, err := provider.Current(context.Background(), weather.Cell{Lat: "41.31", Lon: "69.24"}); err == nil {
			t.Errorf("%s: answered %+v", name, got)
		}
	}
	// The unchanged answer is a weather: the cases above fail for their change.
	provider, _ := service(t, http.StatusOK, answer("2026-11-27T12:15", nil))
	if _, err := provider.Current(context.Background(), weather.Cell{Lat: "41.31", Lon: "69.24"}); err != nil {
		t.Fatal(err)
	}
	// The values at the edges of the ranges are weather too.
	for name, change := range map[string]edit{
		"the hottest": func(current, _ map[string]any) {
			current["temperature_2m"], current["apparent_temperature"] = 70.4, 80.4
		},
		"the coldest": func(current, _ map[string]any) {
			current["temperature_2m"], current["apparent_temperature"] = -90.5, -100.5
		},
		"the wettest": func(current, _ map[string]any) {
			current["relative_humidity_2m"], current["precipitation"] = 100.4, 1000
		},
		"the windiest": func(current, _ map[string]any) { current["wind_speed_10m"], current["uv_index"] = 500.4, 30 },
	} {
		provider, _ := service(t, http.StatusOK, answer("2026-11-27T12:15", change))
		if _, err := provider.Current(context.Background(), weather.Cell{Lat: "41.31", Lon: "69.24"}); err != nil {
			t.Errorf("%s: %v", name, err)
		}
	}
}

func TestAServiceThatDoesNotAnswerWithAWeatherIsAnError(t *testing.T) {
	t.Parallel()
	good := answer("2026-11-27T12:15", nil)
	for _, status := range []int{201, 204, 400, 404, 429, 500, 503} {
		provider, _ := service(t, status, good)
		if got, err := provider.Current(context.Background(), weather.Cell{Lat: "41.31", Lon: "69.24"}); err == nil {
			t.Errorf("status %d: answered %+v", status, got)
		}
	}

	// A redirect is not followed.
	var elsewhere atomic.Int32
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		elsewhere.Add(1)
		_, _ = w.Write([]byte(good))
	}))
	t.Cleanup(other.Close)
	redirecting := httptest.NewServer(http.RedirectHandler(other.URL+"/v1/forecast", http.StatusFound))
	t.Cleanup(redirecting.Close)
	if got, err := weather.NewOpenMeteo(redirecting.URL, fixedNow, 0).Current(context.Background(), weather.Cell{Lat: "41.31", Lon: "69.24"}); err == nil {
		t.Errorf("a redirect: answered %+v", got)
	}
	if elsewhere.Load() != 0 {
		t.Error("the redirect was followed")
	}

	// An answer longer than any real one is not read to its end.
	long := strings.Replace(good, `"latitude"`, `"padding":"`+strings.Repeat("x", 70_000)+`","latitude"`, 1)
	provider, _ := service(t, http.StatusOK, long)
	if got, err := provider.Current(context.Background(), weather.Cell{Lat: "41.31", Lon: "69.24"}); err == nil || !strings.Contains(err.Error(), "longer than") {
		t.Errorf("a long answer: answered %+v, %v", got, err)
	}
}

// The address asked holds the place: no error names it, whatever fails.
func TestNoErrorNamesThePlace(t *testing.T) {
	t.Parallel()
	cell := weather.Cell{Lat: "41.31", Lon: "69.24"}
	leaks := func(name string, err error) {
		t.Helper()
		if err == nil {
			t.Errorf("%s: no error", name)
			return
		}
		for _, part := range []string{cell.Lat, cell.Lon, "latitude", "forecast"} {
			if strings.Contains(err.Error(), part) {
				t.Errorf("%s: the error names the place or the address: %v", name, err)
			}
		}
	}

	gone := httptest.NewServer(http.NotFoundHandler())
	gone.Close()
	_, err := weather.NewOpenMeteo(gone.URL, fixedNow, 0).Current(context.Background(), cell)
	leaks("a service that is not there", err)

	release := make(chan struct{})
	slow := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { <-release }))
	t.Cleanup(slow.Close)
	t.Cleanup(func() { close(release) })
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	started := time.Now()
	_, err = weather.NewOpenMeteo(slow.URL, fixedNow, 0).Current(ctx, cell)
	leaks("a service that does not answer", err)
	if took := time.Since(started); took > 3*time.Second {
		t.Errorf("gave up after %v, the request allowed 100 ms", took)
	}

	// The provider's own time limit, when the request has none: a service
	// that never answers is given up on.
	started = time.Now()
	_, err = weather.NewOpenMeteo(slow.URL, fixedNow, 150*time.Millisecond).Current(context.Background(), cell)
	leaks("a service that never answers", err)
	if took := time.Since(started); took < 100*time.Millisecond || took > 3*time.Second {
		t.Errorf("gave up after %v, the provider's limit was 150 ms", took)
	}

	for name, body := range map[string]string{"not JSON": "<html>41.31</html>", "incomplete": `{"current":{}}`} {
		provider, _ := service(t, http.StatusOK, body)
		_, err := provider.Current(context.Background(), cell)
		leaks(name, err)
	}
	failing, _ := service(t, http.StatusServiceUnavailable, "")
	_, err = failing.Current(context.Background(), cell)
	leaks("a failing service", err)
}

func TestTheMockAnswersTheDemoWeather(t *testing.T) {
	t.Parallel()
	got, err := weather.Mock{Now: fixedNow}.Current(context.Background(), weather.Cell{Lat: "0.00", Lon: "0.00"})
	if err != nil {
		t.Fatal(err)
	}
	// apps/web/src/lib/weather/provider.ts, MockWeatherProvider.
	want := weather.Current{
		Temperature: 28, FeelsLike: 31, Condition: "partly_cloudy", ConditionLabel: "Qisman bulutli (demo)",
		PrecipitationProbability: 20, PrecipitationAmount: 0, Humidity: 55, WindSpeed: 12, UVIndex: 7, Source: "mock", FetchedAt: fixedNowISO,
	}
	if got != want || (weather.Mock{}).Name() != "mock" {
		t.Errorf("got  %+v\nwant %+v", got, want)
	}
}
