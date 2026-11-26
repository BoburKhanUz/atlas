//go:build integration

package httpapi_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"lookly/internal/dbtest"
	"lookly/internal/golden"
	"lookly/internal/media"
	"lookly/internal/storage"
	"lookly/internal/wardrobe"
)

const itemsPath = "/api/v1/wardrobe/items"

// itemCall is a request to one item, by the caller of the session.
func itemCall(m mobileSession, method, id string, body any) call {
	return call{method: method, path: itemsPath + "/" + url.PathEscape(id), contract: itemsPath + "/{id}", mobile: true, bearer: m.accessToken, body: body}
}

func listCall(m mobileSession, query string) call {
	path := itemsPath
	if query != "" {
		path += "?" + query
	}
	return call{method: http.MethodGet, path: path, contract: itemsPath, mobile: true, bearer: m.accessToken}
}

func ptr[T any](v T) *T { return &v }

// plainRow is a shirt with nothing unusual.
func plainRow(id string) golden.WardrobeRow {
	return golden.WardrobeRow{
		ID: id, Category: "shirt", Subcategory: ptr("tshirt"), Colors: `["white","navy"]`, Pattern: ptr("solid"),
		Material: ptr("cotton"), SleeveLength: ptr("short"), Fit: ptr("regular"), Style: ptr("casual"),
		Season: `["spring","summer"]`, Gender: ptr("unisex"), Formality: ptr("casual"),
		Confidences: `{"category":0.95}`, CorrectionLog: `[]`,
		CreatedAt: "2026-11-20T07:00:00.000Z", UpdatedAt: "2026-11-20T07:00:00.000Z",
	}
}

// insertItem stores an item row (and its image rows) for the user.
func (a *api) insertItem(userID string, row golden.WardrobeRow) {
	a.t.Helper()
	for _, text := range []*string{&row.Confidences, &row.CorrectionLog} {
		if *text == "" {
			*text = map[bool]string{true: "{}", false: "[]"}[text == &row.Confidences]
		}
	}
	for _, at := range []*string{&row.CreatedAt, &row.UpdatedAt} {
		if *at == "" {
			*at = "2026-11-20T07:00:00.000Z"
		}
	}
	a.exec(`INSERT INTO "WardrobeItem" ("id","userId","category","subcategory","colors","pattern","material","sleeveLength","fit","style",
		"season","gender","formality","confidences","wasCorrected","correctionLog","analysisProvider","createdAt","updatedAt")
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::timestamptz AT TIME ZONE 'UTC',$19::timestamptz AT TIME ZONE 'UTC')`,
		row.ID, userID, row.Category, row.Subcategory, row.Colors, row.Pattern, row.Material, row.SleeveLength, row.Fit, row.Style,
		row.Season, row.Gender, row.Formality, row.Confidences, row.WasCorrected, row.CorrectionLog, row.AnalysisProvider, row.CreatedAt, row.UpdatedAt)
	for _, img := range row.Images {
		a.exec(`INSERT INTO "WardrobeImage" ("id","wardrobeItemId","storageKey","thumbnailKey","displayKey","isPrimary","width","height","mimeType","bytes","sha256","createdAt")
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::timestamptz AT TIME ZONE 'UTC')`,
			img.ID, row.ID, img.StorageKey, img.ThumbnailKey, img.DisplayKey, img.IsPrimary, img.Width, img.Height, img.MimeType, img.Bytes, img.Sha256, img.CreatedAt)
	}
}

// storedItem is the item's row as JSON (lists as their stored text).
func (a *api) storedItem(id string) map[string]any {
	a.t.Helper()
	raw := query[[]byte](a, `SELECT to_jsonb(i) FROM "WardrobeItem" i WHERE "id" = $1`, id)
	var row map[string]any
	if err := json.Unmarshal(raw, &row); err != nil {
		a.t.Fatal(err)
	}
	return row
}

func (a *api) itemCount(id string) int {
	a.t.Helper()
	return query[int](a, `SELECT count(*) FROM "WardrobeItem" WHERE "id" = $1`, id)
}

