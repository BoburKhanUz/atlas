//go:build integration

package httpapi_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"reflect"
	"regexp"
	"strings"
	"testing"
	"time"

	"lookly/internal/dbtest"
)

const outfitsPath = "/api/v1/outfits"

func outfitsCall(m mobileSession, method, query string, body any) call {
	path := outfitsPath
	if query != "" {
		path += "?" + query
	}
	return call{method: method, path: path, contract: outfitsPath, mobile: true, bearer: m.accessToken, body: body}
}

func outfitCall(m mobileSession, method, id string, body any) call {
	return call{method: method, path: outfitsPath + "/" + url.PathEscape(id), contract: outfitsPath + "/{id}", mobile: true, bearer: m.accessToken, body: body}
}

func feedbackCall(m mobileSession, id string, body any) call {
	return call{path: outfitsPath + "/" + url.PathEscape(id) + "/feedback", contract: outfitsPath + "/{id}/feedback", mobile: true, bearer: m.accessToken, body: body}
}

var outfitT0 = time.Date(2026, 11, 27, 9, 0, 0, 0, time.UTC)

// wearer is an API with a registered user who owns the closet; the
// database clock stands at outfitT0.
func wearer(t *testing.T, o apiOptions) (*api, mobileSession, string) {
	t.Helper()
	a := newAPI(t, o)
	dbtest.SetClock(t, a.pool, outfitT0)
	m := a.mobileRegister(nil)
	user := a.userID(m.email)
	for _, row := range closet() {
		a.insertItem(user, row)
	}
	return a, m, user
}

func pieces(pairs ...string) []any {
	var items []any
	for i := 0; i < len(pairs); i += 2 {
		items = append(items, map[string]any{"itemId": pairs[i], "role": pairs[i+1]})
	}
	return items
}

var casualPieces = pieces("c-tee", "top", "c-jeans", "bottom", "c-sneakers", "shoes", "c-bag", "accessory")

// save stores an outfit and returns its id.
func (a *api) save(m mobileSession, body map[string]any) string {
	a.t.Helper()
	got := a.do(outfitsCall(m, http.MethodPost, "", body))
	a.is(got, http.StatusCreated, "")
	return got.text("outfit", "id")
}

func (a *api) rowJSON(table, id string) map[string]any {
	a.t.Helper()
	raw := query[[]byte](a, `SELECT to_jsonb(r) FROM "`+table+`" r WHERE "id" = $1`, id)
	var row map[string]any
	if err := json.Unmarshal(raw, &row); err != nil {
		a.t.Fatal(err)
	}
	return row
}

var cuidShape = regexp.MustCompile(`^c[a-z0-9]{24}$`)

