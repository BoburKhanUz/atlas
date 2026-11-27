//go:build integration

package httpapi_test

import (
	"encoding/json"
	"errors"
	"net/http"
	"reflect"
	"strings"
	"testing"
	"time"

	"lookly/internal/engine"
	"lookly/internal/golden"
	"lookly/internal/weather"
)

const generatePath = "/api/v1/outfits/generate"

func generateCall(m mobileSession, body any) call {
	return call{path: generatePath, mobile: true, bearer: m.accessToken, body: body}
}

// garment is a stored item of the kind given.
func garment(id, category, subcategory string, colors []string, style, formality string, season []string) golden.WardrobeRow {
	row := plainRow(id)
	encode := func(v any) string {
		b, err := json.Marshal(v)
		if err != nil {
			panic(err)
		}
		return string(b)
	}
	row.Category, row.Subcategory, row.Colors, row.Season = category, ptr(subcategory), encode(colors), encode(season)
	row.Style, row.Formality = ptr(style), ptr(formality)
	return row
}

// closet is a wardrobe the engine makes several outfits of.
func closet() []golden.WardrobeRow {
	all := []string{"spring", "summer", "autumn", "winter"}
	return []golden.WardrobeRow{
		garment("c-tee", "shirt", "tshirt", []string{"white"}, "casual", "casual", []string{"spring", "summer"}),
		garment("c-oxford", "shirt", "shirt", []string{"blue"}, "classic", "smart_casual", all),
		garment("c-knit", "shirt", "sweater", []string{"gray"}, "casual", "casual", []string{"autumn", "winter"}),
		garment("c-jeans", "pants", "jeans", []string{"navy"}, "casual", "casual", all),
		garment("c-chinos", "pants", "trousers", []string{"beige"}, "classic", "smart_casual", all),
		garment("c-coat", "outerwear", "coat", []string{"black"}, "classic", "smart_casual", []string{"autumn", "winter"}),
		garment("c-sneakers", "shoes", "sneakers", []string{"white"}, "casual", "casual", all),
		garment("c-boots", "shoes", "boots", []string{"brown"}, "classic", "smart_casual", []string{"autumn", "winter"}),
		garment("c-bag", "bag", "backpack", []string{"black"}, "casual", "casual", all),
	}
}

// itemsOf is the wardrobe as the engine is to be given it: worked out from
// the rows here, not by the code under test.
func itemsOf(t *testing.T, rows []golden.WardrobeRow) []engine.Item {
	t.Helper()
	items := make([]engine.Item, 0, len(rows))
	for _, r := range rows {
		item := engine.Item{
			ID: r.ID, Category: r.Category, Subcategory: r.Subcategory, Pattern: r.Pattern, Material: r.Material,
			SleeveLength: r.SleeveLength, Fit: r.Fit, Style: r.Style, Gender: r.Gender, Formality: r.Formality,
		}
		if err := json.Unmarshal([]byte(r.Colors), &item.Colors); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal([]byte(r.Season), &item.Season); err != nil {
			t.Fatal(err)
		}
		items = append(items, item)
	}
	return items
}

var noPreferences = engine.Profile{PreferredStyles: []string{}, DislikedStyles: []string{}, FavoriteColors: []string{}, DislikedColors: []string{}}

var noFeedback = engine.Feedback{RejectedItemIDs: []string{}, LikedItemIDs: []string{}, RejectedOutfitKeys: []string{}}

