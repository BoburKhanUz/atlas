//go:build integration

package weather_test

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"lookly/internal/dbtest"
	"lookly/internal/weather"
	"lookly/migrations"
)

// fakeProvider answers as told and remembers what it was asked.
type fakeProvider struct {
	mu      sync.Mutex
	asked   []weather.Cell
	answer  weather.Current
	err     error
	arrived chan struct{} // receives when a question arrives, when not nil
	release chan struct{} // a question waits for it, when not nil
}

func (*fakeProvider) Name() string { return "fake" }

func (p *fakeProvider) Current(_ context.Context, cell weather.Cell) (weather.Current, error) {
	p.mu.Lock()
	p.asked = append(p.asked, cell)
	answer, err, arrived, release := p.answer, p.err, p.arrived, p.release
	p.mu.Unlock()
	if arrived != nil {
		arrived <- struct{}{}
	}
	if release != nil {
		<-release
	}
	return answer, err
}

func (p *fakeProvider) questions() []weather.Cell {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]weather.Cell(nil), p.asked...)
}

func (p *fakeProvider) set(change func(p *fakeProvider)) {
	p.mu.Lock()
	defer p.mu.Unlock()
	change(p)
}

type syncBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *syncBuffer) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.Write(p)
}

func (s *syncBuffer) String() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.String()
}

type world struct {
	t        *testing.T
	pool     *pgxpool.Pool
	provider *fakeProvider
	service  *weather.Service
	logs     *syncBuffer
	t0       time.Time
}

var sunny = weather.Current{
	Temperature: 24, FeelsLike: 26, Condition: "clear", ConditionLabel: "Ochiq osmon", PrecipitationProbability: 5,
	PrecipitationAmount: 0, Humidity: 40, WindSpeed: 9, UVIndex: 6.5, Source: "fake", FetchedAt: "2026-11-27T04:00:00.000Z",
}

func newWorld(t *testing.T) *world {
	t.Helper()
	pool := dbtest.Empty(t)
	if err := migrations.Apply(context.Background(), pool); err != nil {
		t.Fatal(err)
	}
	dbtest.InstallTestClock(t, pool)
	w := &world{t: t, pool: pool, provider: &fakeProvider{answer: sunny}, logs: &syncBuffer{}, t0: time.Date(2026, 11, 27, 4, 0, 0, 0, time.UTC)}
	w.clock(0)
	w.service = weather.New(pool, w.provider, slog.New(slog.NewJSONHandler(w.logs, nil)))
	return w
}

func (w *world) clock(d time.Duration) { dbtest.SetClock(w.t, w.pool, w.t0.Add(d)) }

func (w *world) current(lat, lon float64) weather.Report {
	w.t.Helper()
	report, err := w.service.Current(context.Background(), lat, lon)
	if err != nil {
		w.t.Fatalf("current: %v", err)
	}
	return report
}

type row struct {
	key, data          string
	fetchedAt, expires time.Time
}

func (w *world) rows() []row {
	w.t.Helper()
	found, err := w.pool.Query(context.Background(), `SELECT "cacheKey", "dataJson", "fetchedAt", "expiresAt" FROM "WeatherCache" ORDER BY "cacheKey"`)
	if err != nil {
		w.t.Fatal(err)
	}
	defer found.Close()
	var rows []row
	for found.Next() {
		var r row
		if err := found.Scan(&r.key, &r.data, &r.fetchedAt, &r.expires); err != nil {
			w.t.Fatal(err)
		}
		rows = append(rows, r)
	}
	if err := found.Err(); err != nil {
		w.t.Fatal(err)
	}
	return rows
}