func TestAnOutfitIsSavedAsItWasGiven(t *testing.T) {
	t.Parallel()
	a, m, user := wearer(t, apiOptions{})
	got := a.do(outfitsCall(m, http.MethodPost, "", map[string]any{
		"items": casualPieces, "occasion": "casual", "name": "  Dam olish  ", "score": 86.5,
		"weather":     map[string]any{"temperature": 21.5, "feelsLike": 20, "condition": " clear ", "precipitationProbability": 5, "humidity": 40, "windSpeed": 9.25, "uvIndex": 6},
		"reasons":     []string{"weather_fit", "a < b & c"},
		"explanation": "Yengil va qulay.", "isSaved": true, "unknown": "dropped",
	}))
	a.is(got, http.StatusCreated, "")
	outfit := got.body["outfit"].(map[string]any)
	id := outfit["id"].(string)
	items := outfit["items"].([]any)
	if !cuidShape.MatchString(id) || len(items) != 4 {
		t.Fatalf("got %s", got.raw)
	}
	wantItems := []any{}
	for i, pair := range casualPieces {
		item := items[i].(map[string]any)
		if !cuidShape.MatchString(item["id"].(string)) {
			t.Fatalf("item %d: %v", i, item)
		}
		p := pair.(map[string]any)
		// Each a millisecond after the one before: the order they are read in.
		wantItems = append(wantItems, map[string]any{
			"id": item["id"], "outfitId": id, "wardrobeItemId": p["itemId"], "role": p["role"],
			"createdAt": fmt.Sprintf("2026-11-27T09:00:00.00%dZ", i),
		})
	}
	const (
		weatherText = `{"temperature":21.5,"feelsLike":20,"condition":"clear","precipitationProbability":5,"humidity":40,"windSpeed":9.25,"uvIndex":6}`
		reasonsText = `["weather_fit","a < b & c"]`
	)
	// The row, member by member, as the Next.js route answered it.
	want := map[string]any{"outfit": map[string]any{
		"id": id, "userId": user, "name": "Dam olish", "occasion": "casual", "weatherSnapshot": weatherText, "score": 87.0,
		"reasonsJson": reasonsText, "explanation": "Yengil va qulay.", "isSaved": true,
		"createdAt": "2026-11-27T09:00:00.000Z", "updatedAt": "2026-11-27T09:00:00.000Z", "items": wantItems,
	}}
	if !reflect.DeepEqual(got.body, want) {
		t.Fatalf("got %s", got.raw)
	}
	// The row: the weather and the reasons as JSON.stringify writes them.
	row := a.rowJSON("Outfit", id)
	for column, value := range map[string]any{
		"userId": user, "name": "Dam olish", "occasion": "casual", "score": 87.0, "isSaved": true, "explanation": "Yengil va qulay.",
		"weatherSnapshot": weatherText, "reasonsJson": reasonsText,
	} {
		if row[column] != value {
			t.Errorf("stored %s: %v, want %v", column, row[column], value)
		}
	}

	// Only the items: everything else is nothing, and not saved.
	bare := a.save(m, map[string]any{"items": pieces("c-oxford", "top", "c-chinos", "bottom", "c-boots", "footwear")})
	row = a.rowJSON("Outfit", bare)
	for column, value := range map[string]any{
		"name": nil, "occasion": nil, "score": nil, "isSaved": false, "explanation": nil, "weatherSnapshot": "{}", "reasonsJson": "[]",
	} {
		if row[column] != value {
			t.Errorf("bare, stored %s: %v, want %v", column, row[column], value)
		}
	}
	// Nulls are nothing; an empty name is no name; a score is rounded.
	for score, stored := range map[float64]float64{0: 0, 0.4: 0, 0.5: 1, 99.5: 100, 100: 100, 41.49: 41} {
		odd := a.save(m, map[string]any{"items": casualPieces, "occasion": nil, "weather": nil, "name": "   ", "score": score, "explanation": nil})
		row = a.rowJSON("Outfit", odd)
		if row["name"] != nil || row["weatherSnapshot"] != "{}" || row["score"] != stored {
			t.Errorf("score %v: stored %v", score, row)
		}
	}
	if none := a.save(m, map[string]any{"items": casualPieces, "score": nil, "reasons": []string{}}); a.rowJSON("Outfit", none)["score"] != nil {
		t.Error("a null score was stored as a number")
	}
	if unsaved := a.save(m, map[string]any{"items": casualPieces, "isSaved": false}); a.rowJSON("Outfit", unsaved)["isSaved"] != false {
		t.Error("an outfit said not to be saved was stored as saved")
	}
}