// expectation is the answer the route owes for what the engine makes of in:
// the Next.js route's shape, built here from the engine's result.
func expectation(t *testing.T, in engine.Input, occasion any, weatherUsed any, links map[string]string) map[string]any {
	t.Helper()
	if in.Profile == nil {
		in.Profile = &noPreferences
	}
	if in.Feedback == nil {
		in.Feedback = &noFeedback
	}
	if in.TopN == nil {
		in.TopN = ptr(3.0)
	}
	result := engine.Generate(in)
	outfits := []any{}
	for _, c := range result.Outfits {
		items := []any{}
		for _, p := range c.Items {
			var link any
			if l, ok := links[p.Item.ID]; ok {
				link = l
			}
			items = append(items, map[string]any{
				"id": p.Item.ID, "role": p.Role, "layeringRole": string(p.Slot), "category": p.Item.Category,
				"subcategory": p.Item.Subcategory, "colors": p.Item.Colors, "style": p.Item.Style, "material": p.Item.Material,
				"season": p.Item.Season, "imageUrl": link,
			})
		}
		outfits = append(outfits, map[string]any{
			"tempId": c.TempID, "score": c.Score,
			"factors": map[string]any{
				"weather": c.Factors.Weather, "color": c.Factors.Color, "occasion": c.Factors.Occasion, "style": c.Factors.Style,
				"season": c.Factors.Season, "balance": c.Factors.Balance, "preference": c.Factors.Preference, "feedback": c.Factors.Feedback,
			},
			"reasons": c.Reasons, "reasonLabels": c.ReasonLabels, "contrastLevel": c.ContrastLevel, "items": items,
			"explanation": engine.Explanation(c, in.Occasion, result.Weather),
		})
	}
	want := map[string]any{
		"outfits": outfits, "weatherUsed": weatherUsed, "occasion": occasion, "wardrobeItemCount": len(in.Wardrobe), "fallback": true,
	}
	if len(outfits) == 0 {
		want["message"] = result.Problem.Message()
	}
	// As JSON reads it back.
	encoded, err := json.Marshal(want)
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	return decoded
}

func (a *api) generated(c call, want map[string]any) answer {
	a.t.Helper()
	got := a.do(c)
	if got.status != http.StatusOK {
		a.t.Fatalf("generate: %d %s", got.status, got.raw)
	}
	if !reflect.DeepEqual(got.body, want) {
		encoded, _ := json.Marshal(want)
		a.t.Fatalf("generate:\n got %s\nwant %s", got.raw, encoded)
	}
	return got
}

func outfitIDs(got answer) []string {
	var ids []string
	for _, o := range got.body["outfits"].([]any) {
		ids = append(ids, o.(map[string]any)["tempId"].(string))
	}
	return ids
}

var coldDay = map[string]any{
	"temperature": 3.0, "feelsLike": -1.0, "condition": "snow", "precipitationProbability": 70.0, "humidity": 80.0, "windSpeed": 20.0, "uvIndex": 1.0,
}

var coldDayForEngine = &engine.Weather{
	Temperature: ptr(3.0), FeelsLike: ptr(-1.0), Condition: ptr("snow"), PrecipitationProbability: ptr(70.0),
	Humidity: ptr(80.0), WindSpeed: ptr(20.0), UVIndex: ptr(1.0),
}