// The corrections the Next.js route makes of a stored item and a body, case
// by case: what is logged, in which order, and what is written.
func TestWardrobeCorrectionsAreTheNextServers(t *testing.T) {
	t.Parallel()
	// The links are signed by a clock that stands still: an item answered
	// twice carries the same links however long the test takes.
	signedAt := time.Now()
	a := newAPI(t, apiOptions{now: func() time.Time { return signedAt }})
	m := a.mobileRegister(nil)
	user := a.userID(m.email)
	g := golden.LoadWardrobe(t)
	at, err := time.Parse(time.RFC3339, g.At)
	if err != nil {
		t.Fatal(err)
	}
	dbtest.SetClock(t, a.pool, at)
	t.Cleanup(func() { dbtest.SetClock(t, a.pool, time.Time{}) })

	for i, c := range g.Corrections {
		t.Run(c.Name, func(t *testing.T) {
			id := fmt.Sprintf("ccorrect%d", i)
			row := c.Current
			row.ID = id
			row.CorrectionLog = g.ExistingLog
			a.insertItem(user, row)
			before := a.storedItem(id)

			got := a.do(itemCall(m, http.MethodPatch, id, string(c.Body)))
			if c.Mismatch {
				a.is(got, http.StatusBadRequest, "VALIDATION_ERROR")
				if got.text("error") != "Bu tur tanlangan toifaga mos emas" || !strings.Contains(string(got.raw), `"path":"subcategory"`) {
					t.Errorf("refusal: %s", got.raw)
				}
				if !reflect.DeepEqual(a.storedItem(id), before) {
					t.Error("a refused correction changed the row")
				}
				return
			}
			a.is(got, http.StatusOK, "")

			var body struct {
				Item        map[string]any `json:"item"`
				Corrections []struct{ Field, From, To, At string }
			}
			if err := json.Unmarshal(got.raw, &body); err != nil {
				t.Fatal(err)
			}
			if len(body.Corrections) != len(c.Corrections) {
				t.Fatalf("corrections %+v, want %+v", body.Corrections, c.Corrections)
			}
			for j, want := range c.Corrections {
				if made := body.Corrections[j]; made.Field != want.Field || made.From != want.From || made.To != want.To || made.At != g.At {
					t.Errorf("correction %d: %+v, want %+v at %s", j, made, want, g.At)
				}
			}

			after := a.storedItem(id)
			want := map[string]any{}
			for k, v := range before {
				want[k] = v
			}
			for column, value := range c.Update {
				if value == nil {
					want[column] = nil
				} else {
					want[column] = *value
				}
			}
			if (c.StoredLog != nil) != (len(c.Corrections) > 0) {
				t.Fatalf("golden case: a stored log for %d corrections", len(c.Corrections))
			}
			if c.StoredLog != nil {
				// The log as the Next.js route stores it, to the byte: the
				// entries that were there as they were, then the new ones.
				want["correctionLog"] = *c.StoredLog
				want["wasCorrected"] = true
				want["updatedAt"] = strings.TrimSuffix(g.At, "Z")
			}
			if !reflect.DeepEqual(after, want) {
				t.Errorf("stored row\n got %v\nwant %v", after, want)
			}
			if (len(c.Update) == 0) != (len(c.Corrections) == 0) {
				t.Fatalf("golden case: %d columns written for %d corrections", len(c.Update), len(c.Corrections))
			}

			// The answer's item is the item as it now reads.
			read := a.do(itemCall(m, http.MethodGet, id, nil))
			a.is(read, http.StatusOK, "")
			if !reflect.DeepEqual(read.body["item"], got.body["item"]) || body.Item["wasCorrected"] != (len(c.Corrections) > 0) {
				t.Errorf("the answer's item %v, read back %v", got.body["item"], read.body["item"])
			}
		})
	}
}

// An item is answered in the Next.js serializer's shape, links included:
// the same JSON for the same rows, secret, clock and settings.
func TestWardrobeItemsAreSerializedAsTheNextServerDoes(t *testing.T) {
	t.Parallel()
	g := golden.LoadWardrobe(t)
	now := time.UnixMilli(g.Now)
	type setting struct {
		base string
		ttl  int
	}
	servers := map[setting]*api{}
	sessions := map[setting]mobileSession{}
	for _, c := range g.Serialized {
		s := setting{ttl: c.TTLSeconds}
		if c.PublicBaseURL != nil {
			s.base = *c.PublicBaseURL
		}
		a, started := servers[s]
		if !started {
			a = newAPI(t, apiOptions{
				media: media.NewSigner([]byte(g.SigningSecret), time.Duration(s.ttl)*time.Second, s.base),
				now:   func() time.Time { return now },
			})
			servers[s], sessions[s] = a, a.mobileRegister(nil)
		}
		m := sessions[s]
		a.exec(`DELETE FROM "WardrobeItem" WHERE "id" = $1`, c.Row.ID)
		a.insertItem(a.userID(m.email), c.Row)

		var want, read, listed any
		if err := json.Unmarshal([]byte(c.JSON), &want); err != nil {
			t.Fatal(err)
		}
		got := a.do(itemCall(m, http.MethodGet, c.Row.ID, nil))
		a.is(got, http.StatusOK, "")
		read = got.body["item"]
		if !reflect.DeepEqual(read, want) {
			t.Errorf("%s (base %q, ttl %d):\n got %s\nwant %s", c.Name, s.base, s.ttl, got.raw, c.JSON)
		}
		// The list answers the same item.
		list := a.do(listCall(m, ""))
		a.is(list, http.StatusOK, "")
		if items, _ := list.body["items"].([]any); len(items) == 1 {
			listed = items[0]
		}
		if !reflect.DeepEqual(listed, want) || list.body["nextCursor"] != nil {
			t.Errorf("%s: listed as %s", c.Name, list.raw)
		}
	}
	if len(servers) != 4 {
		t.Fatalf("%d settings in the golden file, want 4", len(servers))
	}
}