func TestWhatIsNoOutfitIsNotSaved(t *testing.T) {
	t.Parallel()
	a, m, user := wearer(t, apiOptions{})
	other := a.mobileRegister(nil)
	a.insertItem(a.userID(other.email), garment("o-shirt", "shirt", "shirt", []string{"white"}, "classic", "casual", []string{"summer"}))
	a.insertItem(user, garment("c-dress", "dress", "dress", []string{"red"}, "classic", "smart_casual", []string{"summer"}))
	a.insertItem(user, garment("c-swim", "swimwear", "trunks", []string{"blue"}, "sport", "casual", []string{"summer"}))
	a.insertItem(user, garment("c-heels", "shoes", "heels", []string{"black"}, "classic", "formal", []string{"summer"}))
	for i := 1; i <= 4; i++ {
		a.insertItem(user, garment(fmt.Sprintf("c-acc%d", i), "accessory", "scarf", []string{"gray"}, "casual", "casual", []string{"winter"}))
	}

	const (
		unknownRole = "Noma’lum rol: top, bottom, shoes, accessory, dress, outerwear, footwear bo‘lishi kerak"
		notOwned    = "Ba'zi kiyimlar topilmadi yoki sizga tegishli emas"
		twice       = "Bitta kiyim outfitda ikki marta bo‘lishi mumkin emas"
	)
	cases := []struct {
		name          string
		items         []any
		status        int
		code          string
		message, path string
	}{
		// In the order the rules are applied: a role nobody has comes before everything.
		{"an unknown role, first of several mistakes", pieces("c-tee", "top", "c-jeans", "hat", "c-jeans", "cape", "o-shirt", "top"), 400, "VALIDATION_ERROR", unknownRole, "items.1.role"},
		{"a role in another case", pieces("c-tee", "Top", "c-jeans", "bottom", "c-sneakers", "shoes"), 400, "VALIDATION_ERROR", unknownRole, "items.0.role"},
		{"an item twice, before whose it is", pieces("c-tee", "top", "o-shirt", "top", "c-tee", "top"), 400, "VALIDATION_ERROR", twice, "items"},
		{"another user's item", pieces("o-shirt", "top", "c-jeans", "bottom", "c-sneakers", "shoes"), 403, "FORBIDDEN", notOwned, ""},
		{"an item that does not exist, before its role is looked at", pieces("c-tee", "bottom", "c-none", "bottom", "c-sneakers", "shoes"), 403, "FORBIDDEN", notOwned, ""},
		{"shoes as a top", pieces("c-tee", "top", "c-jeans", "bottom", "c-sneakers", "top"), 400, "VALIDATION_ERROR", "Rol kiyim turiga mos emas (shoes / footwear)", "items.2.role"},
		{"trousers as a top, the first wrong role", pieces("c-jeans", "top", "c-tee", "bottom", "c-sneakers", "shoes"), 400, "VALIDATION_ERROR", "Rol kiyim turiga mos emas (bottom)", "items.0.role"},
		{"a coat as an accessory", pieces("c-tee", "top", "c-jeans", "bottom", "c-sneakers", "shoes", "c-coat", "accessory"), 400, "VALIDATION_ERROR", "Rol kiyim turiga mos emas (top / outerwear)", "items.3.role"},
		{"a dress as a bottom", pieces("c-dress", "bottom", "c-heels", "shoes"), 400, "VALIDATION_ERROR", "Rol kiyim turiga mos emas (top / dress)", "items.0.role"},
		{"no shoes", pieces("c-tee", "top", "c-jeans", "bottom"), 400, "VALIDATION_ERROR", "Outfitda oyoq kiyim bo‘lishi kerak", "items"},
		{"two pairs of shoes", pieces("c-tee", "top", "c-jeans", "bottom", "c-sneakers", "shoes", "c-boots", "footwear"), 400, "VALIDATION_ERROR", "Outfitda bitta oyoq kiyim bo‘lishi kerak", "items"},
		{"no trousers", pieces("c-tee", "top", "c-sneakers", "shoes"), 400, "VALIDATION_ERROR", "Outfitda ustki va pastki kiyim yoki ko‘ylak (ayol) bo‘lishi kerak", "items"},
		{"a dress with a top", pieces("c-dress", "dress", "c-tee", "top", "c-heels", "shoes"), 400, "VALIDATION_ERROR", "Ko‘ylak (ayol) boshqa ustki yoki pastki kiyim bilan birga saqlanmaydi", "items"},
		{"two tops", pieces("c-tee", "top", "c-oxford", "top", "c-jeans", "bottom", "c-sneakers", "shoes"), 400, "VALIDATION_ERROR", "Har bir asosiy qismdan (ustki, pastki, ko‘ylak, ustki kiyim) bittadan bo‘lishi kerak", "items"},
		{"a kind that has no place in an outfit", pieces("c-swim", "top", "c-jeans", "bottom", "c-sneakers", "shoes"), 400, "VALIDATION_ERROR", "Kiyim turi outfit uchun mos emas", "items"},
		{"too many accessories", pieces("c-tee", "top", "c-jeans", "bottom", "c-sneakers", "shoes", "c-bag", "accessory", "c-acc1", "accessory", "c-acc2", "accessory", "c-acc3", "accessory", "c-acc4", "accessory"), 400, "VALIDATION_ERROR", "Aksessuarlar juda ko‘p", "items"},
	}
	for _, c := range cases {
		got := a.do(outfitsCall(m, http.MethodPost, "", map[string]any{"items": c.items, "isSaved": true}))
		if got.status != c.status || got.text("code") != c.code || got.text("error") != c.message {
			t.Errorf("%s: %d %s", c.name, got.status, got.raw)
			continue
		}
		var want any
		if c.path != "" {
			want = []any{map[string]any{"path": c.path, "message": c.message}}
		}
		if !reflect.DeepEqual(got.body["details"], want) {
			t.Errorf("%s: details %v, want %v", c.name, got.body["details"], want)
		}
	}
	if n := query[int](a, `SELECT count(*) FROM "Outfit"`) + query[int](a, `SELECT count(*) FROM "OutfitItem"`); n != 0 {
		t.Fatalf("%d rows were stored of outfits that were refused", n)
	}
	// What is an outfit: a dress with shoes and a coat, in the roles a dress and a coat may have.
	for _, items := range [][]any{
		pieces("c-dress", "dress", "c-heels", "footwear"),
		pieces("c-dress", "top", "c-heels", "shoes", "c-coat", "outerwear", "c-bag", "accessory"),
		pieces("c-tee", "top", "c-jeans", "bottom", "c-sneakers", "shoes", "c-coat", "top"),
	} {
		a.save(m, map[string]any{"items": items})
	}
}