func TestOutfitsAreMadeOfTheWardrobeForTheOccasionAndTheWeather(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{})
	m := a.mobileRegister(nil)
	rows := closet()
	// Stored in another order than by id: the order of the rows is not the engine's.
	for i := len(rows) - 1; i >= 0; i-- {
		a.insertItem(a.userID(m.email), rows[i])
	}
	wardrobe := itemsOf(t, rows)

	// Nothing asked: three outfits, no weather, no occasion.
	plain := a.generated(generateCall(m, map[string]any{}), expectation(t, engine.Input{Wardrobe: wardrobe}, nil, nil, nil))
	if n := len(outfitIDs(plain)); n != 3 {
		t.Fatalf("%d outfits, want the default three", n)
	}
	if _, has := plain.body["message"]; has {
		t.Error("a message beside outfits")
	}
	// Nulls are nothing asked too.
	a.generated(generateCall(m, map[string]any{"occasion": nil, "weather": nil, "lat": nil, "lon": nil}),
		expectation(t, engine.Input{Wardrobe: wardrobe}, nil, nil, nil))

	// The occasion, the client's weather and how many.
	for _, c := range []struct {
		name string
		body map[string]any
		in   engine.Input
	}{
		{"an occasion", map[string]any{"occasion": "work"}, engine.Input{Wardrobe: wardrobe, Occasion: "work"}},
		{"a cold day", map[string]any{"weather": coldDay}, engine.Input{Wardrobe: wardrobe, Weather: coldDayForEngine}},
		{"five for a date in the cold", map[string]any{"occasion": "date", "weather": coldDay, "topN": 5},
			engine.Input{Wardrobe: wardrobe, Occasion: "date", Weather: coldDayForEngine, TopN: ptr(5.0)}},
		{"one", map[string]any{"topN": 1}, engine.Input{Wardrobe: wardrobe, TopN: ptr(1.0)}},
		{"another option", map[string]any{"seed": 7}, engine.Input{Wardrobe: wardrobe, Seed: ptr(7.0)}},
		{"a negative seed", map[string]any{"seed": -3, "topN": 2}, engine.Input{Wardrobe: wardrobe, Seed: ptr(-3.0), TopN: ptr(2.0)}},
		{"another option still", map[string]any{"seed": 123456.5, "occasion": "casual"}, engine.Input{Wardrobe: wardrobe, Seed: ptr(123456.5), Occasion: "casual"}},
		{"a seed of zero is a seed", map[string]any{"seed": 0}, engine.Input{Wardrobe: wardrobe, Seed: ptr(0.0)}},
	} {
		var occasion, used any
		if c.in.Occasion != "" {
			occasion = c.in.Occasion
		}
		if c.in.Weather != nil {
			used = coldDay
		}
		got := a.do(generateCall(m, c.body))
		if want := expectation(t, c.in, occasion, used, nil); got.status != http.StatusOK || !reflect.DeepEqual(got.body, want) {
			encoded, _ := json.Marshal(want)
			t.Errorf("%s:\n got %s\nwant %s", c.name, got.raw, encoded)
		}
	}
	// What was asked changes what is answered (the cases above are not all one answer).
	cold := a.do(generateCall(m, map[string]any{"weather": coldDay}))
	if reflect.DeepEqual(cold.body["outfits"], plain.body["outfits"]) {
		t.Error("the weather changed nothing")
	}
	// "Another option": some seed gives another best outfit than no seed,
	// and each seed's answer is the engine's for that seed.
	best := outfitIDs(a.do(generateCall(m, map[string]any{"topN": 1})))
	another := false
	for seed := 1.0; seed <= 12; seed++ {
		got := a.generated(generateCall(m, map[string]any{"topN": 1, "seed": seed}),
			expectation(t, engine.Input{Wardrobe: wardrobe, TopN: ptr(1.0), Seed: &seed}, nil, nil, nil))
		another = another || !reflect.DeepEqual(outfitIDs(got), best)
	}
	if !another {
		t.Error("no seed gave another outfit")
	}
	// Nothing was stored.
	if n := query[int](a, `SELECT count(*) FROM "Outfit"`); n != 0 {
		t.Errorf("%d outfits were stored", n)
	}
}

func TestAWardrobeThatIsNotEnoughIsToldWhy(t *testing.T) {
	t.Parallel()
	provider := &forecasts{answer: drizzle}
	a := newAPI(t, apiOptions{weather: provider})
	m := a.mobileRegister(nil)
	user := a.userID(m.email)
	// Another user's full wardrobe is not this user's.
	other := a.mobileRegister(nil)
	for _, row := range closet() {
		row.ID = "o-" + row.ID
		a.insertItem(a.userID(other.email), row)
	}

	const (
		empty      = "Garderobingiz bo‘sh. Avval kiyim qo‘shing — keyin sizga mos obrazlarni tavsiya qilamiz."
		noFootwear = "Outfit uchun oyoq kiyim kerak. Garderobingizga kamida bitta oyoq kiyim qo‘shing."
		noMain     = "Outfit tuzish uchun yetarli kiyim yo‘q: ustki va pastki kiyim (yoki ko‘ylak-ayol) hamda oyoq kiyim qo‘shing."
	)
	told := func(body map[string]any, count int, message string, weatherUsed, occasion any) {
		t.Helper()
		got := a.do(generateCall(m, body))
		want := map[string]any{
			"outfits": []any{}, "weatherUsed": weatherUsed, "occasion": occasion, "wardrobeItemCount": float64(count), "fallback": true, "message": message,
		}
		if got.status != http.StatusOK || !reflect.DeepEqual(got.body, want) {
			t.Fatalf("%d items: %d %s", count, got.status, got.raw)
		}
	}
	told(map[string]any{}, 0, empty, nil, nil)
	// An empty wardrobe needs no weather: the service is not asked.
	told(map[string]any{"lat": 41.31, "lon": 69.24, "occasion": "work"}, 0, empty, nil, "work")
	if asked := provider.questions(); len(asked) != 0 {
		t.Fatalf("the weather was asked for an empty wardrobe: %+v", asked)
	}
	// The client's weather is echoed all the same.
	told(map[string]any{"weather": coldDay}, 0, empty, coldDay, nil)

	rows := closet()
	a.insertItem(user, rows[0]) // a T-shirt
	a.insertItem(user, rows[3]) // jeans
	told(map[string]any{}, 2, noFootwear, nil, nil)
	a.exec(`DELETE FROM "WardrobeItem" WHERE "userId" = $1`, user)
	a.insertItem(user, rows[6]) // sneakers
	a.insertItem(user, rows[8]) // a bag
	told(map[string]any{}, 2, noMain, nil, nil)
	a.insertItem(user, rows[0]) // a T-shirt, no trousers
	told(map[string]any{}, 3, noMain, nil, nil)
}

