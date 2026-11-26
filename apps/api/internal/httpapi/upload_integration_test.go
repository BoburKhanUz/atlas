//go:build integration

package httpapi_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	xwebp "golang.org/x/image/webp"

	"lookly/internal/apierr"
	"lookly/internal/dbtest"
	"lookly/internal/golden"
	"lookly/internal/httpapi"
	"lookly/internal/idempotency"
	"lookly/internal/imaging"
	"lookly/internal/storage"
	"lookly/internal/wardrobe"
)

// formPart is one part of an upload form.
type formPart struct {
	name     string
	filename *string // nil: a text field
	typ      string  // the part's Content-Type ("" for none)
	data     []byte
}

func filePart(filename, typ string, data []byte) formPart {
	return formPart{name: "file", filename: &filename, typ: typ, data: data}
}

func textPart(name, value string) formPart {
	return formPart{name: name, data: []byte(value)}
}

// form builds a multipart body and its Content-Type.
func form(t *testing.T, parts ...formPart) (string, string) {
	t.Helper()
	var b bytes.Buffer
	w := multipart.NewWriter(&b)
	for _, p := range parts {
		h := textproto.MIMEHeader{}
		disposition := fmt.Sprintf(`form-data; name=%q`, p.name)
		if p.filename != nil {
			disposition += fmt.Sprintf(`; filename=%q`, *p.filename)
		}
		h.Set("Content-Disposition", disposition)
		if p.typ != "" {
			h.Set("Content-Type", p.typ)
		}
		part, err := w.CreatePart(h)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write(p.data); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return b.String(), w.FormDataContentType()
}

// uploadCall is an upload of the form by the session's user; key is the
// Idempotency-Key ("" for none).
func uploadCall(t *testing.T, m mobileSession, key string, parts ...formPart) call {
	t.Helper()
	body, contentType := form(t, parts...)
	c := call{path: itemsPath, mobile: true, bearer: m.accessToken, body: body, headers: map[string]string{"Content-Type": contentType}}
	if key != "" {
		c.headers["Idempotency-Key"] = key
	}
	return c
}

// picture is a fixture of testdata/.
func picture(t *testing.T, file string) []byte {
	t.Helper()
	return golden.TestdataFile(t, file)
}

const whiteShirt = "vision/e2e-white-shirt.png"

// uploadWorld is a server with one user and counts of what uploads leave.
type uploadWorld struct {
	*api
	m    mobileSession
	user string
	t0   time.Time
}

func newUploadWorld(t *testing.T, o apiOptions) *uploadWorld {
	t.Helper()
	a := newAPI(t, o)
	m := a.mobileRegister(nil)
	// 09:00 UTC tomorrow: a fixed time of day, and never behind the real
	// clock, by which the tokens of users registered later are issued.
	w := &uploadWorld{api: a, m: m, user: a.userID(m.email), t0: time.Now().UTC().Truncate(24 * time.Hour).Add(33 * time.Hour)}
	dbtest.SetClock(t, a.pool, w.t0)
	t.Cleanup(func() { dbtest.SetClock(t, a.pool, time.Time{}) })
	return w
}

func (w *uploadWorld) clock(at time.Time) { dbtest.SetClock(w.t, w.pool, at) }

func (w *uploadWorld) items() int {
	w.t.Helper()
	return query[int](w.api, `SELECT count(*) FROM "WardrobeItem" WHERE "userId" = $1`, w.user)
}

func (w *uploadWorld) keys() int {
	w.t.Helper()
	return query[int](w.api, `SELECT count(*) FROM "IdempotencyKey" WHERE "userId" = $1`, w.user)
}

// files are the keys of everything stored.
func (w *uploadWorld) files() []string {
	w.t.Helper()
	var keys []string
	if err := w.images.List(context.Background(), func(o storage.Object) error {
		keys = append(keys, o.Key)
		return nil
	}); err != nil {
		w.t.Fatal(err)
	}
	slices.Sort(keys)
	return keys
}

// uploadsToday is how many uploads count against the user's day at the
// database clock; taking one more to learn it is undone.
func (w *uploadWorld) uploadsLeft(at time.Time) int {
	w.t.Helper()
	hit := wardrobe.DailyUploadHit(w.user, at)
	left := 0
	for {
		d, err := w.limiter.Take(context.Background(), hit)
		if err != nil {
			w.t.Fatal(err)
		}
		if !d.Allowed {
			break
		}
		left++
	}
	for range left {
		if err := w.limiter.Refund(context.Background(), hit); err != nil {
			w.t.Fatal(err)
		}
	}
	return left
}

// nothingLeft checks that a refused upload left nothing behind.
func (w *uploadWorld) nothingLeft(what string, items, files, keys, left int) {
	w.t.Helper()
	if got := w.items(); got != items {
		w.t.Errorf("%s: %d items, want %d", what, got, items)
	}
	if got := len(w.files()); got != files {
		w.t.Errorf("%s: %d files stored, want %d: %v", what, got, files, w.files())
	}
	if got := w.keys(); got != keys {
		w.t.Errorf("%s: %d idempotency keys, want %d", what, got, keys)
	}
	if got := w.uploadsLeft(w.t0); got != left {
		w.t.Errorf("%s: %d uploads left today, want %d", what, got, left)
	}
}

func TestUploadCreatesAnItemWithItsDetectedAttributes(t *testing.T) {
	t.Parallel()
	// The links are signed by a clock that stands still, so that the item
	// reads back with the same links however long the test takes.
	signedAt := time.Now()
	w := newUploadWorld(t, apiOptions{now: func() time.Time { return signedAt }})
	data := picture(t, whiteShirt)
	var want golden.VisionDetection
	for _, c := range golden.LoadVision(t).Detections {
		if c.File == whiteShirt {
			want = c.Detection
		}
	}

	got := w.do(uploadCall(t, w.m, "", filePart("e2e-white-shirt.png", "image/png", data)))
	w.is(got, http.StatusCreated, "")
	if got.header.Get("Idempotent-Replayed") != "" {
		t.Error("a first upload is marked replayed")
	}

	// The detection is the Next.js mock's for this picture and name.
	var body struct {
		Item      map[string]any         `json:"item"`
		Detection golden.VisionDetection `json:"detection"`
	}
	if err := json.Unmarshal(got.raw, &body); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(body.Detection, want) {
		t.Errorf("detection %+v, want %+v", body.Detection, want)
	}
	// The item holds what was detected, uncorrected.
	item := body.Item
	id := item["id"].(string)
	if item["category"] != "shirt" || item["subcategory"] != "tshirt" || !reflect.DeepEqual(item["colors"], []any{"ivory"}) ||
		item["pattern"] != "solid" || item["wasCorrected"] != false || len(item["correctionLog"].([]any)) != 0 ||
		item["createdAt"] != w.t0.Format("2006-01-02T15:04:05.000Z") || item["updatedAt"] != item["createdAt"] {
		t.Errorf("item %s", got.raw)
	}
	confidences, _ := json.Marshal(item["confidences"])
	wantConfidences, _ := json.Marshal(want.Confidence)
	if string(confidences) != string(wantConfidences) {
		t.Errorf("item confidences %s, want %s", confidences, wantConfidences)
	}

	// The row, as the Next.js API writes it.
	row := w.storedItem(id)
	wantRow := map[string]any{
		"userId": w.user, "colors": `["ivory"]`, "season": `["spring","summer"]`, "correctionLog": "[]", "wasCorrected": false,
		"confidences":      `{"category":0.42,"subcategory":0.15,"color":0.94,"pattern":0.78,"material":0.34,"style":0.38,"season":0.36,"sleeveLength":0.12,"fit":0.13,"formality":0.29,"gender":0.18}`,
		"analysisProvider": "mock", "analysisModel": "mock-vision", "analysisVersion": "mock", "analyzedAt": w.t0.Format("2006-01-02T15:04:05"),
		"analysisRawConfidences": nil, "createdAt": w.t0.Format("2006-01-02T15:04:05"), "updatedAt": w.t0.Format("2006-01-02T15:04:05"),
		"material": "cotton", "sleeveLength": "long", "fit": "regular", "style": "minimal", "gender": "unisex", "formality": "smart_casual",
	}
	for column, value := range wantRow {
		if !reflect.DeepEqual(row[column], value) {
			t.Errorf("stored %s: %v, want %v", column, row[column], value)
		}
	}

	// One image row: the keys of the three stored files, what was uploaded.
	var img struct {
		StorageKey, DisplayKey, ThumbnailKey, MimeType, Sha256 string
		Width, Height, Bytes                                   int
		IsPrimary                                              bool
	}
	if err := w.pool.QueryRow(context.Background(), `SELECT "storageKey","displayKey","thumbnailKey","mimeType","sha256","width","height","bytes","isPrimary" FROM "WardrobeImage" WHERE "wardrobeItemId" = $1`, id).
		Scan(&img.StorageKey, &img.DisplayKey, &img.ThumbnailKey, &img.MimeType, &img.Sha256, &img.Width, &img.Height, &img.Bytes, &img.IsPrimary); err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(data)
	base := strings.TrimSuffix(img.StorageKey, ".png")
	if !strings.HasPrefix(base, "users/"+w.user+"/") || !storage.ValidKey(img.StorageKey) || img.DisplayKey != base+"_display.webp" || img.ThumbnailKey != base+"_thumb.webp" ||
		img.MimeType != "image/png" || img.Sha256 != hex.EncodeToString(digest[:]) || img.Width != 512 || img.Height != 512 || img.Bytes != len(data) || !img.IsPrimary {
		t.Errorf("image row %+v", img)
	}
	if files := w.files(); !slices.Equal(files, []string{img.StorageKey, img.DisplayKey, img.ThumbnailKey}) {
		t.Errorf("stored files %v", files)
	}
	// The answer's links open the variants: WebP, the display at full size
	// (the picture is smaller than 1600), the thumbnail at 400.
	for name, side := range map[string]int{"url": 512, "thumbnailUrl": 400} {
		link := got.text("item", "primaryImage", name)
		wr := httptestGet(w.api, link)
		if wr.Code != http.StatusOK || wr.Header().Get("Content-Type") != "image/webp" {
			t.Fatalf("%s %s: %d %s", name, link, wr.Code, wr.Header().Get("Content-Type"))
		}
		cfg, err := xwebp.DecodeConfig(wr.Body)
		if err != nil || cfg.Width != side || cfg.Height != side {
			t.Errorf("%s: %dx%d (%v), want %d", name, cfg.Width, cfg.Height, err, side)
		}
	}
	if strings.Contains(string(got.raw), img.StorageKey) {
		t.Error("the answer names the master")
	}
	if left := w.uploadsLeft(w.t0); left != wardrobe.DailyUploads-1 {
		t.Errorf("%d uploads left today", left)
	}
	// The item reads back as it was answered.
	read := w.do(itemCall(w.m, http.MethodGet, id, nil))
	if !reflect.DeepEqual(read.body["item"], got.body["item"]) {
		t.Errorf("read back %s", read.raw)
	}
}

func httptestGet(a *api, link string) *httptest.ResponseRecorder {
	a.t.Helper()
	w := httptest.NewRecorder()
	a.handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "http://app.example.uz"+link, nil))
	return w
}

