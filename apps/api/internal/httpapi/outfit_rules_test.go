package httpapi_test

import (
	"encoding/json"
	"net/url"
	"strings"
	"testing"

	"lookly/internal/golden"
	"lookly/internal/httpapi"
)

func TestOutfitAndWeatherRequestsAreJudgedAsTheNextJSAPIJudgesThem(t *testing.T) {
	t.Parallel()
	g := golden.LoadOutfitValidation(t)
	judge(t, []goldenSection{
		{name: "generate", rule: httpapi.OutfitGenerateBody, cases: g.Generate, exact: true},
		{name: "save", rule: httpapi.OutfitSaveBody, cases: g.Save, exact: true},
		{name: "patch", rule: httpapi.OutfitPatchBody, cases: g.Patch, exact: true},
		{name: "feedback", rule: httpapi.OutfitFeedbackBody, cases: g.Feedback, exact: true},
		{name: "stylistChat", rule: httpapi.StylistChatBody, cases: g.StylistChat, exact: true},
	})

	// A conversation id from the path is read as an item id is.
	for _, c := range g.ConversationIDs {
		id, err := httpapi.ItemID(c.ID)
		var got map[string]any
		if err == nil {
			got = map[string]any{"id": id}
		}
		same(t, "conversation id "+c.ID, c.Outcome, got, err)
	}

	for _, c := range g.Saved {
		values, name := url.Values{}, "saved absent"
		if c.Saved != nil {
			values.Set("saved", *c.Saved)
			name = "saved=" + *c.Saved
		}
		canonical, err := httpapi.OutfitListQuery(values)
		var got map[string]any
		if err == nil {
			got = map[string]any{}
			for k := range canonical {
				got[k] = canonical.Get(k)
			}
		}
		same(t, name, c.Outcome, got, err)
	}
	for _, c := range g.Coordinates {
		values := url.Values{}
		var name []string
		for param, value := range map[string]*string{"lat": c.Lat, "lon": c.Lon} {
			if value != nil {
				values.Set(param, *value)
				name = append(name, param+"="+*value)
			}
		}
		canonical, err := httpapi.WeatherQuery(values)
		var got map[string]any
		if err == nil {
			// Numbers in the Next.js value.
			got = map[string]any{"lat": json.Number(canonical.Get("lat")), "lon": json.Number(canonical.Get("lon"))}
		}
		same(t, "coordinates "+strings.Join(name, " "), c.Outcome, got, err)
	}
}

// Whatever the body, the rules never panic, and what they accept they
// accept again unchanged.
func FuzzOutfitBodies(f *testing.F) {
	g := golden.LoadOutfitValidation(f)
	for _, section := range [][]golden.ValidationCase{g.Generate, g.Save, g.Patch, g.Feedback, g.StylistChat} {
		for _, c := range section {
			f.Add(c.Body)
		}
	}
	f.Fuzz(func(t *testing.T, body string) {
		for name, rule := range map[string]httpapi.BodyRule{
			"generate": httpapi.OutfitGenerateBody, "save": httpapi.OutfitSaveBody, "patch": httpapi.OutfitPatchBody, "feedback": httpapi.OutfitFeedbackBody,
		} {
			canonical, err := rule([]byte(body))
			if err != nil {
				continue
			}
			again, err := rule(canonical)
			if err != nil || string(again) != string(canonical) {
				t.Fatalf("%s: %q was accepted as %s, which is then judged as %s (%v)", name, body, canonical, again, err)
			}
		}
	})
}

// The canonical coordinates are what the cache key is made from: a
// coordinate written in another way is the same coordinate.
func TestCoordinatesAreWrittenOneWay(t *testing.T) {
	t.Parallel()
	for _, c := range []struct{ lat, lon, wantLat, wantLon string }{
		{"-0", "-0.0", "0", "0"},
		{" 41.31 ", "+69.240", "41.31", "69.24"},
		{"4.131e1", "0x10", "41.31", "16"},
		{"-90", "180", "-90", "180"},
	} {
		got, err := httpapi.WeatherQuery(url.Values{"lat": {c.lat}, "lon": {c.lon}, "other": {"x"}})
		if err != nil {
			t.Fatalf("lat=%q lon=%q: %v", c.lat, c.lon, err)
		}
		if len(got) != 2 || got.Get("lat") != c.wantLat || got.Get("lon") != c.wantLon {
			t.Errorf("lat=%q lon=%q: got %v, want lat=%s lon=%s", c.lat, c.lon, got, c.wantLat, c.wantLon)
		}
	}
}