func TestTheWeatherOfThePlaceIsUsedWhenTheClientBringsNone(t *testing.T) {
	t.Parallel()
	frost := weather.Current{
		Temperature: -6, FeelsLike: -11, Condition: "snow", ConditionLabel: "Qor", PrecipitationProbability: 85,
		PrecipitationAmount: 1.2, Humidity: 90, WindSpeed: 25, UVIndex: 0.5, Source: "test", FetchedAt: "2026-11-27T07:15:02.417Z",
	}
	provider := &forecasts{answer: frost}
	a := newAPI(t, apiOptions{weather: provider})
	m := a.mobileRegister(nil)
	rows := closet()
	for _, row := range rows {
		a.insertItem(a.userID(m.email), row)
	}
	wardrobe := itemsOf(t, rows)
	frostUsed := map[string]any{
		"temperature": -6.0, "feelsLike": -11.0, "condition": "snow", "precipitationProbability": 85.0, "humidity": 90.0, "windSpeed": 25.0, "uvIndex": 0.5,
	}
	frostForEngine := &engine.Weather{
		Temperature: ptr(-6.0), FeelsLike: ptr(-11.0), Condition: ptr("snow"), PrecipitationProbability: ptr(85.0),
		Humidity: ptr(90.0), WindSpeed: ptr(25.0), UVIndex: ptr(0.5),
	}
	withFrost := expectation(t, engine.Input{Wardrobe: wardrobe, Weather: frostForEngine}, nil, frostUsed, nil)
	without := expectation(t, engine.Input{Wardrobe: wardrobe}, nil, nil, nil)
	if reflect.DeepEqual(withFrost["outfits"], without["outfits"]) {
		t.Fatal("the test's weather changes nothing: it proves nothing")
	}

	// From the service, for the cell; then from the cache.
	a.generated(generateCall(m, map[string]any{"lat": 41.311482, "lon": 69.240562}), withFrost)
	a.generated(generateCall(m, map[string]any{"lat": 41.3149, "lon": 69.2351}), withFrost)
	if asked := provider.questions(); len(asked) != 1 || asked[0] != (weather.Cell{Lat: "41.31", Lon: "69.24"}) {
		t.Fatalf("asked %+v", asked)
	}
	// The weather endpoint and the generation share the cache.
	if got := a.do(weatherCall(m, "lat=41.31&lon=69.24")); got.status != http.StatusOK || got.body["weather"].(map[string]any)["cached"] != true {
		t.Fatalf("the weather endpoint after a generation: %d %s", got.status, got.raw)
	}

	// The client's weather wins, and half a place is no place: not asked.
	a.generated(generateCall(m, map[string]any{"lat": 55.75, "lon": 37.62, "weather": coldDay}),
		expectation(t, engine.Input{Wardrobe: wardrobe, Weather: coldDayForEngine}, nil, coldDay, nil))
	a.generated(generateCall(m, map[string]any{"lat": 55.75}), without)
	a.generated(generateCall(m, map[string]any{"lon": 37.62, "lat": nil}), without)
	if asked := provider.questions(); len(asked) != 1 {
		t.Fatalf("asked %+v", asked)
	}

	// A weather service that fails does not stop the outfits.
	provider.mu.Lock()
	provider.err = errors.New("open-meteo: status 503")
	provider.mu.Unlock()
	a.generated(generateCall(m, map[string]any{"lat": 55.75, "lon": 37.62}), without)
	logs := a.logs()
	if !strings.Contains(logs, "open-meteo: status 503") || strings.Contains(logs, "55.75") || strings.Contains(logs, "37.62") {
		t.Errorf("the failure is not logged, or the place is: %s", logs)
	}
}