// The name the mock reads is the form's "filename" when it has one, and the
// file's own name otherwise; the declared type may be any of the image types.
func TestUploadFileNamesAndDeclaredTypes(t *testing.T) {
	t.Parallel()
	w := newUploadWorld(t, apiOptions{})
	data := picture(t, whiteShirt)
	for name, c := range map[string]struct {
		parts    []formPart
		category string
	}{
		"the file's name":             {[]formPart{filePart("blue-jeans.png", "image/png", data)}, "pants"},
		"the filename field":          {[]formPart{filePart("blue-jeans.png", "image/png", data), textPart("filename", "kurtka.jpg")}, "outerwear"},
		"the field before the file":   {[]formPart{textPart("filename", "sumka"), filePart("blue-jeans.png", "image/png", data)}, "bag"},
		"an empty filename field":     {[]formPart{filePart("dress.png", "image/png", data), textPart("filename", "")}, "dress"},
		"the last of repeated fields": {[]formPart{filePart("x.png", "image/png", data), textPart("filename", "hat"), textPart("filename", "boots")}, "shoes"},
		"no hint":                     {[]formPart{filePart("IMG_0001.png", "image/png", data)}, "shirt"},
		"declared in upper case":      {[]formPart{filePart("shoe.png", "IMAGE/PNG", data)}, "shoes"},
		"declared as another image":   {[]formPart{filePart("shoe.png", "image/jpg", data)}, "shoes"},
		"declared as WebP":            {[]formPart{filePart("shoe.png", " image/webp ", data)}, "shoes"},
		"only the first file counts":  {[]formPart{filePart("watch.png", "image/png", data), filePart("dress.png", "image/png", []byte("not a picture"))}, "accessory"},
		"files under other names":     {[]formPart{{name: "other", filename: ptr("dress.png"), typ: "image/png", data: []byte("x")}, filePart("polo.png", "image/png", data)}, "shirt"},
	} {
		got := w.do(uploadCall(t, w.m, "", c.parts...))
		w.is(got, http.StatusCreated, "")
		if got.text("detection", "category") != c.category || got.text("item", "category") != c.category {
			t.Errorf("%s: category %s, want %s", name, got.text("detection", "category"), c.category)
		}
		// Whatever it was declared as, the master is what the bytes are.
		if key := query[string](w.api, `SELECT "storageKey" FROM "WardrobeImage" WHERE "wardrobeItemId" = $1`, got.text("item", "id")); !strings.HasSuffix(key, ".png") {
			t.Errorf("%s: master %s", name, key)
		}
	}
}