// ids of the items of a list answer, in its order.
func listedIDs(t *testing.T, got answer) []string {
	t.Helper()
	items, ok := got.body["items"].([]any)
	if !ok {
		t.Fatalf("no items in %s", got.raw)
	}
	ids := []string{}
	for _, item := range items {
		ids = append(ids, item.(map[string]any)["id"].(string))
	}
	return ids
}

func TestWardrobeListPagesNewestFirstAndOnlyTheCallersItems(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{})
	m, other := a.mobileRegister(nil), a.mobileRegister(nil)
	user, stranger := a.userID(m.email), a.userID(other.email)

	// Newest first; items made in the same millisecond by id, highest first.
	add := func(owner, id, category, createdAt string) {
		row := plainRow(id)
		row.Category, row.Subcategory, row.CreatedAt = category, nil, createdAt
		a.insertItem(owner, row)
	}
	add(user, "c-old", "shirt", "2026-11-01T10:00:00.000Z")
	add(user, "c-tie-a", "pants", "2026-11-02T10:00:00.000Z")
	add(user, "c-tie-b", "shirt", "2026-11-02T10:00:00.000Z")
	add(user, "c-tie-c", "shoes", "2026-11-02T10:00:00.000Z")
	add(user, "c-new", "shirt", "2026-11-03T10:00:00.001Z")
	add(user, "c-newer", "pants", "2026-11-03T10:00:00.002Z")
	add(stranger, "c-theirs", "shirt", "2026-11-02T12:00:00.000Z")
	all := []string{"c-newer", "c-new", "c-tie-c", "c-tie-b", "c-tie-a", "c-old"}
	// Images belong to their own item, in the order they were added.
	for image, item := range map[string]string{"cimg-new-a": "c-new", "cimg-new-b": "c-new", "cimg-old": "c-old", "cimg-theirs": "c-theirs"} {
		a.exec(`INSERT INTO "WardrobeImage" ("id","wardrobeItemId","storageKey","isPrimary","createdAt")
			VALUES ($1, $2, 'users/x/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d.jpg', $3, timestamp '2026-11-03 10:00:00' + $4 * interval '1 second')`,
			image, item, image == "cimg-new-a", map[bool]int{true: 2, false: 1}[image == "cimg-new-a"])
	}
	listed := a.do(listCall(m, ""))
	a.is(listed, http.StatusOK, "")
	wantImages := map[string][]string{"c-new": {"cimg-new-b", "cimg-new-a"}, "c-old": {"cimg-old"}}
	for _, item := range listed.body["items"].([]any) {
		item := item.(map[string]any)
		ids := []string{}
		for _, img := range item["images"].([]any) {
			ids = append(ids, img.(map[string]any)["id"].(string))
		}
		id := item["id"].(string)
		if !slices.Equal(ids, append([]string{}, wantImages[id]...)) {
			t.Errorf("images of %s: %v, want %v", id, ids, wantImages[id])
		}
		primary, _ := item["primaryImage"].(map[string]any)
		if want := map[string]any{"c-new": "cimg-new-a", "c-old": "cimg-old"}[id]; (primary == nil) != (want == nil) || (primary != nil && primary["id"] != want) {
			t.Errorf("primary image of %s: %v, want %v", id, primary, want)
		}
	}

	list := func(query string) answer {
		t.Helper()
		got := a.do(listCall(m, query))
		a.is(got, http.StatusOK, "")
		return got
	}
	for query, want := range map[string][]string{
		"":                  all,
		"category=all":      all,
		"category=":         all, // empty is absent
		"category=shirt":    {"c-new", "c-tie-b", "c-old"},
		"category=pants":    {"c-newer", "c-tie-a"},
		"category=dress":    {},
		"limit=200":         all,
		"limit=6":           all,
		"category=shirt&x=": {"c-new", "c-tie-b", "c-old"}, // unknown parameters are ignored
	} {
		got := list(query)
		if ids := listedIDs(t, got); !slices.Equal(ids, want) || got.body["nextCursor"] != nil {
			t.Errorf("?%s: %v (next %v), want %v", query, ids, got.body["nextCursor"], want)
		}
	}

	// Page by page: every item once, in order; the cursor is the id of the
	// last item, and the last page has none.
	for _, size := range []int{1, 2, 4, 5} {
		var seen []string
		cursor := ""
		for pages := 0; ; pages++ {
			if pages > len(all) {
				t.Fatalf("limit %d: the pages do not end", size)
			}
			query := fmt.Sprintf("limit=%d", size)
			if cursor != "" {
				query += "&cursor=" + cursor
			}
			got := list(query)
			ids := listedIDs(t, got)
			seen = append(seen, ids...)
			next, more := got.body["nextCursor"].(string)
			if !more {
				break
			}
			if len(ids) != size || next != ids[len(ids)-1] {
				t.Fatalf("limit %d: a page of %v with next %q", size, ids, next)
			}
			cursor = next
		}
		if !slices.Equal(seen, all) {
			t.Errorf("limit %d: pages give %v, want %v", size, seen, all)
		}
	}
	// With a category, the pages hold that category only.
	first := list("category=shirt&limit=2")
	if ids := listedIDs(t, first); !slices.Equal(ids, []string{"c-new", "c-tie-b"}) || first.body["nextCursor"] != "c-tie-b" {
		t.Errorf("first shirt page: %s", first.raw)
	}
	if ids := listedIDs(t, list("category=shirt&limit=2&cursor=c-tie-b")); !slices.Equal(ids, []string{"c-old"}) {
		t.Errorf("second shirt page: %v", ids)
	}

	// A cursor that is not an item of the caller's: an empty last page,
	// whether the id is unknown or another user's item.
	for _, cursor := range []string{"c-unknown", "c-theirs"} {
		got := list("cursor=" + cursor)
		if ids := listedIDs(t, got); len(ids) != 0 || got.body["nextCursor"] != nil {
			t.Errorf("cursor %s: %s", cursor, got.raw)
		}
	}
	// A cursor of the caller's in another category gives its position:
	// the items of the category after it. (The Next.js server dropped one
	// more item there; no client sends such a cursor.)
	if ids := listedIDs(t, list("category=shirt&cursor=c-tie-c")); !slices.Equal(ids, []string{"c-tie-b", "c-old"}) {
		t.Errorf("a cursor of another category: %v", ids)
	}
	// The cursor is trimmed, as the Next.js server read it.
	if ids := listedIDs(t, list("limit=1&cursor=%20c-newer%20")); !slices.Equal(ids, []string{"c-new"}) {
		t.Errorf("a cursor with spaces: %v", ids)
	}

	// The other user sees their own item only.
	theirs := a.do(listCall(other, ""))
	a.is(theirs, http.StatusOK, "")
	if ids := listedIDs(t, theirs); !slices.Equal(ids, []string{"c-theirs"}) {
		t.Errorf("the other user's list: %v", ids)
	}

	// A query that does not fit is refused, by the rules of the golden
	// cases (wardrobe_rules_test.go); here, that the route applies them.
	for _, query := range []string{"category=hat", "limit=0", "limit=201", "limit=1.5", "limit=abc", "cursor=" + strings.Repeat("c", 65)} {
		a.is(a.do(listCall(m, query)), http.StatusBadRequest, "VALIDATION_ERROR")
	}
}