func TestPreferencesTheColourProfileAndFeedbackShapeTheOutfits(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{})
	m := a.mobileRegister(nil)
	user := a.userID(m.email)
	rows := closet()
	for _, row := range rows {
		a.insertItem(user, row)
	}
	wardrobe := itemsOf(t, rows)
	plain := expectation(t, engine.Input{Wardrobe: wardrobe}, nil, nil, nil)
	a.generated(generateCall(m, map[string]any{}), plain)

	// The preferences and the profile.
	a.exec(`UPDATE "UserPreferences" SET "preferredStyles" = '["classic"]', "dislikedStyles" = '["sport"]',
		"favoriteColors" = '["blue","beige"]', "dislikedColors" = '["white"]' WHERE "userId" = $1`, user)
	a.exec(`INSERT INTO "UserProfile" ("id","userId","gender","preferredFit","createdAt","updatedAt") VALUES ('p-1',$1,'male','slim',now(),now())
		ON CONFLICT ("userId") DO UPDATE SET "gender" = 'male', "preferredFit" = 'slim'`, user)
	profile := &engine.Profile{
		Gender: ptr("male"), PreferredFit: ptr("slim"), PreferredStyles: []string{"classic"}, DislikedStyles: []string{"sport"},
		FavoriteColors: []string{"blue", "beige"}, DislikedColors: []string{"white"},
	}
	withProfile := expectation(t, engine.Input{Wardrobe: wardrobe, Profile: profile}, nil, nil, nil)
	if reflect.DeepEqual(withProfile, plain) {
		t.Fatal("the test's preferences change nothing: it proves nothing")
	}
	a.generated(generateCall(m, map[string]any{}), withProfile)

	// The stored colour profile, when the profile points to it.
	a.exec(`INSERT INTO "ColorProfile" ("id","userId","undertone","season","contrastLevel","recommendedColors","neutralColors","cautionColors",
		"analysisJson","confidence","undertoneConfidence","secondarySeason","secondaryConfidence","createdAt","updatedAt")
		VALUES ('cp-1',$1,'cool','winter','high','["navy","blue","black"]','["gray","white"]','["beige","brown"]','{}',0.9,0.8,'summer',0.4,now(),now())`, user)
	a.generated(generateCall(m, map[string]any{}), withProfile) // not pointed to: not used
	a.exec(`UPDATE "UserProfile" SET "colorProfileId" = 'cp-1' WHERE "userId" = $1`, user)
	colors := &engine.ColorProfile{
		Season: ptr("winter"), SecondarySeason: ptr("summer"), Undertone: ptr("cool"), Confidence: ptr(0.9), UndertoneConfidence: ptr(0.8),
		SecondaryConfidence: ptr(0.4), RecommendedColors: []string{"navy", "blue", "black"}, NeutralColors: []string{"gray", "white"},
		CautionColors: []string{"beige", "brown"},
	}
	withColors := expectation(t, engine.Input{Wardrobe: wardrobe, Profile: profile, ColorProfile: colors}, nil, nil, nil)
	if reflect.DeepEqual(withColors, withProfile) {
		t.Fatal("the test's colour profile changes nothing: it proves nothing")
	}
	a.generated(generateCall(m, map[string]any{}), withColors)

	// Feedback: a rejected outfit, a liked one; an old one and another
	// user's count for nothing.
	other := a.mobileRegister(nil)
	otherID := a.userID(other.email)
	outfit := func(id, owner string, items ...string) {
		a.exec(`INSERT INTO "Outfit" ("id","userId","reasonsJson","isSaved","createdAt","updatedAt") VALUES ($1,$2,'[]',false,now(),now())`, id, owner)
		for i, item := range items {
			a.exec(`INSERT INTO "OutfitItem" ("id","outfitId","wardrobeItemId","role","createdAt") VALUES ($1,$2,$3,'top',now() + $4 * interval '1 second')`,
				id+"-"+item, id, item, i)
		}
	}
	feedback := func(id, owner, outfitID, kind string, age time.Duration) {
		a.exec(`INSERT INTO "OutfitFeedback" ("id","userId","outfitId","feedback","createdAt") VALUES ($1,$2,$3,$4,(now() AT TIME ZONE 'UTC') - $5 * interval '1 second')`,
			id, owner, outfitID, kind, int(age.Seconds()))
	}
	outfit("of-rejected", user, "c-oxford", "c-chinos", "c-boots", "c-bag")
	outfit("of-liked", user, "c-tee", "c-jeans", "c-sneakers")
	outfit("of-old", user, "c-knit", "c-jeans", "c-sneakers")
	outfit("of-empty", user)
	feedback("f-1", user, "of-rejected", "rejected", time.Hour)
	feedback("f-2", user, "of-rejected", "disliked", 2*time.Hour) // twice is once
	feedback("f-3", user, "of-liked", "liked", time.Hour)
	feedback("f-4", user, "of-liked", "saved", 29*24*time.Hour)
	feedback("f-5", user, "of-old", "rejected", 31*24*time.Hour) // too old
	feedback("f-6", user, "of-empty", "rejected", time.Hour)     // of nothing
	// Another user's outfit and feedback.
	for _, row := range closet() {
		row.ID = "o-" + row.ID
		a.insertItem(otherID, row)
	}
	outfit("of-theirs", otherID, "o-c-knit", "o-c-jeans", "o-c-sneakers")
	feedback("f-7", otherID, "of-theirs", "rejected", time.Hour)

	given := &engine.Feedback{
		RejectedItemIDs: []string{"c-bag", "c-boots", "c-chinos", "c-oxford"},
		LikedItemIDs:    []string{"c-jeans", "c-sneakers", "c-tee"},
		RejectedOutfitKeys: []string{engine.Key([]engine.KeyPiece{
			{ID: "c-oxford", Slot: engine.Top}, {ID: "c-chinos", Slot: engine.Bottom}, {ID: "c-boots", Slot: engine.Footwear},
		})},
	}
	withFeedback := expectation(t, engine.Input{Wardrobe: wardrobe, Profile: profile, ColorProfile: colors, Feedback: given}, nil, nil, nil)
	if reflect.DeepEqual(withFeedback, withColors) {
		t.Fatal("the test's feedback changes nothing: it proves nothing")
	}
	a.generated(generateCall(m, map[string]any{}), withFeedback)
}