func TestUploadKeepsEachFormatAndTurnsThePictureUpright(t *testing.T) {
	t.Parallel()
	w := newUploadWorld(t, apiOptions{})
	for file, want := range map[string]struct {
		ext, mime     string
		width, height int
	}{
		"images/orientation-6.jpg":  {".jpg", "image/jpeg", 400, 300},
		"images/orientation-1.jpg":  {".jpg", "image/jpeg", 300, 400},
		"images/marked.png":         {".png", "image/png", 300, 400},
		"vision/lossless-navy.webp": {".webp", "image/webp", 300, 300},
	} {
		got := w.do(uploadCall(t, w.m, "", filePart("x", "image/jpeg", picture(t, file))))
		w.is(got, http.StatusCreated, "")
		var key, mimeType string
		var width, height int
		if err := w.pool.QueryRow(context.Background(), `SELECT "storageKey","mimeType","width","height" FROM "WardrobeImage" WHERE "wardrobeItemId" = $1`, got.text("item", "id")).
			Scan(&key, &mimeType, &width, &height); err != nil {
			t.Fatal(err)
		}
		if !strings.HasSuffix(key, want.ext) || mimeType != want.mime || width != want.width || height != want.height {
			t.Errorf("%s: %s %s %dx%d, want %+v", file, key, mimeType, width, height, want)
		}
		image := got.body["item"].(map[string]any)["primaryImage"].(map[string]any)
		if image["width"] != float64(want.width) || image["height"] != float64(want.height) {
			t.Errorf("%s: answered %vx%v", file, image["width"], image["height"])
		}
	}
}