func TestOutfitsAreListedNewestFirstAllOrSaved(t *testing.T) {
	t.Parallel()
	now := outfitT0.Add(time.Hour)
	a, m, user := wearer(t, apiOptions{now: func() time.Time { return now }})
	key := func(name string) string { return "wardrobe/" + user + "/" + name + ".webp" }
	a.exec(`INSERT INTO "WardrobeImage" ("id","wardrobeItemId","storageKey","thumbnailKey","displayKey","isPrimary","width","height","createdAt")
		VALUES ('i-1','c-tee',$1,$2,NULL,false,800,1000,now()), ('i-2','c-tee',$3,$4,$5,true,1200,1600,now() + interval '1 second')`,
		key("tee-old"), key("tee-old-t"), key("tee"), key("tee-t"), key("tee-d"))

	first := a.save(m, map[string]any{"items": casualPieces, "occasion": "casual", "isSaved": true, "name": "Birinchi", "score": 80,
		"weather": coldDay, "reasons": []string{"weather_fit"}, "explanation": "Sovuq kun uchun."})
	dbtest.SetClock(t, a.pool, outfitT0.Add(time.Minute))
	second := a.save(m, map[string]any{"items": pieces("c-oxford", "top", "c-chinos", "bottom", "c-boots", "shoes")})
	dbtest.SetClock(t, a.pool, outfitT0.Add(2*time.Minute))
	third := a.save(m, map[string]any{"items": pieces("c-knit", "top", "c-jeans", "bottom", "c-boots", "shoes"), "isSaved": true})
	// Another user's outfits are not this user's.
	other := a.mobileRegister(nil)
	for _, row := range closet() {
		row.ID = "o-" + row.ID
		a.insertItem(a.userID(other.email), row)
	}
	a.save(other, map[string]any{"items": pieces("o-c-tee", "top", "o-c-jeans", "bottom", "o-c-sneakers", "shoes"), "isSaved": true})

	ids := func(got answer) []string {
		var ids []string
		for _, o := range got.body["outfits"].([]any) {
			ids = append(ids, o.(map[string]any)["id"].(string))
		}
		return ids
	}
	for queryText, want := range map[string][]string{
		"": {third, second, first}, "saved=0": {third, second, first}, "saved=false": {third, second, first}, "saved=": {third, second, first},
		"saved=1": {third, first}, "saved=true": {third, first},
	} {
		got := a.do(outfitsCall(m, http.MethodGet, queryText, nil))
		if got.status != http.StatusOK || !reflect.DeepEqual(ids(got), want) {
			t.Errorf("%q: %d %v, want %v", queryText, got.status, ids(got), want)
		}
	}
	for _, queryText := range []string{"saved=yes", "saved=TRUE", "saved=2"} {
		a.is(a.do(outfitsCall(m, http.MethodGet, queryText, nil)), http.StatusBadRequest, "VALIDATION_ERROR")
	}

	// One outfit of the list, member by member.
	sign := func(k string) string {
		link, _ := a.media.Sign(k, now)
		return link
	}
	_, expires := a.media.Sign("x", now)
	garmentOf := func(id, role string, image any) map[string]any {
		for _, row := range closet() {
			if row.ID == id {
				var colors, season []any
				_ = json.Unmarshal([]byte(row.Colors), &colors)
				_ = json.Unmarshal([]byte(row.Season), &season)
				return map[string]any{
					"id": id, "role": role, "category": row.Category, "subcategory": *row.Subcategory, "colors": colors,
					"style": *row.Style, "material": *row.Material, "season": season, "image": image,
				}
			}
		}
		t.Fatalf("no garment %s", id)
		return nil
	}
	listed := a.do(outfitsCall(m, http.MethodGet, "saved=1", nil)).body["outfits"].([]any)[1]
	want := map[string]any{
		"id": first, "name": "Birinchi", "occasion": "casual", "score": 80.0, "reasons": []any{"weather_fit"}, "explanation": "Sovuq kun uchun.",
		"isSaved": true, "weatherSnapshot": coldDay, "createdAt": "2026-11-27T09:00:00.000Z",
		"items": []any{
			// The primary image, not the first; with its dimensions.
			garmentOf("c-tee", "top", map[string]any{
				"id": "i-2", "url": sign(key("tee-d")), "thumbnailUrl": sign(key("tee-t")), "urlExpiresAt": expires.Format("2006-01-02T15:04:05.000Z"),
				"isPrimary": true, "width": 1200.0, "height": 1600.0,
			}),
			garmentOf("c-jeans", "bottom", nil), garmentOf("c-sneakers", "shoes", nil), garmentOf("c-bag", "accessory", nil),
		},
	}
	if !reflect.DeepEqual(listed, want) {
		got, _ := json.Marshal(listed)
		wanted, _ := json.Marshal(want)
		t.Fatalf("the listed outfit:\n got %s\nwant %s", got, wanted)
	}
	// An outfit saved with nothing but items: no weather is an empty object, no reasons an empty list.
	bare := a.do(outfitsCall(m, http.MethodGet, "", nil)).body["outfits"].([]any)[1].(map[string]any)
	if !reflect.DeepEqual(bare["weatherSnapshot"], map[string]any{}) || !reflect.DeepEqual(bare["reasons"], []any{}) || bare["name"] != nil || bare["score"] != nil {
		t.Fatalf("the bare outfit: %v", bare)
	}

	// The fifty newest.
	a.exec(`INSERT INTO "Outfit" ("id","userId","reasonsJson","isSaved","createdAt","updatedAt")
		SELECT 'bulk-' || lpad(n::text, 2, '0'), $1, '[]', false, $2::timestamp + n * interval '1 second', $2::timestamp FROM generate_series(1, 60) n`,
		user, outfitT0.Add(time.Hour))
	page := ids(a.do(outfitsCall(m, http.MethodGet, "", nil)))
	if len(page) != 50 || page[0] != "bulk-60" || page[49] != "bulk-11" {
		t.Fatalf("%d outfits, from %s to %s", len(page), page[0], page[len(page)-1])
	}
	if saved := ids(a.do(outfitsCall(m, http.MethodGet, "saved=1", nil))); !reflect.DeepEqual(saved, []string{third, first}) {
		t.Fatalf("saved among many: %v", saved)
	}
}