func TestWardrobeListDefaultsToAHundredItems(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{})
	m := a.mobileRegister(nil)
	a.exec(`INSERT INTO "WardrobeItem" ("id","userId","category","createdAt","updatedAt")
		SELECT 'cmany' || lpad(n::text, 3, '0'), $1, 'shirt', timestamp '2026-11-01 00:00:00' + n * interval '1 second', timestamp '2026-11-01 00:00:00'
		  FROM generate_series(1, 101) n`, a.userID(m.email))
	got := a.do(listCall(m, ""))
	a.is(got, http.StatusOK, "")
	ids := listedIDs(t, got)
	if len(ids) != 100 || ids[0] != "cmany101" || ids[99] != "cmany002" || got.body["nextCursor"] != "cmany002" {
		t.Fatalf("%d items, first %s, next %v", len(ids), ids[0], got.body["nextCursor"])
	}
	rest := a.do(listCall(m, "cursor=cmany002"))
	if ids := listedIDs(t, rest); !slices.Equal(ids, []string{"cmany001"}) || rest.body["nextCursor"] != nil {
		t.Fatalf("the last page: %s", rest.raw)
	}
	// 200 is the most a page holds.
	if ids := listedIDs(t, a.do(listCall(m, "limit=200"))); len(ids) != 101 {
		t.Fatalf("limit=200 gives %d items", len(ids))
	}
}