// Every refusal leaves nothing behind: no item, no file, no key, and the
// attempt is not counted against the day.
func TestUploadRefusalsStoreNothing(t *testing.T) {
	t.Parallel()
	w := newUploadWorld(t, apiOptions{})
	good := picture(t, whiteShirt)
	const key = "upload-key-0001"
	huge := make([]byte, httpapi.MaxImageBytes+1)
	atLimit := make([]byte, httpapi.MaxImageBytes)
	overBody := strings.Repeat("x", httpapi.UploadBodyLimit+1)

	type refusal struct {
		name    string
		call    call
		status  int
		code    string
		message string // "" when the code's own
	}
	with := func(c call, change func(*call)) call {
		c.headers = map[string]string{"Content-Type": c.headers["Content-Type"], "Idempotency-Key": c.headers["Idempotency-Key"]}
		if c.headers["Idempotency-Key"] == "" {
			delete(c.headers, "Idempotency-Key")
		}
		change(&c)
		return c
	}
	valid := uploadCall(t, w.m, key, filePart("shirt.png", "image/png", good))
	cases := []refusal{
		{"a malformed key", with(valid, func(c *call) { c.headers["Idempotency-Key"] = "short" }), 400, "VALIDATION_ERROR", "Idempotency-Key: 8–128 ta belgi (A-Z, a-z, 0-9, _ yoki -)"},
		{"a malformed key before the form's type", with(valid, func(c *call) {
			c.headers["Idempotency-Key"] = "has space in it"
			c.headers["Content-Type"] = "application/json"
		}), 400, "VALIDATION_ERROR", ""},
		{"no declared length", with(valid, func(c *call) { c.body = io.NopCloser(strings.NewReader(c.body.(string))) }), 413, "PAYLOAD_TOO_LARGE", "So‘rov hajmi ko‘rsatilmagan"},
		{"a request over 10 MB", with(valid, func(c *call) { c.body = overBody }), 413, "PAYLOAD_TOO_LARGE", "So‘rov hajmi juda katta"},
		{"the length before the type", with(valid, func(c *call) { c.body = overBody; c.headers["Content-Type"] = "text/plain" }), 413, "PAYLOAD_TOO_LARGE", ""},
		{"not a form", with(valid, func(c *call) { c.headers["Content-Type"] = "application/json"; c.body = `{}` }), 415, "UNSUPPORTED_MEDIA_TYPE", "multipart/form-data kutilgan"},
		{"no type at all", with(valid, func(c *call) { delete(c.headers, "Content-Type") }), 415, "UNSUPPORTED_MEDIA_TYPE", "multipart/form-data kutilgan"},
		{"a form without a boundary", with(valid, func(c *call) { c.headers["Content-Type"] = "multipart/form-data" }), 400, "BAD_REQUEST", "Yaroqsiz forma ma’lumotlari"},
		{"a form that breaks off", with(valid, func(c *call) { c.body = c.body.(string)[:200] }), 400, "BAD_REQUEST", "Yaroqsiz forma ma’lumotlari"},
		{"a body that is no form", with(valid, func(c *call) { c.body = "hello" }), 400, "BAD_REQUEST", "Yaroqsiz forma ma’lumotlari"},
		{"no file", uploadCall(t, w.m, key, textPart("filename", "shirt.png")), 400, "BAD_REQUEST", "Rasm fayli topilmadi"},
		{"an empty form", uploadCall(t, w.m, key), 400, "BAD_REQUEST", "Rasm fayli topilmadi"},
		{"the file as text", uploadCall(t, w.m, key, textPart("file", string(good))), 400, "BAD_REQUEST", "Rasm fayli topilmadi"},
		{"text named file before the file", uploadCall(t, w.m, key, textPart("file", "x"), filePart("shirt.png", "image/png", good)), 400, "BAD_REQUEST", "Rasm fayli topilmadi"},
		{"a file under another name", uploadCall(t, w.m, key, formPart{name: "image", filename: ptr("shirt.png"), typ: "image/png", data: good}), 400, "BAD_REQUEST", "Rasm fayli topilmadi"},
		{"declared as text", uploadCall(t, w.m, key, filePart("shirt.png", "text/plain", good)), 415, "UNSUPPORTED_IMAGE_FORMAT", ""},
		{"declared as nothing", uploadCall(t, w.m, key, filePart("shirt.png", "", good)), 415, "UNSUPPORTED_IMAGE_FORMAT", ""},
		{"declared as HEIC", uploadCall(t, w.m, key, filePart("shirt.heic", "image/heic", good)), 415, "UNSUPPORTED_IMAGE_FORMAT", ""},
		{"declared with a parameter", uploadCall(t, w.m, key, filePart("shirt.png", "image/png; charset=binary", good)), 415, "UNSUPPORTED_IMAGE_FORMAT", ""},
		{"the declared type before the size", uploadCall(t, w.m, key, filePart("shirt.png", "text/plain", huge)), 415, "UNSUPPORTED_IMAGE_FORMAT", ""},
		{"a picture over 8 MB", uploadCall(t, w.m, key, filePart("shirt.png", "image/png", huge)), 413, "PAYLOAD_TOO_LARGE", "Rasm hajmi 8 MB dan oshmasligi kerak"},
		{"8 MB that are no picture", uploadCall(t, w.m, key, filePart("shirt.png", "image/png", atLimit)), 422, "INVALID_IMAGE", ""},
		{"HEIC bytes declared as JPEG", uploadCall(t, w.m, key, filePart("shirt.jpg", "image/jpeg", picture(t, "images/heic-brand.bin"))), 415, "UNSUPPORTED_IMAGE_FORMAT", ""},
		{"a GIF declared as PNG", uploadCall(t, w.m, key, filePart("shirt.png", "image/png", picture(t, "images/picture.gif"))), 415, "UNSUPPORTED_IMAGE_FORMAT", ""},
		{"bytes that are no picture", uploadCall(t, w.m, key, filePart("shirt.png", "image/png", picture(t, "images/garbage.bin"))), 422, "INVALID_IMAGE", ""},
		{"a picture cut short", uploadCall(t, w.m, key, filePart("shirt.jpg", "image/jpeg", picture(t, "images/truncated.jpg"))), 422, "INVALID_IMAGE", ""},
		{"an empty file", uploadCall(t, w.m, key, filePart("shirt.png", "image/png", nil)), 422, "INVALID_IMAGE", ""},
		{"a picture too small", uploadCall(t, w.m, key, filePart("shirt.png", "image/png", picture(t, "images/tiny.png"))), 422, "IMAGE_DIMENSIONS", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := w.do(c.call)
			w.is(got, c.status, apierr.Code(c.code))
			if c.message != "" && got.text("error") != c.message {
				t.Errorf("message %q, want %q", got.text("error"), c.message)
			}
			if got.header.Get("Retry-After") != "" {
				t.Errorf("Retry-After %q", got.header.Get("Retry-After"))
			}
			w.nothingLeft(c.name, 0, 0, 0, wardrobe.DailyUploads)
		})
	}

	// Who the caller is comes before anything about the upload.
	worst := with(valid, func(c *call) {
		c.headers["Idempotency-Key"] = "short"
		c.headers["Content-Type"] = "text/plain"
		c.body = overBody
	})
	anonymous := worst
	anonymous.bearer = ""
	w.is(w.do(anonymous), http.StatusUnauthorized, "UNAUTHORIZED")
	w.exec(`UPDATE "LegalConsent" SET "version" = $2 WHERE "userId" = $1`, w.user, outdatedVersion)
	w.is(w.do(worst), http.StatusForbidden, "CONSENT_REQUIRED")
	w.is(w.do(valid), http.StatusForbidden, "CONSENT_REQUIRED")
	w.nothingLeft("without consent", 0, 0, 0, wardrobe.DailyUploads)

	// After all that, the key is free and the picture uploads.
	w.exec(`DELETE FROM "LegalConsent" WHERE "userId" = $1`, w.user)
	a2 := w.mobileRegister(nil)
	fresh := uploadCall(t, a2, key, filePart("shirt.png", "image/png", good))
	w.is(w.do(fresh), http.StatusCreated, "")
}