func TestAnOutfitIsReadChangedAndDeletedByItsOwnerOnly(t *testing.T) {
	t.Parallel()
	now := outfitT0.Add(time.Hour)
	a, m, user := wearer(t, apiOptions{now: func() time.Time { return now }})
	key := func(name string) string { return "wardrobe/" + user + "/" + name + ".webp" }
	a.exec(`INSERT INTO "WardrobeImage" ("id","wardrobeItemId","storageKey","thumbnailKey","displayKey","isPrimary","width","height","createdAt")
		VALUES ('i-1','c-jeans',$1,NULL,NULL,false,800,1000,now()), ('i-2','c-jeans',$2,$3,$4,true,NULL,NULL,now() + interval '1 second')`,
		key("jeans-old"), key("jeans"), key("jeans-t"), key("jeans-d"))
	stored := a.do(outfitsCall(m, http.MethodPost, "", map[string]any{"items": pieces("c-jeans", "bottom", "c-tee", "top", "c-sneakers", "footwear"), "occasion": "work", "score": 71,
		"weather": coldDay, "reasons": []string{"color_harmony", "occasion_fit"}, "explanation": "Ish uchun."}))
	a.is(stored, http.StatusCreated, "")
	id := stored.text("outfit", "id")
	storedItems := stored.body["outfit"].(map[string]any)["items"].([]any)
	stranger := a.mobileRegister(nil)

	sign := func(k string) string {
		link, _ := a.media.Sign(k, now)
		return link
	}
	_, expires := a.media.Sign("x", now)
	until := expires.Format("2006-01-02T15:04:05.000Z")
	got := a.do(outfitCall(m, http.MethodGet, id, nil))
	a.is(got, http.StatusOK, "")
	detail := got.body["outfit"].(map[string]any)
	items := detail["items"].([]any)
	if len(items) != 3 {
		t.Fatalf("got %s", got.raw)
	}
	// The ids of the outfit's items are those the save answered, not the garments'.
	linkID := func(i int) string { return storedItems[i].(map[string]any)["id"].(string) }
	const (
		coldDayText = `{"temperature":3,"feelsLike":-1,"condition":"snow","precipitationProbability":70,"humidity":80,"windSpeed":20,"uvIndex":1}`
		reasonsText = `["color_harmony","occasion_fit"]`
	)
	want := map[string]any{
		"id": id, "userId": user, "name": nil, "occasion": "work", "score": 71.0, "explanation": "Ish uchun.", "isSaved": false,
		"createdAt": "2026-11-27T09:00:00.000Z", "updatedAt": "2026-11-27T09:00:00.000Z",
		// The reasons decoded beside their stored text; the weather decoded.
		"reasonsJson": reasonsText, "reasons": []any{"color_harmony", "occasion_fit"}, "weatherSnapshot": coldDay,
		// In the order they were saved in, each with all its images in the order they were added.
		"items": []any{
			map[string]any{"id": linkID(0), "role": "bottom", "wardrobeItemId": "c-jeans", "item": map[string]any{
				"id": "c-jeans", "category": "pants", "subcategory": "jeans", "colors": []any{"navy"}, "style": "casual", "material": "cotton",
				"season": []any{"spring", "summer", "autumn", "winter"},
				"images": []any{
					map[string]any{"id": "i-1", "url": sign(key("jeans-old")), "thumbnailUrl": nil, "urlExpiresAt": until, "isPrimary": false, "width": 800.0, "height": 1000.0},
					map[string]any{"id": "i-2", "url": sign(key("jeans-d")), "thumbnailUrl": sign(key("jeans-t")), "urlExpiresAt": until, "isPrimary": true, "width": nil, "height": nil},
				},
			}},
			map[string]any{"id": linkID(1), "role": "top", "wardrobeItemId": "c-tee", "item": map[string]any{
				"id": "c-tee", "category": "shirt", "subcategory": "tshirt", "colors": []any{"white"}, "style": "casual", "material": "cotton",
				"season": []any{"spring", "summer"}, "images": []any{},
			}},
			map[string]any{"id": linkID(2), "role": "footwear", "wardrobeItemId": "c-sneakers", "item": map[string]any{
				"id": "c-sneakers", "category": "shoes", "subcategory": "sneakers", "colors": []any{"white"}, "style": "casual", "material": "cotton",
				"season": []any{"spring", "summer", "autumn", "winter"}, "images": []any{},
			}},
		},
	}
	if !reflect.DeepEqual(detail, want) {
		wanted, _ := json.Marshal(want)
		t.Fatalf("the outfit:\n got %s\nwant %s", got.raw, wanted)
	}
	if strings.Contains(string(got.raw), "storageKey") {
		t.Errorf("the answer holds a storage key: %s", got.raw)
	}

	// Changes: each member alone, both, none.
	dbtest.SetClock(t, a.pool, outfitT0.Add(5*time.Minute))
	row := func(name any, saved bool, updated string) map[string]any {
		return map[string]any{"outfit": map[string]any{
			"id": id, "userId": user, "name": name, "occasion": "work", "weatherSnapshot": coldDayText, "score": 71.0,
			"reasonsJson": reasonsText, "explanation": "Ish uchun.", "isSaved": saved,
			"createdAt": "2026-11-27T09:00:00.000Z", "updatedAt": updated,
		}}
	}
	for _, c := range []struct {
		body any
		want map[string]any
	}{
		{map[string]any{"isSaved": true}, row(nil, true, "2026-11-27T09:05:00.000Z")},
		{map[string]any{"name": "  Ofis  "}, row("Ofis", true, "2026-11-27T09:05:00.000Z")},
		{map[string]any{}, row("Ofis", true, "2026-11-27T09:05:00.000Z")},
		{map[string]any{"isSaved": false, "name": "Dushanba", "explanation": "ignored"}, row("Dushanba", false, "2026-11-27T09:05:00.000Z")},
		{map[string]any{"name": nil}, row(nil, false, "2026-11-27T09:05:00.000Z")},
		{map[string]any{"name": "   "}, row("", false, "2026-11-27T09:05:00.000Z")},
	} {
		got := a.do(outfitCall(m, http.MethodPatch, id, c.body))
		if got.status != http.StatusOK || !reflect.DeepEqual(got.body, c.want) {
			t.Fatalf("patch %v: %d %s", c.body, got.status, got.raw)
		}
	}
	// A change that changes nothing still moves the row's time, as Prisma moved it.
	dbtest.SetClock(t, a.pool, outfitT0.Add(6*time.Minute))
	if got := a.do(outfitCall(m, http.MethodPatch, id, map[string]any{})); got.text("outfit", "updatedAt") != "2026-11-27T09:06:00.000Z" {
		t.Fatalf("an empty patch: %s", got.raw)
	}
	a.is(a.do(outfitCall(m, http.MethodPatch, id, map[string]any{"isSaved": "yes"})), http.StatusBadRequest, "VALIDATION_ERROR")
	a.is(a.do(outfitCall(m, http.MethodPatch, id, `{`)), http.StatusBadRequest, "BAD_REQUEST")

	// A garment removed from the wardrobe leaves the outfit.
	a.is(a.do(itemCall(m, http.MethodDelete, "c-tee", nil)), http.StatusOK, "")
	if left := a.do(outfitCall(m, http.MethodGet, id, nil)).body["outfit"].(map[string]any)["items"].([]any); len(left) != 2 {
		t.Fatalf("%d items after a garment was removed", len(left))
	}

	// White space around an id is not part of it, as the Next.js routes read ids.
	spaced := "  " + id + " "
	a.is(a.do(outfitCall(m, http.MethodGet, spaced, nil)), http.StatusOK, "")
	a.is(a.do(outfitCall(m, http.MethodPatch, spaced, map[string]any{"name": ""})), http.StatusOK, "")
	a.is(a.do(feedbackCall(m, spaced, map[string]any{"feedback": "liked"})), http.StatusCreated, "")
	a.exec(`DELETE FROM "OutfitFeedback"`)

	// Nobody else's, and nothing that is not there.
	longID := strings.Repeat("c", 65)
	for _, c := range []call{
		outfitCall(stranger, http.MethodGet, id, nil), outfitCall(stranger, http.MethodPatch, id, map[string]any{"isSaved": true}),
		outfitCall(stranger, http.MethodDelete, id, nil), feedbackCall(stranger, id, map[string]any{"feedback": "rejected"}),
		outfitCall(m, http.MethodGet, "c-none", nil), outfitCall(m, http.MethodPatch, "c-none", map[string]any{"isSaved": true}),
		outfitCall(m, http.MethodDelete, "c-none", nil), feedbackCall(m, "c-none", map[string]any{"feedback": "liked"}),
	} {
		a.is(a.do(c), http.StatusNotFound, "NOT_FOUND")
	}
	// The id is judged before the body and before the outfit is looked for.
	for _, c := range []call{
		outfitCall(m, http.MethodGet, longID, nil), outfitCall(m, http.MethodPatch, longID, `{`), outfitCall(m, http.MethodDelete, longID, nil),
		feedbackCall(m, longID, `{`), feedbackCall(m, "   ", map[string]any{"feedback": "liked"}),
	} {
		a.is(a.do(c), http.StatusBadRequest, "VALIDATION_ERROR")
	}
	if stored := a.rowJSON("Outfit", id); stored["isSaved"] != false || stored["name"] != "" || query[int](a, `SELECT count(*) FROM "OutfitFeedback"`) != 0 {
		t.Fatalf("a stranger changed the outfit: %v", stored)
	}

	// Deleted with its items and feedback; then it is not there.
	a.is(a.do(feedbackCall(m, id, map[string]any{"feedback": "liked"})), http.StatusCreated, "")
	gone := a.do(outfitCall(m, http.MethodDelete, id, nil))
	if gone.status != http.StatusOK || !reflect.DeepEqual(gone.body, map[string]any{"ok": true}) {
		t.Fatalf("delete: %d %s", gone.status, gone.raw)
	}
	for _, table := range []string{"Outfit", "OutfitItem", "OutfitFeedback"} {
		if n := query[int](a, `SELECT count(*) FROM "`+table+`"`); n != 0 {
			t.Errorf("%d rows left in %s", n, table)
		}
	}
	a.is(a.do(outfitCall(m, http.MethodDelete, id, nil)), http.StatusNotFound, "NOT_FOUND")
	if n := query[int](a, `SELECT count(*) FROM "WardrobeItem" WHERE "userId" = $1`, user); n != len(closet())-1 {
		t.Errorf("deleting an outfit touched the wardrobe: %d items", n)
	}
}