// Who may call the wardrobe routes, and in which order a request is judged:
// the session and the consent before anything about the request itself.
func TestWardrobeRoutesNeedASessionAndConsentBeforeAnythingElse(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{})
	m := a.mobileRegister(nil)
	a.insertItem(a.userID(m.email), plainRow("c-mine"))
	longID := strings.Repeat("c", 65)

	requests := []call{
		listCall(m, ""),
		listCall(m, "limit=0"),
		itemCall(m, http.MethodGet, "c-mine", nil),
		itemCall(m, http.MethodGet, longID, nil),
		itemCall(m, http.MethodPatch, "c-mine", map[string]any{"fit": "slim"}),
		itemCall(m, http.MethodPatch, "c-mine", `{"fit":"huge"}`),
		itemCall(m, http.MethodPatch, longID, `not json`),
		itemCall(m, http.MethodDelete, "c-mine", nil),
		itemCall(m, http.MethodDelete, longID, nil),
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
	if a.itemCount("c-mine") != 1 || a.storedItem("c-mine")["fit"] != "regular" {
		t.Fatal("a refused request changed the item")
	}
}

func TestWardrobeItemsOfAnotherUserDoNotExist(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{})
	m, other := a.mobileRegister(nil), a.mobileRegister(nil)
	key := "users/" + a.userID(other.email) + "/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
	theirs := plainRow("c-theirs")
	theirs.Images = []golden.WardrobeImageRow{{ID: "cimg-theirs", StorageKey: key + ".jpg", DisplayKey: ptr(key + "_display.webp"), ThumbnailKey: ptr(key + "_thumb.webp"), IsPrimary: true, CreatedAt: "2026-11-20T07:00:00.000Z"}}
	a.insertItem(a.userID(other.email), theirs)
	for _, k := range []string{key + ".jpg", key + "_display.webp", key + "_thumb.webp"} {
		if err := a.images.Put(context.Background(), k, []byte(k)); err != nil {
			t.Fatal(err)
		}
	}
	before := a.storedItem("c-theirs")

	for _, id := range []string{"c-theirs", "c-nothing"} {
		a.is(a.do(itemCall(m, http.MethodGet, id, nil)), http.StatusNotFound, "NOT_FOUND")
		a.is(a.do(itemCall(m, http.MethodPatch, id, map[string]any{"fit": "slim"})), http.StatusNotFound, "NOT_FOUND")
		// Not even a correction that could not be made says more.
		a.is(a.do(itemCall(m, http.MethodPatch, id, map[string]any{"subcategory": "jeans"})), http.StatusNotFound, "NOT_FOUND")
		a.is(a.do(itemCall(m, http.MethodDelete, id, nil)), http.StatusNotFound, "NOT_FOUND")
	}
	if !reflect.DeepEqual(a.storedItem("c-theirs"), before) {
		t.Error("another user's item changed")
	}
	for _, k := range []string{key + ".jpg", key + "_display.webp", key + "_thumb.webp"} {
		if _, err := a.images.Get(context.Background(), k); err != nil {
			t.Errorf("another user's file %s: %v", k, err)
		}
	}
	// Its owner reads, corrects and deletes it.
	a.is(a.do(itemCall(other, http.MethodGet, "c-theirs", nil)), http.StatusOK, "")
	a.is(a.do(itemCall(other, http.MethodPatch, "c-theirs", map[string]any{"fit": "slim"})), http.StatusOK, "")
	a.is(a.do(itemCall(other, http.MethodDelete, "c-theirs", nil)), http.StatusOK, "")
}