func (w *world) insert(key, data string, expires time.Duration) {
	w.t.Helper()
	_, err := w.pool.Exec(context.Background(),
		`INSERT INTO "WeatherCache" (id, "cacheKey", "dataJson", "fetchedAt", "expiresAt") VALUES ($1, $2, $3, $4, $5)`,
		"c"+strings.Repeat("x", 24-len(key))+strings.NewReplacer(",", "x", ".", "x", "-", "x").Replace(key), key, data, w.t0, w.t0.Add(expires))
	if err != nil {
		w.t.Fatal(err)
	}
}

const sunnyRow = `{"temperature":24,"feelsLike":26,"condition":"clear","conditionLabel":"Ochiq osmon","precipitationProbability":5,` +
	`"precipitationAmount":0,"humidity":40,"windSpeed":9,"uvIndex":6.5,"source":"fake","fetchedAt":"2026-11-27T04:00:00.000Z"}`

func TestTheProviderIsAskedOnceACellWhileItsWeatherIsFresh(t *testing.T) {
	t.Parallel()
	w := newWorld(t)

	first := w.current(41.311482, 69.240562)
	if first.Cached || first.Current != sunny {
		t.Fatalf("the first answer: %+v", first)
	}
	// The provider got the cell, not the coordinates.
	if asked := w.provider.questions(); len(asked) != 1 || asked[0] != (weather.Cell{Lat: "41.31", Lon: "69.24"}) {
		t.Fatalf("asked %+v", asked)
	}
	rows := w.rows()
	if len(rows) != 1 || rows[0].key != "41.31,69.24" || rows[0].data != sunnyRow ||
		!rows[0].fetchedAt.Equal(w.t0) || !rows[0].expires.Equal(w.t0.Add(30*time.Minute)) {
		t.Fatalf("the cache: %+v", rows)
	}

	// The same cell, from elsewhere in it, until the half hour is over.
	w.provider.set(func(p *fakeProvider) { p.answer.Temperature = -5 })
	for _, at := range []time.Duration{time.Second, 29*time.Minute + 59*time.Second} {
		w.clock(at)
		for _, place := range [][2]float64{{41.311482, 69.240562}, {41.3149, 69.2351}, {41.3051, 69.244999}} {
			if again := w.current(place[0], place[1]); !again.Cached || again.Current != sunny {
				t.Fatalf("after %v at %v: %+v", at, place, again)
			}
		}
	}
	if asked := w.provider.questions(); len(asked) != 1 {
		t.Fatalf("asked %d times within the half hour", len(asked))
	}

	// Another cell is another question.
	if other := w.current(41.32, 69.24); other.Cached || other.Temperature != -5 {
		t.Fatalf("another cell: %+v", other)
	}
	if asked := w.provider.questions(); len(asked) != 2 || asked[1] != (weather.Cell{Lat: "41.32", Lon: "69.24"}) {
		t.Fatalf("asked %+v", asked)
	}

	// At the half hour the cell's weather is old: asked again, the row replaced.
	w.clock(30 * time.Minute)
	if late := w.current(41.311482, 69.240562); late.Cached || late.Temperature != -5 {
		t.Fatalf("after the half hour: %+v", late)
	}
	rows = w.rows()
	if len(rows) != 2 || rows[0].key != "41.31,69.24" || !strings.Contains(rows[0].data, `"temperature":-5`) ||
		!rows[0].fetchedAt.Equal(w.t0.Add(30*time.Minute)) || !rows[0].expires.Equal(w.t0.Add(60*time.Minute)) {
		t.Fatalf("the cache after the half hour: %+v", rows)
	}
}