// A retry with the same key and the same request answers with the item the
// first one created, and creates nothing.
func TestUploadIdempotency(t *testing.T) {
	t.Parallel()
	w := newUploadWorld(t, apiOptions{})
	good, other := picture(t, whiteShirt), picture(t, "vision/e2e-blue-jeans.png")
	const key = "upload-key-0001"
	request := func(key string, parts ...formPart) call { return uploadCall(t, w.m, key, parts...) }
	shirt := []formPart{filePart("white-shirt.png", "image/png", good), textPart("filename", "white-shirt.png")}

	first := w.do(request(key, shirt...))
	w.is(first, http.StatusCreated, "")
	id := first.text("item", "id")

	for name, c := range map[string]call{
		"the same request":         request(key, shirt...),
		"its fields reordered":     request(key, shirt[1], shirt[0]),
		"the key with white space": request(" "+key+"\t", shirt...),
	} {
		again := w.do(c)
		w.is(again, http.StatusCreated, "")
		if again.header.Get("Idempotent-Replayed") != "true" || again.text("item", "id") != id {
			t.Errorf("%s: replayed %q, item %s", name, again.header.Get("Idempotent-Replayed"), again.text("item", "id"))
		}
		if !reflect.DeepEqual(again.body["detection"], first.body["detection"]) {
			t.Errorf("%s: detection %v", name, again.body["detection"])
		}
	}
	// One item, one set of files, one upload counted.
	w.nothingLeft("after replays", 1, 3, 1, wardrobe.DailyUploads-1)

	// Another request under the key: refused, whatever differs.
	for name, c := range map[string]call{
		"another picture":     request(key, filePart("white-shirt.png", "image/png", other), shirt[1]),
		"another file name":   request(key, filePart("shirt.png", "image/png", good), shirt[1]),
		"another field value": request(key, shirt[0], textPart("filename", "jeans.png")),
		"a field more":        request(key, shirt[0], shirt[1], textPart("note", "x")),
		"a field less":        request(key, shirt[0]),
	} {
		got := w.do(c)
		w.is(got, http.StatusConflict, "IDEMPOTENCY_KEY_MISMATCH")
		if got.header.Get("Retry-After") != "" {
			t.Errorf("%s: Retry-After %q", name, got.header.Get("Retry-After"))
		}
	}
	// The same request under another key, or without one, is a new upload.
	w.is(w.do(request("upload-key-0002", shirt...)), http.StatusCreated, "")
	w.is(w.do(request("", shirt...)), http.StatusCreated, "")
	w.nothingLeft("after new uploads", 3, 9, 2, wardrobe.DailyUploads-3)

	// A replay answers with the item as it is now: corrected.
	w.is(w.do(itemCall(w.m, http.MethodPatch, id, map[string]any{"category": "pants", "subcategory": "jeans", "colors": []string{"blue"}})), http.StatusOK, "")
	corrected := w.do(request(key, shirt...))
	w.is(corrected, http.StatusCreated, "")
	if corrected.text("detection", "category") != "pants" || corrected.text("item", "category") != "pants" || corrected.body["detection"].(map[string]any)["mock"] != true ||
		!reflect.DeepEqual(corrected.body["detection"].(map[string]any)["colors"], []any{"blue"}) ||
		!reflect.DeepEqual(corrected.body["detection"].(map[string]any)["confidence"], first.body["detection"].(map[string]any)["confidence"]) {
		t.Errorf("replay after a correction: %s", corrected.raw)
	}

	// Once the item is deleted, the key answers that it is gone.
	w.is(w.do(itemCall(w.m, http.MethodDelete, id, nil)), http.StatusOK, "")
	gone := w.do(request(key, shirt...))
	w.is(gone, http.StatusNotFound, "NOT_FOUND")
	if gone.text("error") != "Bu so‘rov bilan yaratilgan buyum o‘chirilgan" {
		t.Errorf("message %q", gone.text("error"))
	}
	// Another user's key of the same name is their own.
	theirs := w.mobileRegister(nil)
	w.is(w.do(uploadCall(t, theirs, key, shirt...)), http.StatusCreated, "")
}