// The id in the path is judged as the Next.js routes judge it: before the
// body, trimmed, at most 64 characters.
func TestWardrobeItemIDRules(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{})
	m := a.mobileRegister(nil)
	a.insertItem(a.userID(m.email), plainRow("c-mine"))
	longID := strings.Repeat("c", 65)

	for _, method := range []string{http.MethodGet, http.MethodPatch, http.MethodDelete} {
		var body any
		if method == http.MethodPatch {
			body = `{"fit":"huge"}` // refused too, but the id comes first
		}
		got := a.do(itemCall(m, method, longID, body))
		a.is(got, http.StatusBadRequest, "VALIDATION_ERROR")
		if !strings.Contains(string(got.raw), `"path":"id"`) {
			t.Errorf("%s: the refusal is not about the id: %s", method, got.raw)
		}
		// Sixty-four characters are an id like any other.
		a.is(a.do(itemCall(m, method, longID[:64], map[bool]any{true: map[string]any{}, false: nil}[method == http.MethodPatch])), http.StatusNotFound, "NOT_FOUND")
	}
	// White space around the id is not part of it.
	got := a.do(itemCall(m, http.MethodGet, " c-mine ", nil))
	a.is(got, http.StatusOK, "")
	if got.text("item", "id") != "c-mine" {
		t.Errorf("read %s", got.raw)
	}
	a.is(a.do(itemCall(m, http.MethodPatch, " c-mine\t", map[string]any{"fit": "slim"})), http.StatusOK, "")
	if a.storedItem("c-mine")["fit"] != "slim" {
		t.Error("the correction through a padded id was not made")
	}
	a.insertItem(a.userID(m.email), plainRow("c-padded"))
	a.is(a.do(itemCall(m, http.MethodDelete, "\tc-padded ", nil)), http.StatusOK, "")
	if a.itemCount("c-padded") != 0 {
		t.Error("the item deleted through a padded id is still there")
	}
	// An id of white space only is no id.
	a.is(a.do(itemCall(m, http.MethodGet, "  ", nil)), http.StatusBadRequest, "VALIDATION_ERROR")
	// A body that does not fit is refused when the id does.
	a.is(a.do(itemCall(m, http.MethodPatch, "c-mine", `{"fit":"huge"}`)), http.StatusBadRequest, "VALIDATION_ERROR")
	a.is(a.do(itemCall(m, http.MethodPatch, "c-mine", `{"fit":`)), http.StatusBadRequest, "BAD_REQUEST")
}

func TestWardrobeCorrectionThatChangesNothingWritesNothing(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{})
	m := a.mobileRegister(nil)
	a.insertItem(a.userID(m.email), plainRow("c-mine"))
	before := a.storedItem("c-mine")
	for _, body := range []any{
		map[string]any{},
		map[string]any{"fit": "regular", "colors": []string{"white", "navy"}, "category": "shirt"},
	} {
		got := a.do(itemCall(m, http.MethodPatch, "c-mine", body))
		a.is(got, http.StatusOK, "")
		if corrections, ok := got.body["corrections"].([]any); !ok || len(corrections) != 0 {
			t.Errorf("corrections: %s", got.raw)
		}
		if got.body["item"].(map[string]any)["wasCorrected"] != false {
			t.Errorf("marked corrected: %s", got.raw)
		}
	}
	if !reflect.DeepEqual(a.storedItem("c-mine"), before) {
		t.Errorf("the row changed: %v", a.storedItem("c-mine"))
	}
}

// Corrections of one item at the same time: each is logged, none loses
// another's entry or column.
func TestWardrobeConcurrentCorrectionsAllCount(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{})
	m := a.mobileRegister(nil)
	a.insertItem(a.userID(m.email), plainRow("c-mine"))
	changes := map[string]any{
		"pattern": "striped", "material": "linen", "sleeveLength": "long", "fit": "slim",
		"style": "formal", "gender": "male", "formality": "formal", "colors": []string{"black"},
	}
	var wg sync.WaitGroup
	for field, value := range changes {
		wg.Add(1)
		go func() {
			defer wg.Done()
			got := a.do(itemCall(m, http.MethodPatch, "c-mine", map[string]any{field: value}))
			if got.status != http.StatusOK {
				t.Errorf("%s: %d %s", field, got.status, got.raw)
			}
		}()
	}
	wg.Wait()
	row := a.storedItem("c-mine")
	var log []struct{ Field string }
	if err := json.Unmarshal([]byte(row["correctionLog"].(string)), &log); err != nil {
		t.Fatal(err)
	}
	var logged []string
	for _, entry := range log {
		logged = append(logged, entry.Field)
	}
	slices.Sort(logged)
	want := []string{"colors", "fit", "formality", "gender", "material", "pattern", "sleeveLength", "style"}
	if !slices.Equal(logged, want) {
		t.Errorf("logged %v, want %v", logged, want)
	}
	if row["pattern"] != "striped" || row["material"] != "linen" || row["fit"] != "slim" || row["colors"] != `["black"]` || row["formality"] != "formal" {
		t.Errorf("a column was lost: %v", row)
	}
}