func TestAFailureIsNotCached(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	down := errors.New("the service is down")
	w.provider.set(func(p *fakeProvider) { p.err = down })
	if _, err := w.service.Current(context.Background(), 41.31, 69.24); !errors.Is(err, down) {
		t.Fatalf("got %v", err)
	}
	// A provider that answers what is no weather.
	for name, change := range map[string]func(c *weather.Current){
		"a temperature out of range": func(c *weather.Current) { c.Temperature = 99 },
		"no condition":               func(c *weather.Current) { c.Condition = "" },
		"no time":                    func(c *weather.Current) { c.FetchedAt = "" },
	} {
		w.provider.set(func(p *fakeProvider) { p.err, p.answer = nil, sunny; change(&p.answer) })
		if got, err := w.service.Current(context.Background(), 41.31, 69.24); err == nil {
			t.Fatalf("%s: answered %+v", name, got)
		}
	}
	if rows := w.rows(); len(rows) != 0 {
		t.Fatalf("cached: %+v", rows)
	}
	// The next request asks again and is answered.
	w.provider.set(func(p *fakeProvider) { p.answer = sunny })
	if got := w.current(41.31, 69.24); got.Cached || got.Current != sunny {
		t.Fatalf("after the failures: %+v", got)
	}
	if asked := w.provider.questions(); len(asked) != 5 {
		t.Fatalf("asked %d times", len(asked))
	}
}

func TestRowsOfTheNextJSAPIAreReadAndBrokenRowsAreNot(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	// As apps/web writes a row (JSON.stringify of its CurrentWeather).
	const next = `{"temperature":9,"feelsLike":7,"condition":"cloudy","conditionLabel":"Bulutli","precipitationProbability":81,` +
		`"precipitationAmount":0,"humidity":88,"windSpeed":6,"uvIndex":1.85,"source":"open-meteo","fetchedAt":"2026-11-27T03:58:11.402Z"}`
	w.insert("41.31,69.24", next, 10*time.Minute)
	got := w.current(41.31, 69.24)
	want := weather.Current{
		Temperature: 9, FeelsLike: 7, Condition: "cloudy", ConditionLabel: "Bulutli", PrecipitationProbability: 81,
		PrecipitationAmount: 0, Humidity: 88, WindSpeed: 6, UVIndex: 1.85, Source: "open-meteo", FetchedAt: "2026-11-27T03:58:11.402Z",
	}
	if !got.Cached || got.Current != want {
		t.Fatalf("a row of the Next.js API: %+v", got)
	}

	broken := map[string]string{
		"1.00,1.00": `not JSON`,
		"2.00,2.00": `null`,
		"3.00,3.00": `{}`,
		"4.00,4.00": strings.Replace(next, `"humidity":88,`, ``, 1),
		"5.00,5.00": strings.Replace(next, `"temperature":9`, `"temperature":"9"`, 1),
		"6.00,6.00": strings.Replace(next, `"temperature":9`, `"temperature":900`, 1),
		"7.00,7.00": strings.Replace(next, `"condition":"cloudy"`, `"condition":null`, 1),
		"8.00,8.00": strings.Replace(next, `"fetchedAt":"2026-11-27T03:58:11.402Z"`, `"fetchedAt":"yesterday"`, 1),
		"9.00,9.00": strings.Replace(next, `"uvIndex":1.85`, `"uvIndex":-1`, 1),
	}
	for key, data := range broken {
		w.insert(key, data, 10*time.Minute)
	}
	for n := 1.0; n <= 9; n++ {
		if got := w.current(n, n); got.Cached || got.Current != sunny {
			t.Errorf("cell %v: %+v", n, got)
		}
	}
	if asked := w.provider.questions(); len(asked) != len(broken) {
		t.Fatalf("asked %d times for %d broken rows", len(asked), len(broken))
	}
	// Each broken row was replaced by the answer.
	for _, r := range w.rows() {
		if r.key != "41.31,69.24" && r.data != sunnyRow {
			t.Errorf("row %s is still %s", r.key, r.data)
		}
	}
	// An expired row is not read, whatever it holds.
	w.insert("-33.87,151.21", next, 0)
	if got := w.current(-33.865, 151.209444); got.Cached {
		t.Fatalf("an expired row was answered: %+v", got)
	}
	if strings.Contains(w.logs.String(), "41.31") || strings.Contains(w.logs.String(), "151.21") {
		t.Errorf("the logs name a place: %s", w.logs.String())
	}
}