func TestFeedbackIsRecordedAndSavesOrUnsaves(t *testing.T) {
	t.Parallel()
	a, m, user := wearer(t, apiOptions{})
	id := a.save(m, map[string]any{"items": casualPieces})
	saved := func() bool { return a.rowJSON("Outfit", id)["isSaved"].(bool) }

	// changed: the minute the outfit's row was last changed at (its
	// updatedAt): feedback changes the outfit only when it changes whether
	// it is saved.
	steps := []struct {
		body      map[string]any
		note      any
		wantSaved bool
		changed   int
	}{
		{map[string]any{"feedback": "liked"}, nil, false, 0},
		{map[string]any{"feedback": "saved", "note": "  juda yoqdi  "}, "juda yoqdi", true, 2},
		{map[string]any{"feedback": "saved"}, nil, true, 2},
		{map[string]any{"feedback": "disliked", "note": ""}, "", true, 2},
		{map[string]any{"feedback": "liked"}, nil, true, 2},
		{map[string]any{"feedback": "rejected", "note": "rangi yoqmadi"}, "rangi yoqmadi", false, 6},
		{map[string]any{"feedback": "rejected"}, nil, false, 6},
	}
	for i, step := range steps {
		dbtest.SetClock(t, a.pool, outfitT0.Add(time.Duration(i+1)*time.Minute))
		got := a.do(feedbackCall(m, id, step.body))
		a.is(got, http.StatusCreated, "")
		feedback := got.body["feedback"].(map[string]any)
		want := map[string]any{"feedback": map[string]any{
			"id": feedback["id"], "userId": user, "outfitId": id, "feedback": step.body["feedback"], "note": step.note,
			"createdAt": fmt.Sprintf("2026-11-27T09:%02d:00.000Z", i+1),
		}}
		if !cuidShape.MatchString(feedback["id"].(string)) || !reflect.DeepEqual(got.body, want) {
			t.Fatalf("step %d: %s", i, got.raw)
		}
		if saved() != step.wantSaved {
			t.Fatalf("step %d (%v): saved is %t", i, step.body, saved())
		}
		if updated := a.rowJSON("Outfit", id)["updatedAt"]; updated != fmt.Sprintf("2026-11-27T09:%02d:00", step.changed) {
			t.Fatalf("step %d (%v): the outfit's updatedAt is %v", i, step.body, updated)
		}
		if row := a.rowJSON("OutfitFeedback", feedback["id"].(string)); row["userId"] != user || row["note"] != step.note {
			t.Fatalf("step %d: stored %v", i, row)
		}
	}
	if n := query[int](a, `SELECT count(*) FROM "OutfitFeedback" WHERE "outfitId" = $1`, id); n != len(steps) {
		t.Fatalf("%d feedback rows", n)
	}
	for _, body := range []any{map[string]any{}, map[string]any{"feedback": "loved"}, map[string]any{"feedback": "liked", "note": strings.Repeat("x", 501)}} {
		a.is(a.do(feedbackCall(m, id, body)), http.StatusBadRequest, "VALIDATION_ERROR")
	}

	// The feedback and what it does to the outfit are one change: when the
	// outfit cannot be changed, the feedback is not recorded.
	a.exec(`CREATE FUNCTION refuse_outfits() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'no changes today'; END $$;
		CREATE TRIGGER refuse_outfits BEFORE UPDATE ON "Outfit" FOR EACH ROW EXECUTE FUNCTION refuse_outfits();`)
	a.is(a.do(feedbackCall(m, id, map[string]any{"feedback": "saved"})), http.StatusInternalServerError, "INTERNAL")
	if n := query[int](a, `SELECT count(*) FROM "OutfitFeedback" WHERE "outfitId" = $1`, id); n != len(steps) {
		t.Fatalf("%d feedback rows after a change that failed", n)
	}
}