func TestUploadWhileTheSameRequestRunsWaitsAndACrashedOneIsTakenOver(t *testing.T) {
	t.Parallel()
	w := newUploadWorld(t, apiOptions{})
	good := picture(t, whiteShirt)
	const key = "upload-key-0001"
	parts := []formPart{filePart("white-shirt.png", "image/png", good)}
	hash := idempotency.MultipartHash(good, "white-shirt.png", map[string]string{})
	// A request with the key started a minute ago and has not finished.
	w.exec(`INSERT INTO "IdempotencyKey" ("id","userId","route","key","requestHash","status","createdAt","expiresAt")
		VALUES ('ik1', $1, $2, $3, $4, 'in_progress', $5, $6)`, w.user, wardrobe.UploadRoute, key, hash, w.t0.Add(-time.Minute), w.t0.Add(24*time.Hour-time.Minute))

	got := w.do(uploadCall(t, w.m, key, parts...))
	w.is(got, http.StatusConflict, "IDEMPOTENCY_IN_PROGRESS")
	if got.header.Get("Retry-After") != "5" {
		t.Errorf("Retry-After %q", got.header.Get("Retry-After"))
	}
	w.nothingLeft("while in progress", 0, 0, 1, wardrobe.DailyUploads)
	// Another request under it is told so even while it runs.
	w.is(w.do(uploadCall(t, w.m, key, filePart("other.png", "image/png", good))), http.StatusConflict, "IDEMPOTENCY_KEY_MISMATCH")

	// Five minutes after it started it is taken for crashed.
	w.clock(w.t0.Add(4 * time.Minute))
	done := w.do(uploadCall(t, w.m, key, parts...))
	w.is(done, http.StatusCreated, "")
	var status, resource string
	if err := w.pool.QueryRow(context.Background(), `SELECT "status","resourceId" FROM "IdempotencyKey" WHERE "id" = 'ik1'`).Scan(&status, &resource); err != nil {
		t.Fatal(err)
	}
	if status != "completed" || resource != done.text("item", "id") || done.header.Get("Idempotent-Replayed") != "" {
		t.Errorf("after the takeover: %s %s, replayed %q", status, resource, done.header.Get("Idempotent-Replayed"))
	}
	// And from then on it replays.
	again := w.do(uploadCall(t, w.m, key, parts...))
	if again.header.Get("Idempotent-Replayed") != "true" || again.text("item", "id") != resource {
		t.Errorf("replay after the takeover: %s", again.raw)
	}
}

// A refused upload forgets its key: the retry with a picture that is one
// runs, although its content differs.
func TestUploadRefusalReleasesTheKey(t *testing.T) {
	t.Parallel()
	w := newUploadWorld(t, apiOptions{})
	const key = "upload-key-0001"
	w.is(w.do(uploadCall(t, w.m, key, filePart("shirt.png", "image/png", picture(t, "images/garbage.bin")))), http.StatusUnprocessableEntity, "INVALID_IMAGE")
	w.nothingLeft("after the refusal", 0, 0, 0, wardrobe.DailyUploads)
	got := w.do(uploadCall(t, w.m, key, filePart("shirt.png", "image/png", picture(t, whiteShirt))))
	w.is(got, http.StatusCreated, "")
	if got.header.Get("Idempotent-Replayed") != "" {
		t.Error("marked replayed")
	}
}

// The limits are the owner's decision of 2026-11-26: a change of either is
// a decision, not a refactoring.
func TestTheUploadLimitsAreTheOwnersDecision(t *testing.T) {
	t.Parallel()
	if wardrobe.DailyUploads != 100 || wardrobe.MaxItems != 1000 {
		t.Fatalf("%d uploads a day, %d items", wardrobe.DailyUploads, wardrobe.MaxItems)
	}
}