func TestRequestsForACellAtOnceAskOnce(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	arrived, release := make(chan struct{}, 64), make(chan struct{})
	w.provider.set(func(p *fakeProvider) { p.arrived, p.release = arrived, release })

	const callers = 12
	answers := make(chan weather.Report, callers)
	failures := make(chan error, callers)
	for range callers {
		go func() {
			report, err := w.service.Current(context.Background(), 41.311, 69.243)
			if err != nil {
				failures <- err
				return
			}
			answers <- report
		}()
	}
	<-arrived
	// One request gives up while the question is out; the others still get the answer.
	ctx, cancel := context.WithCancel(context.Background())
	gaveUp := make(chan error, 1)
	go func() {
		_, err := w.service.Current(ctx, 41.311, 69.243)
		gaveUp <- err
	}()
	cancel()
	select {
	case err := <-gaveUp:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("the request that gave up: %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the request that gave up is still waiting")
	}
	// Let the others reach the question before it is answered.
	time.Sleep(300 * time.Millisecond)
	close(release)
	for range callers {
		select {
		case report := <-answers:
			if report.Current != sunny {
				t.Fatalf("answered %+v", report)
			}
		case err := <-failures:
			t.Fatal(err)
		case <-time.After(20 * time.Second):
			t.Fatal("a request is still waiting")
		}
	}
	if asked := w.provider.questions(); len(asked) != 1 {
		t.Fatalf("asked %d times for one cell at once", len(asked))
	}
	if rows := w.rows(); len(rows) != 1 {
		t.Fatalf("the cache: %+v", rows)
	}
}

// The request that started a question gives up: the question is still
// answered and cached, for the next one.
func TestAQuestionOutlivesTheRequestThatAskedIt(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	arrived, release := make(chan struct{}, 1), make(chan struct{})
	w.provider.set(func(p *fakeProvider) { p.arrived, p.release = arrived, release })
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := w.service.Current(ctx, 41.31, 69.24)
		done <- err
	}()
	<-arrived
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("got %v", err)
	}
	close(release)
	deadline := time.Now().Add(10 * time.Second)
	for len(w.rows()) == 0 {
		if time.Now().After(deadline) {
			t.Fatal("the answer was not cached")
		}
		time.Sleep(20 * time.Millisecond)
	}
	w.provider.set(func(p *fakeProvider) { p.arrived, p.release = nil, nil })
	if got := w.current(41.31, 69.24); !got.Cached || got.Current != sunny {
		t.Fatalf("the next request: %+v", got)
	}
	if asked := w.provider.questions(); len(asked) != 1 {
		t.Fatalf("asked %d times", len(asked))
	}
}

func TestTheWeatherIsAnsweredAlthoughItCouldNotBeCached(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	_, err := w.pool.Exec(context.Background(), `
		CREATE FUNCTION refuse_weather() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'the disk is full'; END $$;
		CREATE TRIGGER refuse_weather BEFORE INSERT ON "WeatherCache" FOR EACH ROW EXECUTE FUNCTION refuse_weather();`)
	if err != nil {
		t.Fatal(err)
	}
	if got := w.current(41.31, 69.24); got.Cached || got.Current != sunny {
		t.Fatalf("got %+v", got)
	}
	logs := w.logs.String()
	if !strings.Contains(logs, "could not be cached") || !strings.Contains(logs, "the disk is full") || strings.Contains(logs, "41.31") {
		t.Errorf("the logs: %s", logs)
	}
	// A cache that cannot be read is an error: the database is not well.
	if _, err := w.pool.Exec(context.Background(), `ALTER TABLE "WeatherCache" RENAME TO "WeatherCacheGone"`); err != nil {
		t.Fatal(err)
	}
	if got, err := w.service.Current(context.Background(), 41.31, 69.24); err == nil {
		t.Fatalf("answered %+v without a cache table", got)
	}
}