func TestStoredListsThatAreNoListsCountAsEmpty(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{})
	m := a.mobileRegister(nil)
	user := a.userID(m.email)
	rows := closet()
	rows[0].Colors, rows[1].Season, rows[3].Colors, rows[4].Season = `not json`, `{"a":1}`, `null`, `"summer"`
	for _, row := range rows {
		a.insertItem(user, row)
	}
	a.exec(`UPDATE "UserPreferences" SET "preferredStyles" = 'x', "dislikedStyles" = '7', "favoriteColors" = 'null', "dislikedColors" = '{}' WHERE "userId" = $1`, user)
	rows[0].Colors, rows[1].Season, rows[3].Colors, rows[4].Season = `[]`, `[]`, `[]`, `[]`
	a.generated(generateCall(m, map[string]any{"occasion": "casual"}), expectation(t, engine.Input{Wardrobe: itemsOf(t, rows), Occasion: "casual"}, "casual", nil, nil))
}

func TestGeneratedOutfitsLinkToTheItemsPictures(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 11, 27, 9, 0, 0, 0, time.UTC)
	a := newAPI(t, apiOptions{now: func() time.Time { return now }})
	m := a.mobileRegister(nil)
	user := a.userID(m.email)
	image := func(id, key string, thumbnail, display *string, primary bool, at string) golden.WardrobeImageRow {
		return golden.WardrobeImageRow{
			ID: id, StorageKey: key, ThumbnailKey: thumbnail, DisplayKey: display, IsPrimary: primary,
			MimeType: ptr("image/webp"), CreatedAt: at,
		}
	}
	key := func(name string) string { return "wardrobe/" + user + "/" + name + ".webp" }
	rows := []golden.WardrobeRow{closet()[0], closet()[3], closet()[6]}
	// The T-shirt: the primary image is not the first; its thumbnail is linked.
	rows[0].Images = []golden.WardrobeImageRow{
		image("i-1", key("tee-old"), ptr(key("tee-old-t")), nil, false, "2026-11-20T07:00:00.000Z"),
		image("i-2", key("tee"), ptr(key("tee-t")), ptr(key("tee-d")), true, "2026-11-21T07:00:00.000Z"),
		image("i-3", key("tee-later"), ptr(key("tee-later-t")), nil, true, "2026-11-22T07:00:00.000Z"),
	}
	// The jeans: no primary image, the first counts; no thumbnail, the display variant is linked.
	rows[1].Images = []golden.WardrobeImageRow{
		image("i-4", key("jeans"), nil, ptr(key("jeans-d")), false, "2026-11-20T07:00:00.000Z"),
		image("i-5", key("jeans-2"), ptr(key("jeans-2-t")), nil, false, "2026-11-21T07:00:00.000Z"),
	}
	// The sneakers: no image.
	for _, row := range rows {
		a.insertItem(user, row)
	}
	sign := func(k string) string {
		link, _ := a.media.Sign(k, now)
		return link
	}
	links := map[string]string{"c-tee": sign(key("tee-t")), "c-jeans": sign(key("jeans-d"))}
	got := a.generated(generateCall(m, map[string]any{}), expectation(t, engine.Input{Wardrobe: itemsOf(t, rows)}, nil, nil, links))
	if len(outfitIDs(got)) != 1 || strings.Contains(string(got.raw), "tee-old") || strings.Contains(string(got.raw), "storageKey") {
		t.Fatalf("got %s", got.raw)
	}

	// An image of before the variants: the picture itself is linked.
	a.exec(`UPDATE "WardrobeImage" SET "displayKey" = NULL WHERE "id" = 'i-4'`)
	links["c-jeans"] = sign(key("jeans"))
	a.generated(generateCall(m, map[string]any{}), expectation(t, engine.Input{Wardrobe: itemsOf(t, rows)}, nil, nil, links))
}