// A hundred uploads a day of Uzbekistan time; the day turns at 19:00 UTC.
func TestUploadDailyLimit(t *testing.T) {
	t.Parallel()
	w := newUploadWorld(t, apiOptions{})
	good := picture(t, whiteShirt)
	upload := func(m mobileSession, key string) answer {
		return w.do(uploadCall(t, m, key, filePart("shirt.png", "image/png", good)))
	}
	// 23:59:30 in Tashkent, with 98 uploads behind.
	day := w.t0.Truncate(24 * time.Hour)
	at := day.Add(18*time.Hour + 59*time.Minute + 30*time.Second)
	// The 98 were made in the afternoon; they count all day.
	afternoon := day.Add(10 * time.Hour)
	w.clock(afternoon)
	for range wardrobe.DailyUploads - 2 {
		if d, err := w.limiter.Take(context.Background(), wardrobe.DailyUploadHit(w.user, afternoon)); err != nil || !d.Allowed {
			t.Fatal(d, err)
		}
	}
	w.clock(at)
	const key = "upload-key-0099"
	w.is(upload(w.m, key), http.StatusCreated, "") // the 99th
	// A refused picture is not one of the hundred.
	w.is(w.do(uploadCall(t, w.m, "", filePart("shirt.png", "image/png", picture(t, "images/garbage.bin")))), http.StatusUnprocessableEntity, "INVALID_IMAGE")
	w.is(upload(w.m, ""), http.StatusCreated, "") // the 100th

	refused := upload(w.m, "upload-key-0101")
	w.is(refused, http.StatusTooManyRequests, "AI_QUOTA_EXCEEDED")
	if refused.text("error") != "Bugun 100 ta rasm yukladingiz. Limit Toshkent vaqti bilan yarim tunda yangilanadi." || refused.header.Get("Retry-After") != "30" {
		t.Errorf("refusal %s, Retry-After %q", refused.raw, refused.header.Get("Retry-After"))
	}
	if w.items() != 2 || len(w.files()) != 6 || w.keys() != 1 {
		t.Errorf("after the refusal: %d items, %d files, %d keys", w.items(), len(w.files()), w.keys())
	}
	// A replay is not an upload: it is answered at the limit too.
	replay := upload(w.m, key)
	w.is(replay, http.StatusCreated, "")
	if replay.header.Get("Idempotent-Replayed") != "true" {
		t.Error("the replay at the limit is not marked")
	}
	// Another user has their own day.
	other := w.mobileRegister(nil)
	w.is(upload(other, ""), http.StatusCreated, "")

	// The last millisecond of the day: still refused, a second to wait.
	w.clock(day.Add(19*time.Hour - time.Millisecond))
	last := upload(w.m, "")
	w.is(last, http.StatusTooManyRequests, "AI_QUOTA_EXCEEDED")
	if last.header.Get("Retry-After") != "1" {
		t.Errorf("Retry-After %q", last.header.Get("Retry-After"))
	}
	// Midnight in Tashkent: a new day.
	w.clock(day.Add(19 * time.Hour))
	w.is(upload(w.m, "upload-key-0101"), http.StatusCreated, "")
}

// A wardrobe holds a thousand items.
func TestUploadIntoAFullWardrobe(t *testing.T) {
	t.Parallel()
	w := newUploadWorld(t, apiOptions{})
	good := picture(t, whiteShirt)
	w.exec(`INSERT INTO "WardrobeItem" ("id","userId","category","updatedAt")
		SELECT 'cfull' || n, $1, 'shirt', now() FROM generate_series(1, $2::int) n`, w.user, wardrobe.MaxItems-1)
	upload := func(key string) answer {
		return w.do(uploadCall(t, w.m, key, filePart("shirt.png", "image/png", good)))
	}
	w.is(upload(""), http.StatusCreated, "") // the thousandth

	full := upload("upload-key-0001")
	w.is(full, http.StatusBadRequest, "VALIDATION_ERROR")
	if full.text("error") != "Shkafingizda 1000 ta buyum bor. Yangisini qo‘shish uchun avval keraksizlarini o‘chiring." || full.header.Get("Retry-After") != "" {
		t.Errorf("refusal %s", full.raw)
	}
	w.nothingLeft("a full wardrobe", wardrobe.MaxItems, 3, 0, wardrobe.DailyUploads-1)
	// Another user's wardrobe is their own.
	other := w.mobileRegister(nil)
	w.is(w.do(uploadCall(t, other, "", filePart("shirt.png", "image/png", good))), http.StatusCreated, "")

	// One item less, and there is room again, for the same key too.
	w.is(w.do(itemCall(w.m, http.MethodDelete, "cfull1", nil)), http.StatusOK, "")
	w.is(upload("upload-key-0001"), http.StatusCreated, "")
	if w.items() != wardrobe.MaxItems {
		t.Errorf("%d items", w.items())
	}
}

// Uploads at the same time into the last free place: one gets it.
func TestConcurrentUploadsDoNotOverfillAWardrobe(t *testing.T) {
	t.Parallel()
	w := newUploadWorld(t, apiOptions{})
	good := picture(t, whiteShirt)
	w.exec(`INSERT INTO "WardrobeItem" ("id","userId","category","updatedAt")
		SELECT 'cfull' || n, $1, 'shirt', now() FROM generate_series(1, $2::int) n`, w.user, wardrobe.MaxItems-1)
	const n = 5
	var wg sync.WaitGroup
	statuses := make([]int, n)
	for i := range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			statuses[i] = w.do(uploadCall(t, w.m, "", filePart("shirt.png", "image/png", good))).status
		}()
	}
	wg.Wait()
	slices.Sort(statuses)
	if !slices.Equal(statuses, []int{201, 400, 400, 400, 400}) {
		t.Errorf("statuses %v", statuses)
	}
	// One item more, its three files only, and one upload counted.
	w.nothingLeft("after the race", wardrobe.MaxItems, 3, 0, wardrobe.DailyUploads-1)
}

// failingPuts is a store whose nth write fails.
type failingPuts struct {
	storage.Store
	mu     sync.Mutex
	puts   int
	failAt int
}