func TestWardrobeDeleteRemovesTheItemItsRowsAndItsFiles(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{})
	m := a.mobileRegister(nil)
	user := a.userID(m.email)
	base := "users/" + user + "/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
	kept := "users/" + user + "/ffffffff-4e5f-4a6b-8c7d-9e0f1a2b3c4d"

	gone := plainRow("c-gone")
	gone.Images = []golden.WardrobeImageRow{
		{ID: "cimg1", StorageKey: base + ".jpg", DisplayKey: ptr(base + "_display.webp"), ThumbnailKey: ptr(base + "_thumb.webp"), IsPrimary: true, CreatedAt: "2026-11-20T07:00:00.000Z"},
		// From before the variants: a master and an old thumbnail only.
		{ID: "cimg2", StorageKey: base + ".png", ThumbnailKey: ptr(base + "_thumb.jpg"), CreatedAt: "2026-11-20T07:00:01.000Z"},
	}
	stays := plainRow("c-stays")
	stays.Images = []golden.WardrobeImageRow{{ID: "cimg3", StorageKey: kept + ".jpg", DisplayKey: ptr(kept + "_display.webp"), IsPrimary: true, CreatedAt: "2026-11-20T07:00:00.000Z"}}
	a.insertItem(user, gone)
	a.insertItem(user, stays)
	removed := []string{base + ".jpg", base + "_display.webp", base + "_thumb.webp", base + ".png", base + "_thumb.jpg"}
	remaining := []string{kept + ".jpg", kept + "_display.webp"}
	for _, key := range append(slices.Clone(removed), remaining...) {
		if err := a.images.Put(context.Background(), key, []byte("image")); err != nil {
			t.Fatal(err)
		}
	}
	// An outfit that holds the item loses that entry and stays.
	a.exec(`INSERT INTO "Outfit" ("id","userId","updatedAt") VALUES ('coutfit', $1, now())`, user)
	a.exec(`INSERT INTO "OutfitItem" ("id","outfitId","wardrobeItemId") VALUES ('centry1','coutfit','c-gone'), ('centry2','coutfit','c-stays')`)

	got := a.do(itemCall(m, http.MethodDelete, "c-gone", nil))
	a.is(got, http.StatusOK, "")
	if got.body["ok"] != true || len(got.body) != 1 {
		t.Errorf("answer %s", got.raw)
	}
	if a.itemCount("c-gone") != 0 || a.itemCount("c-stays") != 1 {
		t.Error("the wrong item rows are left")
	}
	if n := query[int](a, `SELECT count(*) FROM "WardrobeImage" WHERE "wardrobeItemId" = 'c-gone'`); n != 0 {
		t.Errorf("%d image rows left", n)
	}
	if n := query[string](a, `SELECT string_agg("id", ',') FROM "OutfitItem" WHERE "outfitId" = 'coutfit'`); n != "centry2" {
		t.Errorf("outfit entries left: %s", n)
	}
	for _, key := range removed {
		if _, err := a.images.Get(context.Background(), key); !errors.Is(err, storage.ErrNotFound) {
			t.Errorf("%s is still stored (%v)", key, err)
		}
	}
	for _, key := range remaining {
		if _, err := a.images.Get(context.Background(), key); err != nil {
			t.Errorf("%s of another item: %v", key, err)
		}
	}
	// Deleted is gone: again is NOT_FOUND, and so is reading it.
	a.is(a.do(itemCall(m, http.MethodDelete, "c-gone", nil)), http.StatusNotFound, "NOT_FOUND")
	a.is(a.do(itemCall(m, http.MethodGet, "c-gone", nil)), http.StatusNotFound, "NOT_FOUND")
}

// brokenDeletes is a store whose deletions fail.
type brokenDeletes struct{ storage.Store }

func (brokenDeletes) Delete(context.Context, ...string) error {
	return errors.New("the disk is read-only")
}

// The rows go first; files that cannot be removed are left to the sweep
// and the item is deleted all the same.
func TestWardrobeDeleteSucceedsWhenTheFilesCannotBeRemoved(t *testing.T) {
	t.Parallel()
	local, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	a := newAPI(t, apiOptions{images: brokenDeletes{local}})
	m := a.mobileRegister(nil)
	user := a.userID(m.email)
	base := "users/" + user + "/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
	row := plainRow("c-gone")
	row.Images = []golden.WardrobeImageRow{{ID: "cimg1", StorageKey: base + ".jpg", IsPrimary: true, CreatedAt: "2026-11-20T07:00:00.000Z"}}
	a.insertItem(user, row)

	a.is(a.do(itemCall(m, http.MethodDelete, "c-gone", nil)), http.StatusOK, "")
	if a.itemCount("c-gone") != 0 {
		t.Error("the item is still there")
	}
	logs := a.logs()
	if !strings.Contains(logs, "files of a deleted item not removed") || !strings.Contains(logs, "the disk is read-only") || !strings.Contains(logs, `"files":1`) {
		t.Errorf("the failure is not logged: %s", logs)
	}
}

// leavingClient is a store that sees the caller leave just as the files are
// to be removed.
type leavingClient struct {
	storage.Store
	leave context.CancelFunc
}

func (s leavingClient) Delete(ctx context.Context, keys ...string) error {
	s.leave()
	return s.Store.Delete(ctx, keys...)
}