func TestGenerationNeedsASessionConsentAndASoundBodyInThatOrder(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{})
	m := a.mobileRegister(nil)
	requests := []call{
		generateCall(m, map[string]any{}),
		generateCall(m, map[string]any{"topN": 9}),
		generateCall(m, `{not json`),
	}
	for _, c := range requests {
		anonymous := c
		anonymous.bearer = ""
		a.is(a.do(anonymous), http.StatusUnauthorized, "UNAUTHORIZED")
	}
	a.is(a.do(requests[1]), http.StatusBadRequest, "VALIDATION_ERROR")
	a.is(a.do(requests[2]), http.StatusBadRequest, "BAD_REQUEST")
	a.is(a.do(generateCall(m, map[string]any{"occasion": "moon-landing"})), http.StatusBadRequest, "VALIDATION_ERROR")
	a.is(a.do(generateCall(m, map[string]any{"weather": map[string]any{"temperature": 20}})), http.StatusBadRequest, "VALIDATION_ERROR")
	a.is(a.do(generateCall(m, "  \n")), http.StatusBadRequest, "BAD_REQUEST")
	// No body at all is nothing asked, as in the Next.js API.
	a.is(a.do(generateCall(m, nil)), http.StatusOK, "")
	a.exec(`UPDATE "LegalConsent" SET "version" = $2 WHERE "userId" = $1`, a.userID(m.email), outdatedVersion)
	for _, c := range requests {
		a.is(a.do(c), http.StatusForbidden, "CONSENT_REQUIRED")
	}
	// A web session's write needs our own origin, as every write does.
	web := a.webLogin()
	cookies := map[string]string{"atlas_at": web.at}
	a.is(a.do(call{path: generatePath, cookies: cookies, body: map[string]any{}, headers: map[string]string{"Origin": "https://evil.example"}}), http.StatusForbidden, "FORBIDDEN")
	a.is(a.do(call{path: generatePath, cookies: cookies, body: map[string]any{}, headers: map[string]string{"Origin": "http://app.example.uz"}}), http.StatusOK, "")
}