func TestOutfitRoutesNeedASessionAndConsentBeforeAnythingElse(t *testing.T) {
	t.Parallel()
	a, m, _ := wearer(t, apiOptions{})
	id := a.save(m, map[string]any{"items": casualPieces})
	longID := strings.Repeat("c", 65)
	requests := []call{
		outfitsCall(m, http.MethodGet, "", nil), outfitsCall(m, http.MethodGet, "saved=yes", nil),
		outfitsCall(m, http.MethodPost, "", map[string]any{"items": casualPieces}), outfitsCall(m, http.MethodPost, "", `{`),
		outfitCall(m, http.MethodGet, id, nil), outfitCall(m, http.MethodGet, longID, nil),
		outfitCall(m, http.MethodPatch, id, map[string]any{"isSaved": true}), outfitCall(m, http.MethodPatch, longID, `{`),
		outfitCall(m, http.MethodDelete, id, nil), outfitCall(m, http.MethodDelete, "c-none", nil),
		feedbackCall(m, id, map[string]any{"feedback": "saved"}), feedbackCall(m, longID, `{`),
	}
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
	if n := query[int](a, `SELECT count(*) FROM "Outfit"`) + query[int](a, `SELECT count(*) FROM "OutfitFeedback"`); n != 1 || a.rowJSON("Outfit", id)["isSaved"] != false {
		t.Fatal("a refused request changed something")
	}
}