func (s *failingPuts) Put(ctx context.Context, key string, data []byte) error {
	s.mu.Lock()
	s.puts++
	fail := s.puts == s.failAt
	s.mu.Unlock()
	if fail {
		return errors.New("the disk is full")
	}
	return s.Store.Put(ctx, key, data)
}

// A failure half way removes what was stored before it.
func TestUploadThatCannotBeStoredLeavesNothing(t *testing.T) {
	t.Parallel()
	for failAt := 1; failAt <= 3; failAt++ {
		local, err := storage.NewLocal(t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		w := newUploadWorld(t, apiOptions{images: &failingPuts{Store: local, failAt: failAt}})
		const key = "upload-key-0001"
		got := w.do(uploadCall(t, w.m, key, filePart("shirt.png", "image/png", picture(t, whiteShirt))))
		w.is(got, http.StatusInternalServerError, "INTERNAL")
		if strings.Contains(string(got.raw), "disk") || !strings.Contains(w.logs(), "the disk is full") {
			t.Errorf("write %d: answer %s", failAt, got.raw)
		}
		w.nothingLeft("write "+strconv.Itoa(failAt)+" failed", 0, 0, 0, wardrobe.DailyUploads)
		// The retry, with the same key, goes through.
		w.is(w.do(uploadCall(t, w.m, key, filePart("shirt.png", "image/png", picture(t, whiteShirt)))), http.StatusCreated, "")
	}
}

// When every processing slot stays busy for the whole of the request's
// time, the upload ends with nothing stored and nothing counted.
func TestUploadThatCannotBeProcessedInTimeLeavesNothing(t *testing.T) {
	t.Parallel()
	processor := imaging.NewProcessor(1)
	w := newUploadWorld(t, apiOptions{processor: processor})
	release := processor.Hold()
	defer release()
	uploads := wardrobe.NewUploads(wardrobe.UploadsConfig{
		Pool: w.pool, Images: w.images, Processor: processor, Limiter: w.limiter, Keys: idempotency.New(w.pool), Log: slog.New(slog.DiscardHandler),
	})
	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()
	_, err := uploads.Create(ctx, wardrobe.Upload{UserID: w.user, File: picture(t, whiteShirt), FileName: "shirt.png", HintName: "shirt.png", Fields: map[string]string{}, IdempotencyKey: "upload-key-0001"})
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("err %v", err)
	}
	w.nothingLeft("out of time", 0, 0, 0, wardrobe.DailyUploads)
	// It is answered as "try again shortly", which the apps retry.
	var answered interface {
		Status() int
		RetryAfterSeconds() int
	}
	if !errors.As(httpapi.UploadError(err), &answered) || answered.Status() != http.StatusServiceUnavailable || answered.RetryAfterSeconds() != 15 {
		t.Errorf("answered as %v", httpapi.UploadError(err))
	}
	// A picture refused by its header does not wait for a slot at all.
	got := w.do(uploadCall(t, w.m, "", filePart("shirt.png", "image/png", picture(t, "images/tiny.png"))))
	w.is(got, http.StatusUnprocessableEntity, "IMAGE_DIMENSIONS")
}

// The upload has its own budget: a body up to 10 MB and time for a slow
// connection; every other route keeps the defaults.
func TestOnlyTheUploadHasALargerBudget(t *testing.T) {
	t.Parallel()
	// The Next.js API's sizes, and a minute and a half for a phone on a
	// slow connection.
	if httpapi.UploadBodyLimit != 10*1024*1024 || httpapi.MaxImageBytes != 8*1024*1024 || httpapi.UploadTimeout != 90*time.Second {
		t.Fatalf("limits: %d, %d, %s", httpapi.UploadBodyLimit, httpapi.MaxImageBytes, httpapi.UploadTimeout)
	}
	for _, pattern := range httpapi.ServedRoutes() {
		body, timeout := httpapi.RouteBudget(pattern)
		wantBody, wantTimeout := int64(httpapi.DefaultBodyLimit), httpapi.RequestTimeout
		if pattern == "POST /api/v1/wardrobe/items" {
			wantBody, wantTimeout = httpapi.UploadBodyLimit, httpapi.UploadTimeout
		}
		if body != wantBody || timeout != wantTimeout {
			t.Errorf("%s: %d bytes in %s", pattern, body, timeout)
		}
	}
}

// deadlineStore records how long the request that stores has left.
type deadlineStore struct {
	storage.Store
	mu   sync.Mutex
	left time.Duration
}

func (s *deadlineStore) Put(ctx context.Context, key string, data []byte) error {
	if deadline, ok := ctx.Deadline(); ok {
		s.mu.Lock()
		s.left = time.Until(deadline)
		s.mu.Unlock()
	}
	return s.Store.Put(ctx, key, data)
}

// An upload really runs with its longer time limit, not the default one.
func TestUploadRunsWithItsOwnTimeLimit(t *testing.T) {
	t.Parallel()
	local, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	store := &deadlineStore{Store: local}
	w := newUploadWorld(t, apiOptions{images: store})
	w.is(w.do(uploadCall(t, w.m, "", filePart("shirt.png", "image/png", picture(t, whiteShirt)))), http.StatusCreated, "")
	if store.left <= httpapi.RequestTimeout || store.left > httpapi.UploadTimeout {
		t.Fatalf("%s left while storing", store.left)
	}
}