// A client that leaves while its item is deleted does not leave the files
// behind: they are removed whatever happens to the request.
func TestWardrobeDeleteRemovesTheFilesAlthoughTheClientLeft(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{})
	m := a.mobileRegister(nil)
	user := a.userID(m.email)
	key := "users/" + user + "/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d.jpg"
	row := plainRow("c-gone")
	row.Images = []golden.WardrobeImageRow{{ID: "cimg1", StorageKey: key, IsPrimary: true, CreatedAt: "2026-11-20T07:00:00.000Z"}}
	a.insertItem(user, row)
	if err := a.images.Put(context.Background(), key, []byte("image")); err != nil {
		t.Fatal(err)
	}
	ctx, leave := context.WithCancel(context.Background())
	defer leave()
	service := wardrobe.New(a.pool, leavingClient{a.images, leave}, slog.New(slog.DiscardHandler))
	if err := service.Delete(ctx, user, "c-gone"); err != nil {
		t.Fatal(err)
	}
	if ctx.Err() == nil {
		t.Fatal("the store was not asked to remove anything")
	}
	if _, err := a.images.Get(context.Background(), key); !errors.Is(err, storage.ErrNotFound) {
		t.Errorf("the file is still stored (%v)", err)
	}
}

// A stored value that is not the JSON it should be is the server's error,
// never an item with an empty list.
func TestWardrobeItemWithUnreadableStoredJSONIsAnInternalError(t *testing.T) {
	t.Parallel()
	a := newAPI(t, apiOptions{})
	m := a.mobileRegister(nil)
	for column, text := range map[string]string{"colors": "white", "season": "null", "confidences": "[]", "correctionLog": `{"field":"fit"}`} {
		a.exec(`DELETE FROM "WardrobeItem" WHERE "id" = 'c-bad'`)
		a.insertItem(a.userID(m.email), plainRow("c-bad"))
		a.exec(`UPDATE "WardrobeItem" SET "`+column+`" = $1 WHERE "id" = 'c-bad'`, text)
		a.is(a.do(itemCall(m, http.MethodGet, "c-bad", nil)), http.StatusInternalServerError, "INTERNAL")
		a.is(a.do(listCall(m, "")), http.StatusInternalServerError, "INTERNAL")
		if !strings.Contains(a.logs(), "the stored "+column+" of item c-bad") {
			t.Errorf("%s: the cause is not logged", column)
		}
	}
}

// The links an item carries open its images on this server, and stop when
// they expire.
func TestWardrobeImageLinksOpenTheImages(t *testing.T) {
	t.Parallel()
	now := time.Unix(1_800_000_000, 0)
	clock := func() time.Time { return now }
	a := newAPI(t, apiOptions{now: func() time.Time { return clock() }})
	m := a.mobileRegister(nil)
	user := a.userID(m.email)
	base := "users/" + user + "/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
	row := plainRow("c-mine")
	row.Images = []golden.WardrobeImageRow{{ID: "cimg1", StorageKey: base + ".jpg", DisplayKey: ptr(base + "_display.webp"), ThumbnailKey: ptr(base + "_thumb.webp"), IsPrimary: true, CreatedAt: "2026-11-20T07:00:00.000Z"}}
	a.insertItem(user, row)
	for _, variant := range []string{".jpg", "_display.webp", "_thumb.webp"} {
		if err := a.images.Put(context.Background(), base+variant, []byte("the bytes of "+variant)); err != nil {
			t.Fatal(err)
		}
	}
	got := a.do(itemCall(m, http.MethodGet, "c-mine", nil))
	a.is(got, http.StatusOK, "")
	if strings.Contains(string(got.raw), "storageKey") || strings.Contains(string(got.raw), base+".jpg") {
		t.Errorf("the answer names the master: %s", got.raw)
	}
	fetch := func(link string) (int, string) {
		t.Helper()
		w := httptest.NewRecorder()
		a.handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "http://app.example.uz"+link, nil))
		return w.Code, w.Body.String()
	}
	for name, want := range map[string]string{"url": "the bytes of _display.webp", "thumbnailUrl": "the bytes of _thumb.webp"} {
		link := got.text("item", "primaryImage", name)
		if status, body := fetch(link); status != http.StatusOK || body != want {
			t.Errorf("%s %s: %d %q", name, link, status, body)
		}
	}
	if got.text("item", "primaryImage", "urlExpiresAt") != "2027-01-15T09:00:00.000Z" {
		t.Errorf("urlExpiresAt %s", got.text("item", "primaryImage", "urlExpiresAt"))
	}
	link := got.text("item", "primaryImage", "url")
	clock = func() time.Time { return now.Add(time.Hour + time.Second) }
	if status, _ := fetch(link); status != http.StatusNotFound {
		t.Errorf("an expired link: %d", status)
	}
}