func TestAStoredOutfitThatIsNotWhatWeWriteIsAnInternalError(t *testing.T) {
	t.Parallel()
	a, m, _ := wearer(t, apiOptions{})
	id := a.save(m, map[string]any{"items": casualPieces})
	breakages := map[string]string{
		`UPDATE "Outfit" SET "reasonsJson" = 'not json' WHERE "id" = $1`:             `UPDATE "Outfit" SET "reasonsJson" = '[]' WHERE "id" = $1`,
		`UPDATE "Outfit" SET "reasonsJson" = '{"a":1}' WHERE "id" = $1`:              `UPDATE "Outfit" SET "reasonsJson" = '[]' WHERE "id" = $1`,
		`UPDATE "Outfit" SET "reasonsJson" = 'null' WHERE "id" = $1`:                 `UPDATE "Outfit" SET "reasonsJson" = '[]' WHERE "id" = $1`,
		`UPDATE "Outfit" SET "weatherSnapshot" = '[1]' WHERE "id" = $1`:              `UPDATE "Outfit" SET "weatherSnapshot" = '{}' WHERE "id" = $1`,
		`UPDATE "Outfit" SET "weatherSnapshot" = 'null' WHERE "id" = $1`:             `UPDATE "Outfit" SET "weatherSnapshot" = '{}' WHERE "id" = $1`,
		`UPDATE "WardrobeItem" SET "colors" = 'x' WHERE "id" = 'c-tee' AND $1 <> ''`: `UPDATE "WardrobeItem" SET "colors" = '[]' WHERE "id" = 'c-tee' AND $1 <> ''`,
		`UPDATE "WardrobeItem" SET "season" = '7' WHERE "id" = 'c-bag' AND $1 <> ''`: `UPDATE "WardrobeItem" SET "season" = '[]' WHERE "id" = 'c-bag' AND $1 <> ''`,
	}
	for breakIt, mend := range breakages {
		a.exec(breakIt, id)
		a.is(a.do(outfitCall(m, http.MethodGet, id, nil)), http.StatusInternalServerError, "INTERNAL")
		a.is(a.do(outfitsCall(m, http.MethodGet, "", nil)), http.StatusInternalServerError, "INTERNAL")
		a.exec(mend, id)
		a.is(a.do(outfitCall(m, http.MethodGet, id, nil)), http.StatusOK, "")
	}
	// Rows of before the weather was stored: nothing, or an empty text, is no weather.
	for _, none := range []string{`UPDATE "Outfit" SET "weatherSnapshot" = NULL WHERE "id" = $1`, `UPDATE "Outfit" SET "weatherSnapshot" = '' WHERE "id" = $1`} {
		a.exec(none, id)
		got := a.do(outfitCall(m, http.MethodGet, id, nil))
		if got.status != http.StatusOK || !reflect.DeepEqual(got.body["outfit"].(map[string]any)["weatherSnapshot"], map[string]any{}) {
			t.Fatalf("no stored weather: %d %s", got.status, got.raw)
		}
	}
}
